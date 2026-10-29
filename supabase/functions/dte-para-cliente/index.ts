// dte-para-cliente — el documento electrónico de una venta, para el cliente
// que lo pide en la sala (2026-10-19).
//
// POST { accion: "descargar" | "correo" | "correo_de_ficha", invoice_id, correo? }
// con la sesión de quien atiende (verify_jwt ON). Devuelve:
//   descargar       → { ok, archivos: [{ nombre, tipo, base64 }], se_envio }
//   correo          → { ok, correo, se_envio }
//   correo_de_ficha → { ok, correo | null }  — sólo lee, para proponerlo en el
//                     campo. Va por acá y no por el navegador porque la ficha
//                     (`customers`) sólo la ve quien tiene Clientes, y la sala
//                     no lo tiene: leída desde el frente volvería vacía, sin error.
//
// ── Por qué existe ──────────────────────────────────────────────────────────
// Desde el 2026-10-19 el COF emitido de las 6:00 p. m. en adelante no se
// envía a Hacienda (`cof_no_se_envia_mh`). Pero el documento es del cliente
// por ley, y si lo pide no se le niega. Pedido del usuario: «que desde el
// portal los dependientes puedan solicitar, eso hará que se envíe al MH, se
// firme, y puedan descargar o enviar a un correo el DTE + json». Directo, sin
// aprobación: el cliente está enfrente.
//
// ── Qué hace ────────────────────────────────────────────────────────────────
// 1. Si la venta no tiene sello válido, la manda a Hacienda por
//    `regularizar-dte` (alcance «una», con `forzar_cof_noche`, que sólo se le
//    acepta al servidor). `regularizar-dte` relee la fecha después de enviar,
//    así que al volver el sello ya está en `sales_invoices`.
// 2. Baja el JSON y el PDF del emisor, igual que `app-clientes`
//    (`documentoGuardado`), y los guarda en `sales-dte`. El JSON tiene que
//    traer `selloRecibido` de 40: un documento sin sello no se entrega como si
//    fuera válido.
// 3. Los devuelve para descargar, o los manda por correo (Resend, como
//    `app-clientes`: `RESEND_API_KEY` + `CORREO_REMITENTE_CLIENTES` o
//    `CORREO_REMITENTE`).
// Cada entrega queda en `dte_entregas_cliente`, anotada ANTES del correo.
//
// ── Quién ───────────────────────────────────────────────────────────────────
// Quien tiene `dash_annulment_req` (la herramienta «Modificar facturación»
// de la sala) o `ventas` (el detalle de la venta en Ventas), y sólo sobre ventas de su sala salvo alcance de toda la red.
// La sala sale de la factura, no del pedido: no se elige cambiando un número.
//
// Ni una línea de esto habla del sistema de origen en lo que ve el usuario.
import { createClient } from "npm:@supabase/supabase-js@2";
import { getCorsHeaders, permisoDeModulo, requireActiveEmployeeUser } from "../_shared/security.ts";

const EMISOR = "https://clientesdte3.oss.com.sv/farma_salud/downloads";
const CORREO_VALIDO = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const TOPE_CORREOS_DIA = 40; // por persona que atiende: un error de dedo no se vuelve una ráfaga
const selloValido = (s: unknown) => typeof s === "string" && s.length === 40;

class ErrorUsuario extends Error {
  constructor(msg: string, readonly status = 400) { super(msg); }
}

