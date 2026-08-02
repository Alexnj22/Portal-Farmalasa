import { createClient } from "npm:@supabase/supabase-js@2";
import { getCorsHeaders, requireInvokeSecret, getErpBranchMap } from "../_shared/security.ts";

// Cuadre diario de VENTAS contra el origen — el equivalente de
// `check-purchases-reconciliation`, que ya existía para compras y no para ventas.
//
// Por qué existe: el 2026-08-02, al comparar el libro contra el archivo del
// origen, apareció que al portal le faltaba una venta de $45.98 en la sucursal 4
// del 20-jun. **Un libro al que le falta un documento cuadra consigo mismo**: no
// hay error, los totales suman bien, simplemente suman un documento menos. Sólo
// se ve comparando contra afuera.
//
// Compara el libro de consumidor —una línea por día, con documentos y total— que
// es el que concentra el 99% del volumen. Es liviano: un CSV por sucursal-mes.
//
// Avisa, no arregla: recuperar el documento exige un `sync-dte-sales` de ese día,
// y una diferencia también puede ser una venta anulada legítimamente.

const BASE       = "https://clientesdte3.oss.com.sv/farma_salud/";
const LOGIN_URL  = `${BASE}login.php`;
const SESION_URL = `${BASE}cambio_sesion.php`;
const LIBRO      = `${BASE}libro_ventas_consumidor_csv.php`;

const SYSTEM_ALERT_ROLE_NAME = 'Sistema — Alertas Técnicas';

// Un centavo en un mes de $200,000 es redondeo; dos ya son un documento.
const TOLERANCIA = 0.011;

