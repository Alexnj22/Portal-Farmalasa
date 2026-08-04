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
const EMITIDOS   = `${BASE}descarga_dte_emitidos_json.php`;
const DTE_JSON   = `${BASE}downloads/dteqr_json.php`;
const DTE_PDF    = `${BASE}downloads/dteqr_pdf.php`;

const SYSTEM_ALERT_ROLE_NAME = 'Sistema — Alertas Técnicas';

// Un centavo en un mes de $200,000 es redondeo; dos ya son un documento.
const TOLERANCIA = 0.011;

// ── El diagnóstico ──────────────────────────────────────────────────────────
//
// Encontrar el día era la mitad. La otra mitad —bajar al documento y decir POR
// QUÉ— se hizo a mano el 2026-08-03 para la diferencia de $9.00 de Salud 1 del
// 14/07, y resultó que cada paso es mecánico. Ver
// `docs/HALLAZGO-VENTA-PERDIDA-SALUD1-2026-07-14.md`.
//
// Importa porque el aviso recetaba una cura equivocada: decía «hay que
// resincronizar» y en ese caso resincronizar no servía de nada — el que había
// perdido el registro era el origen.
//
// Lo que distingue las causas, y cada regla salió de datos reales:
//
//   · está en el origen y no en el portal  → el sync lo perdió: resincronizar
//   · está en los dos, el portal sin sello → el sello todavía no llegó; se
//     corrige solo (medido: cero pendientes de más de 3 días en el período)
//   · solo en el portal, y su estado es anulado → correcto, el libro lo excluye
//   · solo en el portal, `dteqr_json` vuelve VACÍO → el DTE no existe
//   · solo en el portal, el DTE existe pero `dteqr_pdf` NO devuelve un PDF →
//     **el origen perdió la fila de su base**: su generador la busca y no está
//     (contesta `Undefined offset: 0`). Resincronizar no la trae; hay que
//     reportarlo.
//
// Solo corre sobre los días que YA difieren —cuatro en dos meses— así que el
// costo es una petición por día más dos chicas por documento sospechoso.
const soloDigitos = (s: unknown) => String(s ?? '').replace(/\D/g, '');
const selloOk = (v: unknown) => typeof v === 'string' && v.length === 40;
const ANULADOS = new Set(['NULA', 'DTE INVALIDADO EN MH']);

async function cuerpo(url: string): Promise<Uint8Array | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) return null;
    const b = new Uint8Array(await res.arrayBuffer());
    return b.byteLength === 0 ? null : b;
  } catch { return null; }
}

// El DTE se pide por `codigo_generacion` a los dos endpoints públicos. Ojo: el
// del JSON contesta **200 con body vacío** cuando el documento no es nuestro,
// así que se valida el contenido y no el status.
async function veredictoDelDte(cg: string): Promise<{ causa: string; detalle: string }> {
  const json = await cuerpo(`${DTE_JSON}?codigoGeneracion=${cg.toUpperCase()}`);
  if (!json) return { causa: 'dte_inexistente', detalle: 'El documento no existe en el origen ni en Hacienda.' };
  let sellado = false;
  try {
    const j = JSON.parse(new TextDecoder().decode(json));
    sellado = Boolean(j?.identificacion?.numeroControl);
  } catch { /* si no parsea, no es un DTE */ }
  if (!sellado) return { causa: 'dte_inexistente', detalle: 'El origen no devuelve un DTE válido para este documento.' };

  const pdf = await cuerpo(`${DTE_PDF}?codigoGeneracion=${cg.toUpperCase()}`);
  const esPdf = pdf !== null && pdf.byteLength > 4 &&
                pdf[0] === 0x25 && pdf[1] === 0x50 && pdf[2] === 0x44 && pdf[3] === 0x46;
  if (!esPdf) {
    return { causa: 'origen_perdio_fila',
             detalle: 'La venta existe y está sellada por Hacienda, pero el origen ya no tiene su registro: no puede ni generarle el documento. Resincronizar no la recupera — hay que reportarlo al proveedor.' };
  }
  return { causa: 'sin_clasificar',
           detalle: 'El documento existe y el origen puede generarlo, pero no aparece en su listado del día.' };
}

// Qué cuenta cada lado en su libro. **No usan el mismo criterio, y esa es
// justamente una de las causas** — medirlos con la misma regla escondería la
// diferencia en vez de explicarla.
//
//   · el portal exige FINALIZADA + sello
//   · el origen exige sello y excluye SOLO lo invalidado ante Hacienda, así que
//     **cuenta lo que marcó `NULA` localmente**
//
// Verificado en tres días de tres sucursales (2026-08-01 y 02): el exceso del
// libro del origen es exactamente el documento `NULA` del día, al centavo. Y en
// el 14/07 de Salud 1, donde no hubo ninguno, las dos reglas dan lo mismo.
const INVALIDADO_MH = 'DTE INVALIDADO EN MH';
const enLibroErp = (v: any) =>
  String(v?.correlativo ?? '').endsWith('COF') && v?.estado !== INVALIDADO_MH && selloOk(v?.recibido_mh);
