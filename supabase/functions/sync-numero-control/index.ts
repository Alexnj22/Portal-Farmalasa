import { createClient } from "npm:@supabase/supabase-js@2";
import { getCorsHeaders, requireInvokeSecret } from "../_shared/security.ts";

// Completa `sales_invoices.numero_control` — el número de control fiscal del
// DTE, que es columna obligatoria de los libros de IVA de ventas.
//
// Por qué existe: `descarga_dte_emitidos_json.php` (el JSON del sync normal) NO
// trae ese dato, y NO es derivable del `correlativo` que sí guardamos — son dos
// contadores independientes y cada punto de venta corre su propia serie (medido
// el 2026-08-01: la diferencia entre ambos fue 39 en un documento y 103 en
// otro). El único origen es `dteqr_json.php`, que responde de a UN documento
// por llamada, buscado por `codigoGeneracion`.
//
// La misma función sirve para las dos cosas, y ésa es la idea:
//   · backfill histórico → invocarla en bucle hasta que `restantes` sea 0
//     (6,923 documentos desde 2025-05, ~25 min con concurrencia 8);
//   · mantenimiento diario → una sola corrida del cron, ~16 documentos, ~4s.
// Qué documentos hacen falta lo decide `get_docs_sin_numero_control` en la base,
// no este archivo: si mañana cambia un libro, cambia allá y los dos modos quedan
// alineados solos.

const DTEQR = "https://clientesdte3.oss.com.sv/farma_salud/downloads/dteqr_json.php";

// Mismo rol que el resto de las alertas técnicas: quien puede hacer algo con
// esto es sistemas, no las 59 personas del portal.
const SYSTEM_ALERT_ROLE_NAME = 'Sistema — Alertas Técnicas';

// Concurrencia contra el ERP del proveedor. Medido: con 6 en paralelo la
// latencia por documento se mantuvo en ~1.3s (12/12 de éxito), o sea que no se
// degrada. 8 es el techo que nos damos por prudencia — no es nuestro servidor.
const CONCURRENCIA_DEFAULT = 8;

// Margen contra el límite de 150s de una Edge Function. Al agotarse devuelve lo
// hecho y cuánto queda, en vez de morir con 504 y perder la cuenta.
const MAX_MS_DEFAULT = 110_000;

const LOTE_ESCRITURA = 200;

interface Doc { id: number; codigo_generacion: string; }
interface Traido { id: number; numero: string; }

/**
 * Un documento. Devuelve el numeroControl o el motivo del fallo.
 *
 * Valida el BODY y no el status: este endpoint responde 200 con cuerpo vacío
 * cuando no conoce el código de generación (probado con DTE de compra, 3/3).
 * Mirar sólo `res.ok` daría por bueno un documento que no vino — la misma
 * trampa que ya mordió en `sync-purchase-emails`.
 */
async function traerNumeroControl(cg: string): Promise<{ numero?: string; error?: string }> {
  let res: Response;
  try {
    res = await fetch(`${DTEQR}?codigoGeneracion=${encodeURIComponent(cg)}`, {
      signal: AbortSignal.timeout(30_000),
    });
  } catch (e) {
    return { error: `red: ${(e as Error)?.message ?? e}` };
  }
  if (!res.ok) return { error: `HTTP ${res.status}` };

  const texto = (await res.text()).trim();
  if (!texto) return { error: 'body vacio' };

  let dte: any;
  try {
    dte = JSON.parse(texto);
  } catch {
    return { error: 'no es JSON' };
  }

  const numero = dte?.identificacion?.numeroControl;
  if (typeof numero !== 'string' || !numero.trim()) return { error: 'sin numeroControl' };
  return { numero: numero.trim() };
}

