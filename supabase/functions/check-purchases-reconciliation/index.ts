import { createClient } from "npm:@supabase/supabase-js@2";
import { checkCronSecret, getCorsHeaders, getErpBranchMap } from "../_shared/security.ts";
import { selectAllPaged } from "../_shared/db.ts";

// Cuadre diario del libro de compras: ERP contra portal, por sucursal y mes.
//
// **Por qué existe.** `sync-purchases-10min` le pide al ERP **ayer y hoy**,
// filtrando por FECHA DEL DOCUMENTO. Si alguien captura en el ERP una compra
// fechada hace tres días, el cron ya pasó por esa fecha y **no vuelve nunca**:
// ese documento queda fuera del libro para siempre y nada avisa.
//
// No es hipotético. Pasó con Bodega el 2026-06-01: 16 documentos y $14,311.41
// que se registraron tarde y estuvieron ausentes hasta que se recuperaron a
// mano el 2026-08-01. Medido sobre los 16 meses de historia, es el único caso —
// el margen de ayer+hoy alcanza para casi todo— pero "casi todo" en un libro
// que se declara a Hacienda no es suficiente, y el modo de falla es silencioso:
// una compra ausente no rompe nada, solo achica el crédito fiscal.
//
// **Por qué avisar y no arreglar solo.** Recuperar el documento faltante exige
// correr el sync normal sobre ese día (`fastBackfill` NO sirve: completa
// columnas de filas que ya existen, no trae filas nuevas), y eso son 167s por
// mes de Bodega contra un ERP que serializa. Un cron que lo intentara solo,
// todos los días, competiría con el sync de cada 10 minutos. Además una
// diferencia puede ser una anulación legítima, y reescribir sin que nadie mire
// es peor que avisar.
//
// **Ámbito: el mes en curso y el anterior.** Son los dos que todavía se pueden
// corregir antes de declarar. Más atrás ya se presentó.
//
// **Costo.** `admin_compras_fecha_dt.php` con `length=1` devuelve
// `recordsFiltered` —el conteo exacto— sin traer una sola fila: **0.36s**
// medido. Con `length` alto trae también los totales por 2.4s en el peor mes
// (Bodega). Se piden los totales a propósito: sin ellos, una compra editada en
// el ERP —mismo conteo, otro monto— pasaría de largo.

const LOGIN_URL   = "https://clientesdte3.oss.com.sv/farma_salud/login.php";
const SESION_URL  = "https://clientesdte3.oss.com.sv/farma_salud/cambio_sesion.php";
const ADMIN_DT    = "https://clientesdte3.oss.com.sv/farma_salud/admin_compras_fecha_dt.php";

const BODEGA_BRANCH_ID = 30;
const BODEGA_ERP_ID    = 6;

// Mismo rol que check-sync-health-alerts: quien puede hacer algo con esto es
// sistemas, no las 59 personas del portal.
const SYSTEM_ALERT_ROLE_NAME = 'Sistema — Alertas Técnicas';

// Un centavo de diferencia en un mes de $200,000 es redondeo del ERP, no un
// documento faltante. Dos centavos ya no: son dos documentos o una edición.
const TOLERANCIA = 0.011;

function getPurchaseCreds(): { username: string; password: string } {
  const raw = Deno.env.get("ERP_PURCHASES_CREDS");
  if (!raw) throw new Error("ERP_PURCHASES_CREDS secret not configured.");
  return JSON.parse(raw);
}

function getPurchaseBranches(): { branchId: number; erpId: number }[] {
  const ventas = getErpBranchMap().map(b => ({ branchId: b.branchId, erpId: b.erpId }));
  const vistas = new Set<number>();
  return [{ branchId: BODEGA_BRANCH_ID, erpId: BODEGA_ERP_ID }, ...ventas]
    .filter(b => !vistas.has(b.branchId) && vistas.add(b.branchId));
}

