// @ts-nocheck — Las tablas `dist_*` todavía no existen en producción (viven en
// supabase/borradores/distribucion). Al migrar la distribuidora, se quita.
// Le manda al cliente su documento electrónico (borrador 0019).
//
// Hacienda exige entregarle al receptor el JSON —con firma y sello— y la
// representación gráfica. El JSON se arma ACÁ, desde la base: el navegador no
// puede mandar uno alterado. El PDF lo arma el navegador (pdfmake ya vive ahí
// y es el mismo que se descarga) y viaja en el pedido.
//
// Proveedor de salida: Resend (`RESEND_API_KEY` + `CORREO_REMITENTE`, p. ej.
// «Torogoz <facturas@dominio>», con el dominio verificado). Sin eso la función
// contesta «falta configurar» y NO marca nada como enviado.
//
// `CORREO_MODO=simulado` —sólo para el entorno de pruebas— registra el envío
// sin mandar nada, y acepta documentos todavía sin sello (en pruebas no hay
// credenciales de Hacienda: nada se sella). Con ambiente de producción ('01')
// el modo simulado se ignora.
//
// La llama el navegador con la sesión de quien envía: JWT encendido.
import { createClient } from "npm:@supabase/supabase-js@2";
import { getCorsHeaders, requireActiveEmployeeUser } from "../_shared/security.ts";

const TIPO = { "01": "Factura", "03": "Comprobante de Crédito Fiscal", "05": "Nota de Crédito" } as Record<string, string>;
const CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MAX_PDF = 6 * 1024 * 1024; // base64 de un PDF de pocas páginas; lo demás es un error

class ErrorUsuario extends Error {
  constructor(msg: string, readonly status = 400) { super(msg); }
}
const json = (req: Request, status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...getCorsHeaders(req), "Content-Type": "application/json" } });

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const dinero = (n: unknown) => `$${Number(n ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fecha = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const consultaPublica = (d: any) =>
  `https://admin.factura.gob.sv/consultaPublica?ambiente=${d.ambiente}&codGen=${String(d.codigo_generacion).toUpperCase()}&fechaEmi=${d.fec_emi}`;
const utf8b64 = (s: string) => {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};

function cuerpoHtml(d: any, emisor: any, cliente: any) {
  const tipo = TIPO[d.tipo] ?? "Documento electrónico";
  const filas = [
    ["Documento", tipo],
    ["Número de control", d.numero_control],
    ["Código de generación", String(d.codigo_generacion).toUpperCase()],
    ["Sello de recepción", d.sello_recibido ?? "—"],
    ["Fecha de emisión", fecha(d.fec_emi)],
    ["Total", dinero(d.total_pagar)],
  ];
  return `<!doctype html><html><body style="margin:0;padding:24px;background:#f4f6f8;font-family:Arial,Helvetica,sans-serif;color:#1c2430">
<table role="presentation" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;padding:24px" width="100%">
<tr><td>
<p style="margin:0 0 4px;font-size:13px;color:#5b6675">${esc(emisor.nombre_comercial || emisor.nombre)}</p>
<h1 style="margin:0 0 16px;font-size:20px">${esc(tipo)}</h1>
<p style="margin:0 0 16px;font-size:14px">Estimado cliente <b>${esc(cliente.nombre)}</b>: adjuntamos su documento electrónico
(archivo JSON y su representación gráfica en PDF).</p>
<table role="presentation" width="100%" style="border-collapse:collapse;font-size:13px">
${filas.map(([k, v]) => `<tr><td style="padding:6px 0;color:#5b6675;border-bottom:1px solid #eef1f4">${esc(k)}</td>
<td style="padding:6px 0;text-align:right;border-bottom:1px solid #eef1f4;font-family:monospace">${esc(v)}</td></tr>`).join("")}
</table>
<p style="margin:16px 0 0;font-size:13px">Puede verificarlo en el sitio de Hacienda:
<a href="${consultaPublica(d)}" style="color:#0f6e7d">consulta pública del documento</a>.</p>
<p style="margin:16px 0 0;font-size:12px;color:#8a94a3">${esc(emisor.nombre)} · NIT ${esc(emisor.nit)} · NRC ${esc(emisor.nrc)}${emisor.telefono ? ` · Tel. ${esc(emisor.telefono)}` : ""}</p>
</td></tr></table></body></html>`;
}