async function login(username: string, password: string): Promise<string> {
  const res = await fetch(LOGIN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ username, password, m: '1' }).toString(),
    redirect: 'manual', signal: AbortSignal.timeout(20_000),
  });
  const cookie = res.headers.get('set-cookie')?.split(';')[0];
  if (!cookie) throw new Error('login sin cookie');
  return cookie;
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (!requireInvokeSecret(req)) {
    return new Response(JSON.stringify({ ok: false, error: "UNAUTHORIZED" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const body = await req.json().catch(() => ({}));

    // Por defecto: mes en curso + anterior, EXCLUYENDO el día de hoy — el día
    // vivo todavía se está sincronizando y daría diferencias falsas todo el rato.
    const hoySV = new Date(Date.now() - 6 * 3600_000);
    const ayer  = new Date(hoySV.getTime() - 24 * 3600_000);
    const iso   = (d: Date) => d.toISOString().slice(0, 10);
    const desde = String(body.desde ?? iso(new Date(Date.UTC(
      ayer.getUTCFullYear(), ayer.getUTCMonth() - 1, 1))));
    const hasta = String(body.hasta ?? iso(ayer));
    const alertar = body.alertar !== false;

    const hallazgos: any[] = [];
    const revisados: any[] = [];

    for (const b of getErpBranchMap()) {
      const { branchId, erpId, username, password } = b as any;
      try {
        const cookie = await login(username, password);
        await fetch(SESION_URL, {
          method: 'POST',
          headers: { Cookie: cookie, 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ process: 'set_sucursal', id_sucursal: String(erpId) }).toString(),
          signal: AbortSignal.timeout(20_000),
        });

        const res = await fetch(`${LIBRO}?fechaInicio=${desde}&fechaFin=${hasta}`, {
          headers: { Cookie: cookie, 'X-Requested-With': 'XMLHttpRequest' },
          signal: AbortSignal.timeout(90_000),
        });
        const txt = (await res.text()).trim();
        if (/^\s*<(!doctype|html)/i.test(txt)) throw new Error(`HTTP ${res.status}: vino HTML`);

        // Columna 0 = fecha DD/MM/YYYY, 20 = total del día.
        const porDiaErp = new Map<string, number>();
        for (const linea of txt.split('\n')) {
          const c = linea.split(';');
          if (c.length < 21) continue;
          const [d, m, y] = (c[0] ?? '').trim().split('/');
          if (!y) continue;
          porDiaErp.set(`${y}-${m}-${d}`, Number(c[20]) || 0);
        }

        const { data: portal, error: errPortal } = await supabase
          .rpc('resumen_ventas_diario', { p_desde: desde, p_hasta: hasta, p_branch_id: branchId });
        if (errPortal) throw new Error(`resumen_ventas_diario: ${errPortal.message}`);

        const porDiaPortal = new Map<string, { docs: number; total: number }>();
        for (const f of (portal ?? []) as any[]) {
          porDiaPortal.set(String(f.fecha), { docs: Number(f.documentos), total: Number(f.total) });
        }

        // B2 (H5): se recorre la UNIÓN de los dos lados, no solo los días del
        // ERP. Antes, un día que existía en el portal y no en el origen era
        // invisible: el bucle nunca llegaba a él, así que una venta de más
        // —duplicada por un re-sync, o cargada con la fecha equivocada— no
        // producía ningún hallazgo. El cuadre solo sabía detectar faltantes,
        // que es la mitad de lo que un cuadre tiene que hacer.
        const dias = [...new Set([...porDiaErp.keys(), ...porDiaPortal.keys()])].sort();
        for (const dia of dias) {
          const totalErp    = porDiaErp.get(dia) ?? 0;
          const p           = porDiaPortal.get(dia);
          const totalPortal = p?.total ?? 0;
          const dif = Math.abs(totalErp - totalPortal);
          revisados.push({ branchId, dia });
          if (dif > TOLERANCIA) {
            hallazgos.push({ branchId, dia, totalErp, totalPortal,
                             diferencia: Number((totalErp - totalPortal).toFixed(2)),
                             enPortal: p ? p.docs : 0,
                             // Cuál de los dos lados no conoce el día: es lo
                             // primero que se pregunta al leer la alerta.
                             soloEn: !porDiaErp.has(dia) ? 'portal'
                                   : (!porDiaPortal.has(dia) ? 'ERP' : null) });
          }
        }
      } catch (e) {
        hallazgos.push({ branchId, error: (e as Error)?.message ?? String(e) });
      }
    }

    // — alerta, con el mismo patrón del cuadre de compras
    let enviadas = 0;
    const reales = hallazgos.filter(h => !h.error);
    if (alertar && reales.length > 0) {
      const { data: roleRow, error: errRole } = await supabase
        .from('roles').select('id').eq('name', SYSTEM_ALERT_ROLE_NAME).maybeSingle();
      if (errRole) console.error('roles:', errRole.message);

      let recipientIds: string[] = [];
      if (roleRow?.id != null) {
        const { data: recipients, error: errRecip } = await supabase
          .from('employees').select('id')
          .or(`role_id.eq.${roleRow.id},secondary_role_id.eq.${roleRow.id}`)
          .eq('status', 'ACTIVO');
        if (errRecip) console.error('employees:', errRecip.message);
        recipientIds = (recipients ?? []).map((e: { id: string }) => e.id);
      }

      for (const h of reales) {
        // La clave lleva la MEDIDA: si la diferencia crece, vuelve a avisar en
        // vez de callarse por haber avisado ayer.
        const alertKey = `${h.diferencia.toFixed(2)}`;
        const { data: inserted, error: errLog } = await supabase
          .from('sync_alert_log')
          .upsert({ domain: 'ventas-cuadre', scope_key: `${h.branchId}|${h.dia}`, alert_key: alertKey },
                  { onConflict: 'domain,scope_key,alert_key', ignoreDuplicates: true })
          .select('id');
        if (errLog) { console.error('sync_alert_log:', errLog.message); continue; }
        if (!inserted || inserted.length === 0) continue;
        if (recipientIds.length === 0) { enviadas++; continue; }

        const push = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/send-push-notification`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${Deno.env.get('ADMIN_INVOKE_SECRET') ?? ''}`,
            'x-cron-secret': Deno.env.get('CRON_INVOKE_SECRET') ?? '',
          },
          body: JSON.stringify({
            title: `Libro de ventas no cuadra — ${h.dia}`,
            message: `Sucursal ${h.branchId}: faltan $${Math.abs(h.diferencia).toFixed(2)} en el libro de ese día. Hay que resincronizarlo antes de declarar.`,
            url: '/libros-iva?tab=consumidor',
            urgent: false,
            target_type: 'EMPLOYEE',
            target_value: recipientIds,
            announcement_id: `ventas-cuadre-${h.branchId}-${h.dia}-${alertKey}`,
          }),
        });
        if (push.ok) enviadas++;
        else console.error('push:', await push.text());
      }
    }

    return new Response(JSON.stringify({
      ok: true, desde, hasta,
      dias_revisados: revisados.length,
      diferencias: reales.length,
      errores: hallazgos.filter(h => h.error).length,
      enviadas, hallazgos,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error('check-sales-reconciliation:', e);
    return new Response(JSON.stringify({ ok: false, error: (e as Error)?.message ?? String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