async function getSessionCookie(username: string, password: string): Promise<string> {
  const res = await fetch(LOGIN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ username, password, m: '1' }).toString(),
    redirect: 'manual',
    signal: AbortSignal.timeout(20_000),
  });
  const cookie = res.headers.get('set-cookie')?.split(';')[0];
  if (!cookie) throw new Error('Login al ERP falló: no devolvió cookie');
  return cookie;
}

/**
 * Primer y último día del mes, desplazado `atras` meses, en hora de El Salvador.
 *
 * **El día de HOY se excluye siempre**, y no es una precaución: es la ventana
 * que `sync-purchases-10min` todavía está cubriendo. Sin este corte, una compra
 * capturada en el ERP hace cinco minutos aparece como faltante y dispara una
 * alerta que se cura sola en la próxima corrida del cron. Lo dio la primera
 * ejecución real: Bodega/agosto, ERP 11 contra portal 10, y el documento era
 * de ese mismo día.
 *
 * Devuelve `null` cuando el recorte deja el mes vacío — el día 1, el mes en
 * curso todavía no tiene nada que cuadrar.
 */
function rangoMes(atras: number): { desde: string; hasta: string; etiqueta: string } | null {
  const hoy = new Date(Date.now() - 6 * 3600_000);
  const y = hoy.getUTCFullYear();
  const m = hoy.getUTCMonth() - atras;
  const ini = new Date(Date.UTC(y, m, 1));
  const fin = new Date(Date.UTC(y, m + 1, 0));

  const ayer = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), hoy.getUTCDate() - 1));
  const tope = fin < ayer ? fin : ayer;
  if (tope < ini) return null;

  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { desde: iso(ini), hasta: iso(tope), etiqueta: iso(ini).slice(0, 7) };
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  if (!checkCronSecret(req)) {
    return new Response(JSON.stringify({ ok: false, error: "UNAUTHORIZED" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseUrl    = Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  try {
    const { username, password } = getPurchaseCreds();
    const cookie   = await getSessionCookie(username, password);
    const branches = getPurchaseBranches();
    const meses = [rangoMes(0), rangoMes(1)]
      .filter((r): r is { desde: string; hasta: string; etiqueta: string } => r !== null);
    if (meses.length === 0) {
      return new Response(JSON.stringify({ ok: true, revisados: 0, diferencias: 0, nota: 'nada cerrado que cuadrar' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const hallazgos: Array<{
      branchId: number; mes: string;
      erpN: number; portalN: number; erpTotal: number; portalTotal: number;
    }> = [];
    const revisados: any[] = [];

    for (const { branchId, erpId } of branches) {
      // La sucursal es estado de sesión en este endpoint, no parámetro.
      await fetch(SESION_URL, {
        method: 'POST',
        headers: { Cookie: cookie, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ process: 'set_sucursal', id_sucursal: String(erpId) }).toString(),
        signal: AbortSignal.timeout(20_000),
      });

      for (const { desde, hasta, etiqueta } of meses) {
        const url = `${ADMIN_DT}?fechai=${desde}&fechaf=${hasta}&draw=1&start=0&length=5000`;
        const res = await fetch(url, {
          headers: { Cookie: cookie, 'X-Requested-With': 'XMLHttpRequest' },
          signal: AbortSignal.timeout(60_000),
        });
        if (!res.ok) throw new Error(`admin_compras_fecha_dt HTTP ${res.status} (suc ${erpId}, ${etiqueta})`);
        const dt = await res.json();
        const filas: any[][] = dt?.data ?? [];
        const erpN     = Number(dt?.recordsFiltered ?? filas.length);
        const erpTotal = filas.reduce((s, f) => s + (Number(f[5]) || 0), 0);

        // A4/H14 (PLAN-CONTABILIDAD-2026-08-02): esto era un `.select()` pelado.
        // PostgREST corta en 1000 filas sin avisar, así que el día que una
        // sucursal-mes cruce ese número el cuadre compara 1000 contra las que
        // el ERP diga y reporta una diferencia que no existe — o sea, el
        // control que existe para detectar faltantes empieza a inventarlos.
        // Bodega ya va en 414 al mes. Se pagina con el helper del proyecto.
        //
        // El error del query NO se descarta: sin esto una consulta fallida
        // daría portalN = 0 y dispararía una alerta falsa por cada sucursal.
        let propias: any[];
        try {
          propias = await selectAllPaged<any>((from, to) => supabase
            .from('purchase_receipts')
            .select('total')
            .eq('branch_id', branchId)
            .gte('fecha', desde).lte('fecha', hasta)
            .order('id')
            .range(from, to));
        } catch (e) {
          throw new Error(`purchase_receipts (${branchId}, ${etiqueta}): ${(e as any)?.message ?? e}`);
        }

        const portalN     = propias.length;
        const portalTotal = propias.reduce((s, r: any) => s + (Number(r.total) || 0), 0);

        revisados.push({ branchId, mes: etiqueta, erpN, portalN });
        if (erpN !== portalN || Math.abs(erpTotal - portalTotal) > TOLERANCIA) {
          hallazgos.push({ branchId, mes: etiqueta, erpN, portalN, erpTotal, portalTotal });
        }
      }
    }

    if (hallazgos.length === 0) {
      return new Response(JSON.stringify({ ok: true, revisados: revisados.length, diferencias: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: roleRow } = await supabase
      .from('roles').select('id').eq('name', SYSTEM_ALERT_ROLE_NAME).maybeSingle();
    let recipientIds: string[] = [];
    if (roleRow?.id != null) {
      const { data: recipients } = await supabase
        .from('employees').select('id')
        .or(`role_id.eq.${roleRow.id},secondary_role_id.eq.${roleRow.id}`)
        .eq('status', 'ACTIVO');
      recipientIds = (recipients ?? []).map((e: { id: string }) => e.id);
    }

    let enviadas = 0;
    for (const h of hallazgos) {
      const faltan = h.erpN - h.portalN;
      const plata  = (h.erpTotal - h.portalTotal).toFixed(2);
      // La clave incluye la MEDIDA de la diferencia: mientras no cambie no se
      // reenvía, pero si crece —otro documento sin sincronizar— vuelve a
      // avisar en vez de quedarse callado por haber avisado ayer.
      const alertKey = `${h.erpN}-${h.erpTotal.toFixed(2)}`;

      const { data: inserted, error: logErr } = await supabase
        .from('sync_alert_log')
        .upsert(
          { domain: 'purchases-cuadre', scope_key: `${h.branchId}|${h.mes}`, alert_key: alertKey },
          { onConflict: 'domain,scope_key,alert_key', ignoreDuplicates: true },
        )
        .select('id');
      if (logErr) { console.error('sync_alert_log:', logErr); continue; }
      if (!inserted || inserted.length === 0) continue;   // ya se avisó

      if (recipientIds.length === 0) { enviadas++; continue; }

      const push = await fetch(`${supabaseUrl}/functions/v1/send-push-notification`, {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${Deno.env.get('ADMIN_INVOKE_SECRET') ?? ''}`,
          'x-cron-secret': Deno.env.get('CRON_INVOKE_SECRET') ?? '',
        },
        body: JSON.stringify({
          title: `Libro de compras no cuadra — ${h.mes}`,
          message: faltan !== 0
            ? `Sucursal ${h.branchId}: al portal le faltan ${faltan} documento(s) y $${plata} contra el ERP.`
            : `Sucursal ${h.branchId}: mismo conteo (${h.erpN}) pero $${plata} de diferencia — hay un documento editado en el ERP.`,
          url: '/libros-iva?tab=compras',
          urgent: false,
          target_type: 'EMPLOYEE',
          target_value: recipientIds,
          announcement_id: `compras-cuadre-${h.branchId}-${h.mes}-${alertKey}`,
        }),
      });
      if (push.ok) enviadas++;
      else console.error('push:', await push.text());
    }

    return new Response(
      JSON.stringify({ ok: true, revisados: revisados.length, diferencias: hallazgos.length, enviadas, hallazgos }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );

  } catch (err: any) {
    console.error('check-purchases-reconciliation:', err);
    return new Response(JSON.stringify({ error: String(err?.message ?? err) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