const b64 = (bytes: Uint8Array) => {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const dinero = (n: unknown) => `$${Number(n ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

  const admin = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");

  try {
    const body = await req.json().catch(() => ({}));
    const accion = body?.accion === "correo" ? "correo" : body?.accion === "descargar" ? "descargar"
      : body?.accion === "correo_de_ficha" ? "correo_de_ficha" : null;
    const invoiceId = Number(body?.invoice_id);
    if (!accion) throw new ErrorUsuario("Acción no válida.");
    if (!Number.isFinite(invoiceId) || invoiceId <= 0) throw new ErrorUsuario("Falta la venta.");

    // ── Quién ──────────────────────────────────────────────────────────
    const emp = await requireActiveEmployeeUser(req, admin);
    if (!emp) return json({ ok: false, error: "Sesión inválida o empleado inactivo." }, 401);
    // El botón vive en las dos pantallas; cualquiera de los dos permisos basta,
    // y el alcance de red de cualquiera de los dos también.
    const [pA, pV] = await Promise.all([
      permisoDeModulo(admin, emp.id, "dash_annulment_req", "can_view"),
      permisoDeModulo(admin, emp.id, "ventas", "can_view"),
    ]);
    if (pA.roto || pV.roto) return json({ ok: false, error: pA.roto || pV.roto }, 503);
    const permiso = {
      puede: pA.puede || pV.puede,
      alcanceTodo: pA.alcanceTodo || pV.alcanceTodo,
      emp: pA.emp ?? pV.emp,
    };
    if (!permiso.puede) return json({ ok: false, error: "No tienes permiso para entregar documentos de venta." }, 403);

    // ── Qué venta ──────────────────────────────────────────────────────
    const { data: f, error: eF } = await admin.from("sales_invoices")
      .select("id, branch_id, customer_id, fecha, codigo_generacion, tipo_documento, correlativo, total, estado, recibido_mh, cliente")
      .eq("id", invoiceId).maybeSingle();
    if (eF) throw eF;
    if (!f) throw new ErrorUsuario("Esa venta ya no está en el portal.", 404);
    if (!permiso.alcanceTodo && Number(permiso.emp?.branch_id) !== Number(f.branch_id))
      throw new ErrorUsuario("Esa venta es de otra sucursal.", 403);
    if (accion === "correo_de_ficha") {
      if (!f.customer_id) return json({ ok: true, correo: null });
      const { data: c, error: eCl } = await admin.from("customers")
        .select("email").eq("id", f.customer_id).maybeSingle();
      if (eCl) throw eCl;
      const deLaFicha = String(c?.email ?? "").trim().toLowerCase();
      return json({ ok: true, correo: deLaFicha.length <= 254 && CORREO_VALIDO.test(deLaFicha) ? deLaFicha : null });
    }
    // El código de generación NO se exige acá: un COF de la noche nunca se
    // armó como documento, así que llega sin él (medido el 2026-10-28: 124 de
    // 125). Lo asigna el envío; se exige después de mandarlo, más abajo.
    const { data: valida, error: eV } = await admin.rpc("venta_valida", { p_estado: f.estado });
    if (eV) throw eV;
    if (!valida) throw new ErrorUsuario("Esta venta está anulada: no tiene documento que entregar.");

    let correo: string | null = null;
    if (accion === "correo") {
      correo = String(body?.correo ?? "").trim().toLowerCase();
      if (correo.length > 254 || !CORREO_VALIDO.test(correo))
        throw new ErrorUsuario("Ese correo no parece válido. Revísalo e intenta de nuevo.");
      const { count, error: eC } = await admin.from("dte_entregas_cliente")
        .select("id", { count: "exact", head: true })
        .eq("employee_id", emp.id).eq("accion", "correo")
        .gte("created_at", new Date(Date.now() - 86400_000).toISOString());
      if (eC) throw eC;
      if ((count ?? 0) >= TOPE_CORREOS_DIA)
        throw new ErrorUsuario(`Ya enviaste ${TOPE_CORREOS_DIA} correos en las últimas 24 horas. Descarga el documento y entrégalo.`, 429);
      if (!Deno.env.get("RESEND_API_KEY") || !(Deno.env.get("CORREO_REMITENTE_CLIENTES") ?? Deno.env.get("CORREO_REMITENTE")))
        throw new ErrorUsuario("El envío por correo no está disponible. Descarga el documento y entrégalo.", 503);
    }

    // ── 1 · Si no tiene sello, se manda a Hacienda ahora ───────────────
    let seEnvio = false;
    if (!selloValido(f.recibido_mh)) {
      const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/regularizar-dte`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${Deno.env.get("ADMIN_INVOKE_SECRET")}` },
        body: JSON.stringify({ alcance: "una", invoice_id: invoiceId, forzar_cof_noche: true }),
        signal: AbortSignal.timeout(140_000),
      });
      const res = await r.json().catch(() => ({}));
      const d = Array.isArray(res?.detalle) ? res.detalle[0] : null;
      if (!r.ok || !d?.ok) {
        // `regularizar-dte` ya anotó el intento (y el rechazo, si lo hubo) en
        // la bitácora de Facturación: acá basta con decir que no entró.
        const motivo = d?.error || res?.error || `respuesta ${r.status}`;
        console.error(`dte-para-cliente ${invoiceId}: no entró a Hacienda: ${motivo}`);
        throw new ErrorUsuario("Hacienda todavía no recibió este documento. Intenta de nuevo en unos minutos; si sigue igual, avisa a supervisión.", 502);
      }
      seEnvio = !d.omitida;
      // `regularizar-dte` releyó esa fecha antes de contestar: el código de
      // generación —y el sello— ya están en la fila.
      const { data: f2, error: eF2 } = await admin.from("sales_invoices")
        .select("codigo_generacion, recibido_mh").eq("id", invoiceId).maybeSingle();
      if (eF2) throw eF2;
      if (f2) Object.assign(f, f2);
    }
    if (!f.codigo_generacion)
      throw new ErrorUsuario("El documento todavía no está listo. Intenta de nuevo en un minuto.", 503);

    // ── 2 · Los dos archivos ───────────────────────────────────────────
    const cg = String(f.codigo_generacion).toUpperCase();
    const [a, m] = String(f.fecha).split("-");
    const bajar = async (formato: "json" | "pdf"): Promise<Uint8Array> => {
      const res = await fetch(`${EMISOR}/dteqr_${formato}.php?codigoGeneracion=${cg}`, { signal: AbortSignal.timeout(30_000) });
      const buf = res.ok ? new Uint8Array(await res.arrayBuffer()) : null;
      // El emisor contesta 200 con el cuerpo vacío para un código que no
      // conoce: se mira el CONTENIDO, no el estado.
      const ok = buf && buf.byteLength > 4 && (formato === "pdf"
        ? buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46
        : (() => {
          try {
            const j = JSON.parse(new TextDecoder().decode(buf));
            return Boolean(j?.identificacion?.numeroControl) && selloValido(j?.selloRecibido);
          } catch { return false; }
        })());
      if (!ok) throw new ErrorUsuario("El documento todavía no está listo. Intenta de nuevo en un minuto.", 503);
      const { error } = await admin.storage.from("sales-dte").upload(`${a}/${m}/${cg}.${formato}`, buf!, {
        contentType: formato === "pdf" ? "application/pdf" : "application/json", upsert: true,
      });
      if (error) console.error(`dte-para-cliente: no se guardó ${cg}.${formato}: ${error.message}`);
      return buf!;
    };
    const [jsonBytes, pdfBytes] = await Promise.all([bajar("json"), bajar("pdf")]);

    const tipo = f.tipo_documento === "CCF" ? "Comprobante de crédito fiscal" : "Factura";
    const numero = f.correlativo ? String(f.correlativo).split("_")[0].replace(/^0+(?=\d)/, "") : null;
    const base = `${f.tipo_documento === "CCF" ? "CCF" : "Factura"}-${numero ?? cg}`;
    const archivos = [
      { nombre: `${base}.pdf`, tipo: "application/pdf", base64: b64(pdfBytes) },
      { nombre: `${base}.json`, tipo: "application/json", base64: b64(jsonBytes) },
    ];

    // ── 3 · Entregar ───────────────────────────────────────────────────
    const { data: entrega, error: eIns } = await admin.from("dte_entregas_cliente").insert({
      invoice_id: invoiceId, employee_id: emp.id, accion: accion === "correo" ? "correo" : "descarga",
      correo, se_envio_a_hacienda: seEnvio,
    }).select("id").single();
    if (eIns) throw eIns;

    if (accion === "descargar") return json({ ok: true, archivos, se_envio: seEnvio });

    const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f4f6f8;font-family:Arial,Helvetica,sans-serif;color:#1c2430">
<table role="presentation" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;padding:24px" width="100%"><tr><td>
<p style="margin:0 0 4px;font-size:13px;color:#5b6675">Farmacia Salud</p>
<h1 style="margin:0 0 16px;font-size:20px">Tu documento electrónico</h1>
<p style="margin:0 0 16px;font-size:14px">Te enviamos el documento de tu compra. Va adjunto en PDF (para ver o imprimir) y en JSON (el archivo electrónico).</p>
<table role="presentation" width="100%" style="border-collapse:collapse;font-size:13px"><tr>
<td style="padding:8px 0;border-bottom:1px solid #eef1f4">${esc(tipo)}${numero ? ` N.º ${esc(numero)}` : ""}<br><span style="color:#5b6675;font-size:12px">${esc(`${String(f.fecha).slice(8, 10)}/${m}/${a}`)}</span></td>
<td style="padding:8px 0;border-bottom:1px solid #eef1f4;text-align:right;font-family:monospace">${esc(dinero(f.total))}</td></tr></table>
<p style="margin:16px 0 0;font-size:12px;color:#8a94a3">Si no pediste este correo, puedes ignorarlo.</p>
</td></tr></table></body></html>`;
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${Deno.env.get("RESEND_API_KEY")}`, "Content-Type": "application/json",
        "Idempotency-Key": `dte-sala-${invoiceId}-${correo}-${Math.floor(Date.now() / 60_000)}`.slice(0, 256),
      },
      body: JSON.stringify({
        from: Deno.env.get("CORREO_REMITENTE_CLIENTES") ?? Deno.env.get("CORREO_REMITENTE"),
        to: [correo], subject: `${tipo}${numero ? ` N.º ${numero}` : ""} — Farmacia Salud`, html,
        attachments: archivos.map((x) => ({ filename: x.nombre, content: x.base64 })),
      }),
      signal: AbortSignal.timeout(45_000),
    }).catch((e) => ({ ok: false, status: 0, text: async () => (e as Error).message }) as unknown as Response);
    const texto = await r.text();
    let proveedorId: string | null = null;
    if (r.ok) { try { proveedorId = JSON.parse(texto).id ?? null; } catch { /* sin id */ } }
    const { error: eUpd } = await admin.from("dte_entregas_cliente")
      .update({ enviado: r.ok, proveedor_id: proveedorId, error: r.ok ? null : texto.slice(0, 500) })
      .eq("id", entrega.id);
    if (eUpd) console.error(`dte-para-cliente: no se anotó el resultado del correo ${entrega.id}: ${eUpd.message}`);
    if (!r.ok) {
      console.error(`dte-para-cliente: el correo no salió (${r.status}): ${texto.slice(0, 300)}`);
      throw new ErrorUsuario("No se pudo enviar el correo. Descarga el documento y entrégalo.", 502);
    }
    return json({ ok: true, correo, se_envio: seEnvio });
  } catch (e) {
    if (e instanceof ErrorUsuario) return json({ ok: false, error: e.message }, e.status);
    console.error("dte-para-cliente:", e instanceof Error ? e.message : String(e));
    return json({ ok: false, error: "No se pudo preparar el documento. Intenta de nuevo." }, 500);
  }
});
