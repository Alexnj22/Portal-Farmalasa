// ─── n1co-pagos: el regreso de un cobro en línea ───────────────────────────
//
// Reemplaza a `wompi-pagos` (2026-11-10). Dos puertas, las dos sin sesión (va
// con `--no-verify-jwt`: la llaman n1co y el navegador del cliente, ninguno
// trae un JWT del portal):
//
//   POST  el aviso de n1co (webhook). Firmado con HMAC (`X-H4B-Hmac-Sha256`):
//         sin firma válida se rechaza. n1co lo reintenta si no contestamos 2xx.
//   GET   la vuelta del navegador después de pagar (o de cancelar). Confirma
//         igual que el aviso —por si el aviso se atrasa— y manda al cliente a
//         `public/pago.html`, que lo devuelve a la app.
//
// En las dos el veredicto lo da la API de n1co (`_shared/n1co.ts`), nunca lo
// que dice la petición: ésta sólo dice QUÉ cobro nuestro mirar, y la orden se
// consulta con el código que guardamos al crear el link (`enlace_codigo`). Así
// nadie puede pegarle a un cobro la orden pagada de otro. Y una misma orden no
// puede pagar dos cobros: `app_reservas_pagos.id_transaccion` es UNIQUE.
import { createClient } from "npm:@supabase/supabase-js@2";
import { aceptaPruebas, avisoAutentico, consultarOrden } from "../_shared/n1co.ts";
import { aplicarPagoDeCredito } from "../_shared/creditoEnLinea.ts";

// El pago de un crédito (2026-10-20): confirmado el cobro, el abono en la caja
// sigue DESPUÉS de contestar — la caja tarda hasta 45 s y n1co quiere su 2xx
// enseguida. Si falla, `sync-creditos` lo reintenta cada 10 minutos.
// deno-lint-ignore no-explicit-any
function abonarSiEsCredito(admin: any, r: any) {
  if (!r?.ok || !r?.credito || r?.prueba || !r?.pago_id) return;
  // Un lote (2026-11-05): se abonan sus hijas, en serie (la caja vive en una
  // sesión por sala). `credito_pago_tomar` no deja tomar dos veces la misma.
  if (r.lote) {
    const ids: number[] = Array.isArray(r.pagos) ? r.pagos.map(Number) : [];
    const tarea = (async () => {
      for (const id of ids) {
        await aplicarPagoDeCredito(admin, id).catch((e) => console.error("[n1co] abono del lote:", (e as Error)?.message ?? e));
      }
    })();
    // deno-lint-ignore no-explicit-any
    try { (globalThis as any).EdgeRuntime?.waitUntil(tarea); } catch { /* sin waitUntil, lo toma sync-creditos */ }
    return;
  }
  if (r.ya && !["pendiente", "fallo"].includes(String(r.abono_estado))) return;
  const tarea = aplicarPagoDeCredito(admin, Number(r.pago_id))
    .catch((e) => console.error("[n1co] abono del crédito:", (e as Error)?.message ?? e));
  // deno-lint-ignore no-explicit-any
  try { (globalThis as any).EdgeRuntime?.waitUntil(tarea); } catch { /* sin waitUntil, lo toma sync-creditos */ }
}

// deno-lint-ignore no-explicit-any
async function confirmar(admin: any, filtro: { identificador?: string; ordenId?: number }) {
  let q = admin.from("app_reservas_pagos").select("identificador, enlace_id, enlace_codigo, pasarela");
  if (filtro.identificador) q = q.eq("identificador", filtro.identificador);
  else if (Number.isFinite(filtro.ordenId)) q = q.eq("enlace_id", filtro.ordenId).eq("pasarela", "n1co");
  else return { ok: false, motivo: "incompleto" };
  const { data: fila, error: eF } = await q.maybeSingle();
  if (eF) throw eF;
  if (!fila || fila.pasarela !== "n1co" || !fila.enlace_codigo) return { ok: false, motivo: "desconocido" };
  const identificador = String(fila.identificador);

  const orden = await consultarOrden(String(fila.enlace_codigo));
  // La orden tiene que ser la que creamos para ESTE cobro.
  if (fila.enlace_id != null && Number(fila.enlace_id) !== orden.orderId) return { ok: false, motivo: "otra_orden" };
  if (orden.orderReference && orden.orderReference !== identificador) return { ok: false, motivo: "otra_reserva" };
  if (!orden.pagada) return { ok: false, motivo: "no_aprobada", estado: orden.estado };
  if (!orden.esReal && !aceptaPruebas()) {
    console.warn("[n1co] pago de PRUEBA ignorado:", identificador, orden.orderId);
    return { ok: false, motivo: "prueba" };
  }

  // Varios créditos en un cobro (identificador «CL-…», 2026-11-05) tienen su
  // propia función; todo lo demás, la de siempre. Las dos comparan el monto.
  const funcion = identificador.startsWith("CL-") ? "app_credito_lote_confirmar" : "app_reserva_pago_confirmar";
  const { data, error } = await admin.rpc(funcion, {
    p_identificador: identificador,
    p_id_transaccion: String(orden.orderId),
    p_monto: orden.total,
    p_es_real: orden.esReal,
    p_codigo: orden.codigoAutorizacion,
    p_forma: "Tarjeta",
    // Sólo lo que hace falta para conciliar. La orden de n1co trae también
    // datos del comprador (nombre, teléfono, correo) que la farmacia no
    // necesita; guardarlos obligaría a declarar «información de pago» en la
    // ficha de privacidad de las tiendas.
    p_detalle: {
      pasarela: "n1co", orden: orden.orderId, codigo: orden.orderCode, estado: orden.estado,
      total: orden.total, esReal: orden.esReal, codigoAutorizacion: orden.codigoAutorizacion, fecha: orden.fecha,
    },
  });
  if (error) throw error;
  if (!data?.ok) console.error("[n1co] no se confirmó:", identificador, orden.orderId, JSON.stringify(data));
  // Si es de PRUEBA lo dice la orden, no la respuesta de la base: cuando el
  // aviso llegó primero, la base contesta «ya estaba» con `prueba: false`.
  return data && typeof data === "object" ? { ...data, prueba: !!data.prueba || !orden.esReal } : data;
}