/** Corre `tarea` sobre `items` con un tope de trabajos en vuelo. */
async function enParalelo<T, R>(
  items: T[], limite: number, tarea: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let siguiente = 0;
  const obreros = Array.from({ length: Math.min(limite, items.length) }, async () => {
    while (true) {
      const i = siguiente++;
      if (i >= items.length) return;
      out[i] = await tarea(items[i]);
    }
  });
  await Promise.all(obreros);
  return out;
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  if (!requireInvokeSecret(req)) {
    return new Response(JSON.stringify({ ok: false, error: "UNAUTHORIZED" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const t0 = Date.now();
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const body = await req.json().catch(() => ({}));
    const porRonda     = Math.min(Math.max(Number(body.limit) || 400, 1), 2000);
    const maxMs        = Math.min(Number(body.maxMs) || MAX_MS_DEFAULT, 140_000);
    const concurrencia = Math.min(Math.max(Number(body.concurrencia) || CONCURRENCIA_DEFAULT, 1), 12);
    const alertar      = body.alertar !== false;

    let traidos = 0, fallidos = 0, rondas = 0;
    const motivos: Record<string, number> = {};

    while (Date.now() - t0 < maxMs) {
      const { data: docs, error: errDocs } = await supabase
        .rpc('get_docs_sin_numero_control', { p_limit: porRonda });

      // Un select que falla en silencio deja el lote vacío y la función
      // reportaría "listo, no queda nada" con el trabajo sin hacer.
      if (errDocs) throw new Error(`get_docs_sin_numero_control: ${errDocs.message}`);
      if (!docs || docs.length === 0) break;

      rondas++;
      const resultados = await enParalelo<Doc, Traido | null>(
        docs as Doc[], concurrencia,
        async (d) => {
          const r = await traerNumeroControl(d.codigo_generacion);
          if (r.numero) return { id: d.id, numero: r.numero };
          motivos[r.error ?? 'desconocido'] = (motivos[r.error ?? 'desconocido'] ?? 0) + 1;
          return null;
        },
      );

      const ok = resultados.filter((r): r is Traido => r !== null);
      fallidos += resultados.length - ok.length;

      for (let i = 0; i < ok.length; i += LOTE_ESCRITURA) {
        const trozo = ok.slice(i, i + LOTE_ESCRITURA);
        const { data: tocadas, error: errSet } = await supabase.rpc('set_numero_control_batch', {
          p_ids:     trozo.map(t => t.id),
          p_numeros: trozo.map(t => t.numero),
        });
        if (errSet) throw new Error(`set_numero_control_batch: ${errSet.message}`);
        traidos += Number(tocadas ?? 0);
      }

      // Ronda entera fallida = el endpoint del proveedor se cayó. Seguir
      // martillándolo no lo va a resucitar.
      if (ok.length === 0) break;
    }

    // `count_…` y no `get_….length`: el segundo devuelve filas, y PostgREST las
    // trunca en 1000 sin avisar — con 7000 pendientes reportaría 1000 y el
    // bucle del backfill no sabría nunca si terminó.
    const { data: restantes, error: errCount } =
      await supabase.rpc('count_docs_sin_numero_control');
    if (errCount) throw new Error(`count_docs_sin_numero_control: ${errCount.message}`);

    // Avisar cuando falla, en vez de devolver 200 y dejar un libro incompleto
    // que nadie mira hasta que lo pide Hacienda. El umbral es "más de la mitad
    // del lote se cayó", que es la firma de un endpoint caído y no de un
    // documento raro suelto.
    const intentados = traidos + fallidos;
    let alertaEnviada = false;
    if (alertar && intentados >= 10 && fallidos > intentados / 2) {
      // El error de cada query se mira: si el lookup del rol falla en silencio,
      // `recipientIds` queda vacío y la alerta se da por enviada sin que la
      // reciba nadie — que es justo el modo de fallo que esta alerta existe
      // para evitar.
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

      // La clave lleva la MEDIDA: mientras el problema no cambie de tamaño no
      // se reenvía, pero si empeora vuelve a avisar en vez de callarse por
      // haber avisado ayer.
      const alertKey = `${fallidos}-${restantes}`;
      const { data: inserted, error: errLog } = await supabase
        .from('sync_alert_log')
        .upsert(
          { domain: 'numero-control', scope_key: new Date().toISOString().slice(0, 10), alert_key: alertKey },
          { onConflict: 'domain,scope_key,alert_key', ignoreDuplicates: true },
        )
        .select('id');
      if (errLog) console.error('sync_alert_log:', errLog.message);

      if (inserted && inserted.length > 0 && recipientIds.length > 0) {
        const detalle = Object.entries(motivos)
          .sort((a, b) => b[1] - a[1]).slice(0, 2)
          .map(([m, n]) => `${m} (${n})`).join(', ');
        const push = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/send-push-notification`, {
          method: 'POST',
          headers: {
            'Content-Type':  'application/json',
            'Authorization': `Bearer ${Deno.env.get('ADMIN_INVOKE_SECRET') ?? ''}`,
            'x-cron-secret': Deno.env.get('CRON_INVOKE_SECRET') ?? '',
          },
          body: JSON.stringify({
            title: 'Libros IVA: falta el número de control',
            message: `No se pudo traer el número de control de ${fallidos} documento(s) — ${detalle}. Quedan ${restantes} pendientes; los libros de ventas están incompletos.`,
            url: '/libros-iva?tab=anulados',
            urgent: false,
            target_type: 'EMPLOYEE',
            target_value: recipientIds,
            announcement_id: `numero-control-${alertKey}`,
          }),
        });
        alertaEnviada = push.ok;
        if (!push.ok) console.error('push:', await push.text());
      }
    }

    return new Response(
      JSON.stringify({
        ok: true, traidos, fallidos, restantes, rondas,
        motivos, alertaEnviada, ms: Date.now() - t0,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error('sync-numero-control:', e);
    return new Response(
      JSON.stringify({ ok: false, error: (e as Error)?.message ?? String(e), ms: Date.now() - t0 }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