const enLibroPortal = (r: any) =>
  r?.tipo_documento === 'COF' && r?.estado === 'FINALIZADA' && selloOk(r?.recibido_mh);

// Tope de consultas al DTE por día. Un día con 25 sobrantes ya no es «un
// documento perdido», es otra cosa, y no se arregla preguntando de a uno.
const MAX_DTE = 25;

// Qué hacer, en una línea, para el aviso. Manda la causa de MAYOR impacto: si un
// día tiene un documento perdido de $60 y uno sin sello de $2, lo que hay que
// hacer lo decide el de $60.
const QUE_HACER: Record<string, string> = {
  falta_en_portal:    'Falta en el portal: se recupera resincronizando ese día.',
  sin_sello:          'Es el sello de Hacienda, que todavía no llega. Se corrige solo.',
  origen_perdio_fila: 'El origen perdió el registro de una venta que sí existe y está sellada. Resincronizar NO la recupera: hay que reportarlo.',
  anulado:            'Es un documento anulado; el libro lo excluye con razón.',
  anulado_sin_invalidar: 'Hay una venta con sello de Hacienda que se anuló en el sistema pero NUNCA se invalidó ante Hacienda: sigue vigente y el libro debería llevarla.',
  dte_inexistente:    'Hay un documento en el portal cuyo DTE no existe en el origen. Hay que revisarlo.',
  monto_distinto:     'Un documento tiene montos distintos en cada lado.',
  sin_clasificar:     'No se pudo determinar la causa; hay que revisarlo a mano.',
};

function resumenCausa(h: any): string {
  if (h.diagnostico_error) return 'No se pudo diagnosticar la causa automáticamente.';
  const docs: any[] = h.documentos ?? [];
  if (docs.length === 0) return 'No se encontró ningún documento que la explique.';
  const porCausa = new Map<string, number>();
  for (const d of docs) porCausa.set(d.causa, (porCausa.get(d.causa) ?? 0) + Math.abs(d.impacto));
  const [causa] = [...porCausa.entries()].sort((x, y) => y[1] - x[1])[0];
  const cola = Math.abs(h.sin_explicar ?? 0) >= 0.005
    ? ` Quedan $${Math.abs(h.sin_explicar).toFixed(2)} sin explicar.` : '';
  return (QUE_HACER[causa] ?? QUE_HACER.sin_clasificar) + cola;
}

