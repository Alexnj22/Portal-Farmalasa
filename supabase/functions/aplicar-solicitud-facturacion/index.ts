import { createClient } from "npm:@supabase/supabase-js@2";
import { getCorsHeaders, requireActiveEmployeeUser } from "../_shared/security.ts";

// Aplica en el ERP la solicitud que el supervisor acaba de aprobar.
//
// Hasta ahora aprobar una solicitud de facturación no hacía NADA fuera del
// portal: `_runFinalApproval` marcaba APPROVED, notificaba y terminaba. Alguien
// tenía que ir al ERP a repetir el cambio a mano, y nada garantizaba que lo
// hiciera ni que lo hiciera igual.
//
// ── Por qué acá y no en el navegador ───────────────────────────────────────
// El ERP se maneja con usuario/contraseña y cookie de sesión PHP. Esas
// credenciales viven en un secreto de Supabase y no pueden viajar al
// navegador — quien tiene la sesión del ERP puede anular cualquier factura de
// cualquier sucursal, no solo la de su solicitud.
//
// ── El orden importa: primero el ERP, después APPROVED ─────────────────────
// Si se marcara APPROVED antes y el ERP fallara, quedaría una solicitud que
// dice "aplicada" sobre una factura intacta — y nadie volvería a mirarla. Acá
// el ERP manda: si no entra, la solicitud sigue PENDING y el supervisor ve el
// error. APPROVED significa siempre "ya está hecho en el ERP".
//
// ── Lo que no se puede olvidar del ERP (ver push-cliente-erp) ──────────────
//  1. Contesta HTTP 200 con {"typeinfo":"Error"} cuando rechaza. Un rechazo
//     silencioso se ve igual que un éxito si no se lee el cuerpo.
//  2. `cambiar_cod` y `cambiar` devuelven el MISMO texto ("Numero
//     actualizado"), así que el mensaje no distingue qué se cambió. Por eso el
//     resultado NO se da por bueno hasta releer la ficha y comparar.
//  3. Se cae solo a veces y el mismo payload entra al reintentarlo.
//
// ── El id que va al ERP no es el id del portal ─────────────────────────────
// `metadata.invoice_id` es `sales_invoices.id` (ej. 6661083). El ERP espera su
// propio id (`erp_invoice_id`, ej. 345608). Mandar el del portal apuntaría a
// OTRA factura existente, no daría error. La traducción es obligatoria.

const BASE      = "https://clientesdte3.oss.com.sv/farma_salud";
const LOGIN_URL = `${BASE}/login.php`;
const REIMPRIMIR = `${BASE}/reimprimir_factura.php`;

const TIPOS_SOPORTADOS = new Set([
  "PAYMENT_CHANGE_REQUEST",
  "VENDOR_CHANGE_REQUEST",
  "CLIENT_CHANGE_REQUEST",
]);

// El `credito` del ERP es un índice, no el nombre. Leído del <select> de
// reimprimir_factura.php el 2026-08-05.
const PAGO_A_ERP: Record<string, string> = {
  efectivo: "0", credito: "1", tarjeta: "2",
  cheque: "3", bitcoin: "4", transferencia: "5",
};
const ERP_A_PAGO: Record<string, string> = Object.fromEntries(
  Object.entries(PAGO_A_ERP).map(([k, v]) => [v, k]),
);

// Llave propia y no la del sync de compras: ese usuario existe para otro
// módulo y esto escribe sobre facturas emitidas. Separarlas permite rotar una
// sin tocar los otros syncs, y deja en el log del ERP quién hizo qué.
function getCreds(): { username: string; password: string } {
  const raw = Deno.env.get("ERP_FACTURACION_CREDS") ?? Deno.env.get("ERP_PURCHASES_CREDS");
  if (!raw) throw new Error("Falta el secreto ERP_FACTURACION_CREDS.");
  return JSON.parse(raw);
}

async function login(): Promise<string> {
  const { username, password } = getCreds();
  const res = await fetch(LOGIN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username, password, m: "1" }).toString(),
    redirect: "manual",                       // la cookie viaja en el 302
    signal: AbortSignal.timeout(20_000),
  });
  const cookie = res.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) throw new Error("El ERP no devolvió cookie de sesión.");
  return cookie;
}

async function conReintento<T>(fn: () => Promise<T>, veces = 3, pausaMs = 1500): Promise<T> {
  let ultimo: unknown;
  for (let i = 0; i < veces; i++) {
    try { return await fn(); } catch (e) {
      ultimo = e;
      if (i < veces - 1) await new Promise(r => setTimeout(r, pausaMs * (i + 1)));
    }
  }
  throw ultimo;
}