async function enviar(admin: any, empleadoId: string, cuerpo: any) {
  const dteId = Number(cuerpo?.dte_id);
  if (!Number.isInteger(dteId)) throw new ErrorUsuario("Falta el documento.");
  const pdf = typeof cuerpo?.pdf_base64 === "string" ? cuerpo.pdf_base64 : "";
  if (!pdf || pdf.length > MAX_PDF) throw new ErrorUsuario("Falta la representación gráfica (PDF) del documento.");

  const { data: d, error } = await admin.from("dist_dte")
    .select("id, emisor_id, cliente_id, tipo, ambiente, estado, codigo_generacion, numero_control, fec_emi, total_pagar, json, firmado, sello_recibido")
    .eq("id", dteId).single();
  if (error) throw new Error(`leer el documento: ${error.message}`);
  if (!d.json?.identificacion) throw new ErrorUsuario("Este documento no tiene guardado su archivo: no se puede enviar.");
  const simulado = Deno.env.get("CORREO_MODO") === "simulado" && d.ambiente !== "01";
  if (d.estado !== "sellado" && !simulado) {
    throw new ErrorUsuario("Hacienda todavía no lo selló: se envía cuando tenga el sello, que es lo que el cliente necesita.", 409);
  }
  const [emi, cli] = await Promise.all([
    admin.from("dist_emisores").select("nombre, nombre_comercial, nit, nrc, telefono, correo").eq("id", d.emisor_id).single(),
    admin.from("dist_clientes").select("nombre, correo").eq("id", d.cliente_id).single(),
  ]);
  for (const r of [emi, cli]) if (r.error) throw new Error(r.error.message);
  const destinatario = String(cuerpo?.destinatario ?? cli.data.correo ?? "").trim().toLowerCase();
  if (!CORREO.test(destinatario)) {
    throw new ErrorUsuario(destinatario ? `«${destinatario}» no parece un correo.` : "El cliente no tiene correo en su ficha: escríbelo para enviarlo.");
  }

  // El archivo del receptor: el DTE con su firma y su sello, como lo pide Hacienda.
  const archivo = { ...d.json, firmaElectronica: d.firmado ?? null, selloRecibido: d.sello_recibido ?? null };
  const nombre = String(d.codigo_generacion).toUpperCase();
  const asunto = `${TIPO[d.tipo] ?? "Documento electrónico"} ${d.numero_control} — ${emi.data.nombre_comercial || emi.data.nombre}`;

  let ok = false, proveedorId: string | null = null, falla: string | null = null;
  if (simulado) {
    ok = true; proveedorId = "simulado";
  } else {
    const llave = Deno.env.get("RESEND_API_KEY");
    const remitente = Deno.env.get("CORREO_REMITENTE");
    if (!llave || !remitente) {
      throw new ErrorUsuario("Falta configurar el correo de salida de la distribuidora (proveedor y remitente). Pídeselo a quien administra.", 503);
    }
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${llave}`, "Content-Type": "application/json", "Idempotency-Key": `dte-${d.id}-${destinatario}-${Date.now() >> 16}` },
      body: JSON.stringify({
        from: remitente, to: [destinatario], subject: asunto,
        reply_to: emi.data.correo || undefined,
        html: cuerpoHtml(d, emi.data, cli.data),
        attachments: [
          { filename: `${nombre}.json`, content: utf8b64(JSON.stringify(archivo, null, 2)) },
          { filename: `${nombre}.pdf`, content: pdf },
        ],
      }),
      signal: AbortSignal.timeout(30_000),
    }).catch((e) => ({ ok: false, status: 0, text: async () => (e as Error).message }) as any);
    const texto = await r.text();
    if (r.ok) {
      ok = true;
      try { proveedorId = JSON.parse(texto).id ?? null; } catch { /* sin id */ }
    } else {
      falla = `${r.status}: ${texto.slice(0, 300)}`;
    }
  }
  const { error: eR } = await admin.rpc("dist_registrar_correo", {
    p_dte: d.id, p_destinatario: destinatario, p_ok: ok, p_error: falla, p_proveedor_id: proveedorId, p_empleado: empleadoId,
  });
  if (eR) throw new Error(`registrar el envío: ${eR.message}`);
  if (!ok) throw new ErrorUsuario(`No se pudo enviar el correo (${falla}). Queda pendiente para reintentar.`, 502);
  return { enviado: true, destinatario, simulado };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: getCorsHeaders(req) });
  if (req.method !== "POST") return json(req, 405, { error: "método no permitido" });
  const url = Deno.env.get("SUPABASE_URL")!;
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const empleado = await requireActiveEmployeeUser(req, admin);
  if (!empleado) return json(req, 401, { error: "Sesión inválida o empleado inactivo" });
  const comoUsuario = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization")! } },
  });
  const { data: puede, error: ePerm } = await comoUsuario.rpc("auth_can_edit_any", { p_modules: ["distribucion"] });
  if (ePerm) return json(req, 500, { error: `permiso: ${ePerm.message}` });
  if (!puede) return json(req, 403, { error: "No tienes permiso para enviar documentos de la distribuidora" });
  let cuerpo: any;
  try { cuerpo = await req.json(); } catch { return json(req, 400, { error: "cuerpo inválido" }); }
  try {
    return json(req, 200, await enviar(admin, empleado.id, cuerpo));
  } catch (e) {
    if (e instanceof ErrorUsuario) return json(req, e.status, { error: e.message });
    console.error("distribucion-correo", e);
    return json(req, 500, { error: (e as Error).message });
  }
});