// La página de la vuelta vive en el PORTAL (`public/pago.html`), no acá:
// Supabase sirve toda respuesta de una Edge Function como `text/plain` con
// `nosniff`. Acá se confirma y se redirige con qué pasó y para qué.
const PAGINA = "https://portal.farmasalud.lat/pago.html";
const irA = (estado: "recibido" | "prueba" | "pendiente", para: "reserva" | "credito" | "sala") =>
  new Response(null, { status: 302, headers: { Location: `${PAGINA}?estado=${estado}&para=${para}`, "Cache-Control": "no-store" } });

Deno.serve(async (req) => {
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // ── La vuelta del navegador ────────────────────────────────────────────
  if (req.method === "GET") {
    const identificador = new URL(req.url).searchParams.get("ref") ?? "";
    let r: { ok?: boolean; motivo?: string; prueba?: boolean; credito?: boolean } = { ok: false, motivo: "incompleto" };
    try {
      if (identificador) r = await confirmar(admin, { identificador });
      abonarSiEsCredito(admin, r);
    } catch (e) {
      console.error("[n1co] vuelta:", (e as Error)?.message ?? e);
    }
    // El identificador de un crédito empieza con «CR-»/«CL-» (ver
    // `pagar_credito`); el link que mandó la sala, con «AP-». Un cobro de
    // PRUEBA no es dinero: se dice, y la sala lo cobra en caja.
    const para = r?.credito || identificador.startsWith("CR-") || identificador.startsWith("CL-") ? "credito"
      : identificador.startsWith("AP-") ? "sala" : "reserva";
    return irA(r?.ok && r?.prueba ? "prueba" : r?.ok ? "recibido" : "pendiente", para);
  }

  if (req.method !== "POST") return new Response("solo POST o GET", { status: 405 });

  // ── El aviso de n1co ───────────────────────────────────────────────────
  // El cuerpo se lee como TEXTO: la firma es sobre los bytes exactos.
  const crudo = await req.text();
  if (!(await avisoAutentico(crudo, req.headers.get("x-h4b-hmac-sha256")))) {
    console.error("[n1co] aviso sin firma válida");
    return new Response("firma inválida", { status: 401 });
  }
  // deno-lint-ignore no-explicit-any
  let aviso: any;
  try { aviso = JSON.parse(crudo); } catch { return new Response("json inválido", { status: 400 }); }
  const ev = aviso?.event ?? aviso;
  const tipo = String(ev?.type ?? "");
  // Sólo un pago aprobado confirma. Lo demás (creada, cancelada, 3DS…) se
  // acusa y no se toca: un cobro sin pagar ya se ve así en la base.
  if (tipo !== "SuccessPayment" && tipo !== "Finalized") {
    return new Response(JSON.stringify({ ok: true, ignorado: tipo || "sin_tipo" }), { headers: { "Content-Type": "application/json" } });
  }
  const identificador = ev?.orderReference ? String(ev.orderReference) : "";
  const ordenId = Number(ev?.orderId);
  try {
    const r = await confirmar(admin, identificador ? { identificador } : { ordenId });
    abonarSiEsCredito(admin, r);
    // 2xx también cuando no se confirmó por una razón definitiva (no pagada,
    // prueba, monto distinto, cobro desconocido): reintentarlo no la cambia.
    return new Response(JSON.stringify(r), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    // Una falla pasajera (n1co o la base no respondieron): 500 para que n1co
    // lo reintente; si se agotan los reintentos, la vuelta del navegador lo
    // confirma igual.
    console.error("[n1co] aviso:", (e as Error)?.message ?? e);
    return new Response("reintentar", { status: 500 });
  }
});