async function pedir(cookie: string, url: string, datos?: URLSearchParams): Promise<string> {
  return await conReintento(async () => {
    const res = await fetch(url, {
      method: datos ? "POST" : "GET",
      headers: {
        Cookie: cookie,
        "User-Agent": "Mozilla/5.0",
        "X-Requested-With": "XMLHttpRequest",
        Referer: `${BASE}/admin_factura_rangos.php`,
        ...(datos ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
      },
      body: datos?.toString(),
      signal: AbortSignal.timeout(45_000),
    });
    const texto = await res.text();
    if (/name\s*=\s*["']password/i.test(texto.slice(0, 4000)))
      throw new Error("La sesión del ERP caducó (devolvió el login).");
    return texto;
  });
}

/** Estado de los tres campos editables, leído de la pantalla del ERP. */
type Ficha = { cliente: string | null; clienteNombre: string; credito: string | null; vendedor: string | null };

function parsearFicha(html: string): Ficha {
  const cli = html.match(/id="id_cliente"[\s\S]*?<option value='(\d+)'\s+selected>\s*([^<]*?)\s*<\/option>/);
  const selCred = html.match(/id="credito"([\s\S]*?)<\/select>/);
  const cred = selCred?.[1].match(/<option value="(\d)"\s+selected>/);
  const vend = html.match(/Cod\. Vendedor<\/label>[\s\S]*?<input[^>]*value="([^"]*)"/);
  return {
    cliente: cli?.[1] ?? null,
    clienteNombre: cli?.[2] ?? "",
    credito: cred?.[1] ?? null,
    vendedor: vend?.[1] ?? null,
  };
}

async function leerFicha(cookie: string, erpId: string): Promise<Ficha> {
  const html = await pedir(cookie, `${REIMPRIMIR}?id_factura=${encodeURIComponent(erpId)}`);
  const ficha = parsearFicha(html);
  if (ficha.cliente === null && ficha.credito === null && ficha.vendedor === null)
    throw new Error(`El ERP no devolvió la ficha de la factura ${erpId}.`);
  return ficha;
}

/** Lee el `{typeinfo,msg}` del ERP. Un rechazo llega con HTTP 200. */
function leerRespuesta(cuerpo: string): { ok: boolean; msg: string } {
  try {
    const j = JSON.parse(cuerpo);
    return { ok: String(j.typeinfo).toLowerCase() === "success", msg: String(j.msg ?? "") };
  } catch {
    return { ok: false, msg: `Respuesta ilegible del ERP: ${cuerpo.slice(0, 200)}` };
  }
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  try {
    // `approver_note` es contenido, no identidad: se acepta del cliente. Quién
    // aprueba sale del JWT y no se recibe nunca por parámetro.
    const { request_id, approver_note } = await req.json().catch(() => ({}));
    if (!request_id) return json({ ok: false, error: "Falta request_id." }, 400);

    // ── Quién llama. Nunca del payload: del JWT. ──────────────────────────
    const aprobador = await requireActiveEmployeeUser(req, admin);
    if (!aprobador) return json({ ok: false, error: "Sesión inválida o empleado inactivo." }, 401);

    // ── Y si puede aprobar. El cliente no opina sobre esto. ───────────────
    const { data: emp } = await admin
      .from("employees").select("role_id").eq("id", aprobador.id).maybeSingle();
    const { data: permiso } = await admin
      .from("role_permissions")
      .select("can_approve")
      .eq("role_id", emp?.role_id ?? -1)
      .eq("module_key", "requests")
      .maybeSingle();
    if (!permiso?.can_approve)
      return json({ ok: false, error: "No tenés permiso para aprobar solicitudes." }, 403);

    // ── La solicitud se relee de la BD, no se recibe ──────────────────────
    const { data: sol, error: solErr } = await admin
      .from("approval_requests")
      .select("id, type, status, employee_id, metadata")
      .eq("id", request_id)
      .maybeSingle();
    if (solErr) throw solErr;
    if (!sol) return json({ ok: false, error: "La solicitud no existe." }, 404);

    if (!TIPOS_SOPORTADOS.has(sol.type)) {
      // ANNULMENT_REQUEST cae acá a propósito: anular en el ERP sin anular
      // después en Hacienda deja la factura muerta en el portal y viva ante el
      // MH — exactamente la divergencia que este módulo existe para detectar.
      // Va aparte, con su paso de Hacienda, no colgado de este.
      return json({
        ok: false,
        codigo: "TIPO_NO_AUTOMATIZADO",
        error: sol.type === "ANNULMENT_REQUEST"
          ? "La anulación todavía se aplica a mano: arrastra la anulación ante Hacienda."
          : `El tipo ${sol.type} no se aplica desde acá.`,
      }, 422);
    }
    if (sol.status !== "PENDING")
      return json({ ok: false, error: `La solicitud ya está ${sol.status}.` }, 409);

    const meta = (typeof sol.metadata === "string" ? JSON.parse(sol.metadata) : sol.metadata) ?? {};

    // ── id del portal → id del ERP ───────────────────────────────────────
    const { data: factura, error: facErr } = await admin
      .from("sales_invoices")
      .select("id, erp_invoice_id, correlativo, branch_id, estado")
      .eq("id", meta.invoice_id)
      .maybeSingle();
    if (facErr) throw facErr;
    if (!factura) return json({ ok: false, error: "La factura de la solicitud ya no existe." }, 404);
    if (!factura.erp_invoice_id)
      return json({ ok: false, error: "La factura no tiene número interno: no se puede ubicar." }, 422);
    if (factura.estado === "NULA")
      return json({ ok: false, error: "La factura ya está anulada." }, 409);

    const erpId = String(factura.erp_invoice_id);

    // ── ERP: leer, aplicar, releer ───────────────────────────────────────
    const cookie = await login();
    const antes  = await leerFicha(cookie, erpId);

    let campo = "", de = "", a = "", cuerpo = "";

    if (sol.type === "CLIENT_CHANGE_REQUEST") {
      campo = "cliente";
      de = String(antes.cliente ?? "");
      // SIN fallback a `new_client_id` a propósito: ese es el id del portal y
      // el ERP lo aceptaría como si fuera suyo, cambiando la factura a OTRO
      // cliente sin devolver error. Es la misma trampa que el id de la factura.
      a  = String(meta.new_client_erp_id ?? "");
      if (!a) return json({
        ok: false,
        error: "El cliente elegido no tiene número interno, no se puede aplicar el cambio.",
      }, 422);
      // `cambiar_datos` manda cliente Y pago juntos: el que no cambia viaja con
      // su valor ACTUAL leído recién, no con el que traía la solicitud. Si no,
      // aplicar un cambio de cliente pisaría un cambio de pago hecho en el
      // medio por otra persona.
      cuerpo = await pedir(cookie, REIMPRIMIR, new URLSearchParams({
        process: "cambiar_datos", id_cliente: a,
        credito: String(antes.credito ?? "0"), id_factura: erpId,
      }));
    }

    if (sol.type === "PAYMENT_CHANGE_REQUEST") {
      campo = "tipo_pago";
      de = String(antes.credito ?? "");
      const destino = PAGO_A_ERP[String(meta.new_pago ?? "").toLowerCase()];
      if (!destino) return json({ ok: false, error: `Forma de pago desconocida: ${meta.new_pago}` }, 422);
      a = destino;
      cuerpo = await pedir(cookie, REIMPRIMIR, new URLSearchParams({
        process: "cambiar_datos", id_cliente: String(antes.cliente ?? ""),
        credito: destino, id_factura: erpId,
      }));
    }

    if (sol.type === "VENDOR_CHANGE_REQUEST") {
      campo = "cod_vendedor";
      de = String(antes.vendedor ?? "");
      a  = String(meta.new_vendor_code ?? "");
      if (!a) return json({ ok: false, error: "La solicitud no trae el vendedor destino." }, 422);
      // OJO: el parámetro se llama `numero_doc` aunque lleve el código de
      // vendedor. Es del ERP, no un error de acá.
      cuerpo = await pedir(cookie, REIMPRIMIR, new URLSearchParams({
        process: "cambiar_cod", numero_doc: a, id_factura: erpId,
      }));
    }

    const resp = leerRespuesta(cuerpo);
    if (!resp.ok) return json({ ok: false, error: `El ERP rechazó el cambio: ${resp.msg}` }, 502);

    // El mensaje del ERP no distingue qué cambió — se comprueba releyendo.
    const despues = await leerFicha(cookie, erpId);
    const quedo = campo === "cliente" ? despues.cliente
                : campo === "tipo_pago" ? despues.credito
                : despues.vendedor;
    if (String(quedo) !== String(a))
      return json({
        ok: false,
        error: `El ERP contestó «${resp.msg}» pero la factura quedó en «${quedo}», no en «${a}».`,
      }, 502);

    // ── Recién ahora la solicitud es APPROVED ────────────────────────────
    const aplicado = {
      at: new Date().toISOString(),
      by: aprobador.id, by_name: aprobador.name,
      erp_invoice_id: erpId, correlativo: factura.correlativo,
      campo,
      de: campo === "tipo_pago" ? (ERP_A_PAGO[de] ?? de) : de,
      a:  campo === "tipo_pago" ? (ERP_A_PAGO[a] ?? a) : a,
      cliente_nombre: campo === "cliente" ? despues.clienteNombre : undefined,
    };

    const { error: updErr } = await admin
      .from("approval_requests")
      .update({
        status: "APPROVED",
        approver_id: aprobador.id,
        approver_note: typeof approver_note === "string" && approver_note.trim()
          ? approver_note.trim() : null,
        metadata: { ...meta, erp_aplicado: aplicado },
        updated_at: new Date().toISOString(),
      })
      .eq("id", sol.id)
      .eq("status", "PENDING");          // no pisar si otro la resolvió en el medio
    if (updErr) throw updErr;

    return json({ ok: true, aplicado });

  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