async function diagnosticarDia(
  supabase: any, cookie: string, branchId: number, erpId: number,
  dia: string, diferencia: number,
) {
  const res = await fetch(`${EMITIDOS}?fini=${dia}&ffin=${dia}&id_sucursal=${erpId}`, {
    headers: { Cookie: cookie }, signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error(`listado del día: HTTP ${res.status}`);
  const delErp: any[] = (await res.json())?.ventas ?? [];

  // Paginado explícito: PostgREST corta en 1000 filas sin avisar, y acá eso no
  // sería «faltan datos» sino un diagnóstico AL REVÉS — los documentos que la
  // consulta no vio se reportarían como «el portal no lo tiene». Hoy el día más
  // cargado ronda los 170 documentos por sucursal, pero el día que cruce el
  // tope el error sería silencioso y creíble.
  const delPortal: any[] = [];
  const PAG = 500;
  for (let desde = 0; ; desde += PAG) {
    const { data, error } = await supabase
      .from('sales_invoices')
      .select('erp_invoice_id, correlativo, tipo_documento, estado, recibido_mh, total, codigo_generacion')
      .eq('branch_id', branchId).eq('fecha', dia)
      .order('erp_invoice_id')
      .range(desde, desde + PAG - 1);
    if (error) throw new Error(`sales_invoices: ${error.message}`);
    delPortal.push(...(data ?? []));
    if (!data || data.length < PAG) break;
  }

  const a = new Map<string, any>(delErp.map(v => [String(v.id_factura), v]));
  const b = new Map<string, any>((delPortal ?? []).map((r: any) => [String(r.erp_invoice_id), r]));

  const documentos: any[] = [];
  let explicado = 0, consultasDte = 0;

  for (const id of [...new Set([...a.keys(), ...b.keys()])].sort((x, y) => Number(x) - Number(y))) {
    const A = a.get(id), B = b.get(id);
    const inA = enLibroErp(A), inB = enLibroPortal(B);
    const tA = inA ? Number(A?.totales?.total ?? 0) : 0;
    const tB = inB ? Number(B?.total ?? 0) : 0;
    const impacto = Number((tA - tB).toFixed(2));
    if (Math.abs(impacto) < 0.005) continue;

    let causa = 'sin_clasificar', detalle = '';
    if (!B) {
      causa = 'falta_en_portal';
      detalle = 'El origen lo tiene y el portal no. Se recupera resincronizando ese día.';
    } else if (!A) {
      if (ANULADOS.has(B.estado)) {
        causa = 'anulado';
        detalle = 'Anulado ante Hacienda; el libro lo excluye con razón.';
      } else if (consultasDte < MAX_DTE && B.codigo_generacion) {
        consultasDte++;
        ({ causa, detalle } = await veredictoDelDte(String(B.codigo_generacion)));
      } else {
        detalle = 'Solo está en el portal. No se consultó el DTE (tope de consultas del día).';
      }
    } else if (inA && !inB) {
      if (!selloOk(B.recibido_mh)) {
        causa = 'sin_sello';
        detalle = 'El portal lo tiene, pero todavía sin el sello de Hacienda, así que no entra al libro. Se corrige solo cuando el sello llega.';
      } else if (B.estado === 'NULA') {
        // Sellado y NO invalidado ante Hacienda: para Hacienda la venta sigue
        // vigente. El origen lo cuenta en su libro y el portal no, porque el
        // portal filtra por FINALIZADA. Y no es un estado de paso: hay
        // documentos así de hace once meses.
        causa = 'anulado_sin_invalidar';
        detalle = 'La venta tiene sello de Hacienda y NO fue invalidada ante Hacienda (no está en el anexo de anulados): para Hacienda sigue vigente. El origen la cuenta en su libro; el portal la excluye porque quedó marcada como anulada. Hay que invalidarla como corresponde o incluirla.';
      } else if (ANULADOS.has(B.estado)) {
        causa = 'anulado';
        detalle = 'El portal lo tiene como anulado y el origen no.';
      } else {
        detalle = `El portal lo tiene en estado ${B.estado} y el origen lo cuenta en el libro.`;
      }
    } else if (!inA && inB) {
      causa = ANULADOS.has(A.estado) ? 'anulado' : 'sin_clasificar';
      detalle = ANULADOS.has(A.estado)
        ? 'El origen lo anuló y el portal todavía no lo sabe. Se corrige resincronizando ese día.'
        : `El origen lo tiene en estado ${A.estado} y no lo cuenta en el libro.`;
    } else {
      causa = 'monto_distinto';
      detalle = `El origen dice $${tA.toFixed(2)} y el portal $${tB.toFixed(2)}.`;
    }

    explicado += impacto;
    documentos.push({
      erp_invoice_id: id,
      correlativo: soloDigitos(A?.correlativo ?? B?.correlativo),
      codigo_generacion: (B?.codigo_generacion ?? A?.codigo_generacion ?? null),
      total: Number((tA || tB).toFixed(2)),
      impacto, causa, detalle,
    });
  }

  // Lo que las causas encontradas NO explican. Se guarda en vez de esconderse:
  // un diagnóstico que dice «ya está» sobre una diferencia que sigue abierta es
  // peor que no diagnosticar.
  return { documentos, sin_explicar: Number((diferencia - explicado).toFixed(2)) };
}

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
            const diferencia = Number((totalErp - totalPortal).toFixed(2));
            const h: any = { branchId, dia, totalErp, totalPortal, diferencia,
                             enPortal: p ? p.docs : 0,
                             // Cuál de los dos lados no conoce el día: es lo
                             // primero que se pregunta al leer la alerta.
                             soloEn: !porDiaErp.has(dia) ? 'portal'
                                   : (!porDiaPortal.has(dia) ? 'ERP' : null) };
            // El diagnóstico no puede tumbar el cuadre: si el origen no
            // contesta el listado del día, el hallazgo igual vale y se avisa.
            try {
              const d = await diagnosticarDia(supabase, cookie, branchId, erpId, dia, diferencia);
              h.documentos = d.documentos;
              h.sin_explicar = d.sin_explicar;
              await supabase.from('ventas_cuadre_hallazgos').upsert({
                branch_id: branchId, fecha: dia,
                total_erp: totalErp, total_portal: totalPortal, diferencia,
                sin_explicar: d.sin_explicar, documentos: d.documentos,
                diagnosticado_at: new Date().toISOString(), resuelto_at: null,
              }, { onConflict: 'branch_id,fecha' });
            } catch (e) {
              h.diagnostico_error = (e as Error)?.message ?? String(e);
            }
            hallazgos.push(h);
          } else {
            // El día cuadra: si tenía un hallazgo abierto, queda cerrado. Sin
            // esto un día ya resuelto se explicaría para siempre en la pantalla.
            await supabase.from('ventas_cuadre_hallazgos')
              .update({ resuelto_at: new Date().toISOString() })
              .eq('branch_id', branchId).eq('fecha', dia).is('resuelto_at', null);
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
            // El aviso dice la CAUSA, no una receta genérica. Antes decía
            // siempre «hay que resincronizar», y en el caso de Salud 1 del
            // 14/07 resincronizar no servía de nada: el que había perdido el
            // registro era el origen.
            message: `Sucursal ${h.branchId}: $${Math.abs(h.diferencia).toFixed(2)} de diferencia. ${resumenCausa(h)}`,
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
