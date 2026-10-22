// ─── wompi-pagos: el regreso de un cobro en línea ──────────────────────────
//
// Dos puertas, las dos sin sesión (va con `--no-verify-jwt`: la llaman Wompi y
// el navegador del cliente, ninguno trae un JWT del portal):
//
//   POST  el aviso de Wompi (webhook) cuando un pago sale aprobado. Wompi lo
//         reintenta si no contestamos 200.
//   GET   la vuelta del navegador del cliente después de pagar. Confirma igual
//         que el aviso —por si el aviso se atrasa— y devuelve al cliente a la
//         app (`puntossalud://reservas`).
//
// En las dos el veredicto lo da la API de Wompi (`_shared/wompi.ts`), nunca lo
// que dice la petición. Y una misma transacción no puede pagar dos reservas:
// `app_reservas_pagos.id_transaccion` es UNIQUE y la función de la base lo
// comprueba antes.
import { createClient } from "npm:@supabase/supabase-js@2";
import { aceptaPruebas, avisoAutentico, consultarTransaccion } from "../_shared/wompi.ts";
import { aplicarPagoDeCredito } from "../_shared/creditoEnLinea.ts";

const VOLVER_A_LA_APP = "puntossalud://reservas";
const VOLVER_A_CREDITOS = "puntossalud://creditos";

// El pago de un crédito (2026-10-20): confirmado el cobro, el abono en la caja
// sigue DESPUÉS de contestar — la caja tarda hasta 45 s y Wompi quiere su 200
// enseguida. Si falla, `sync-creditos` lo reintenta cada 10 minutos.
// deno-lint-ignore no-explicit-any
function abonarSiEsCredito(admin: any, r: any) {
  if (!r?.ok || !r?.credito || r?.prueba || !r?.pago_id) return;
  if (r.ya && !["pendiente", "fallo"].includes(String(r.abono_estado))) return;
  const tarea = aplicarPagoDeCredito(admin, Number(r.pago_id))
    .catch((e) => console.error("[wompi] abono del crédito:", (e as Error)?.message ?? e));
  // deno-lint-ignore no-explicit-any
  try { (globalThis as any).EdgeRuntime?.waitUntil(tarea); } catch { /* sin waitUntil, lo toma sync-creditos */ }
}

// deno-lint-ignore no-explicit-any
// El id del enlace con que se pagó, si la respuesta lo trae (la API y el
// aviso no siempre lo nombran igual).
// deno-lint-ignore no-explicit-any
function enlaceDe(x: any): string | null {
  const v = x?.enlacePago?.id ?? x?.EnlacePago?.Id ?? x?.enlacePago?.idEnlace ?? x?.idEnlace ?? x?.IdEnlace ?? null;
  return v == null || v === "" ? null : String(v);
}

// deno-lint-ignore no-explicit-any
async function confirmar(admin: any, identificador: string, idTransaccion: string, opciones: { vuelta?: boolean; enlaceAviso?: string | null } = {}) {
  if (!identificador || !idTransaccion) return { ok: false, motivo: "incompleto" };
  const tx = await consultarTransaccion(idTransaccion);
  if (!tx?.esAprobada) return { ok: false, motivo: "no_aprobada" };
  if (!tx.esReal && !aceptaPruebas()) {
    console.warn("[wompi] pago de PRUEBA ignorado:", identificador, idTransaccion);
    return { ok: false, motivo: "prueba" };
  }
  // El enlace manda su identificador en `datosAdicionales`: si la transacción
  // lo trae y es otro, es una transacción ajena pegada a esta reserva.
  // deno-lint-ignore no-explicit-any
  const extra = (tx as any).datosAdicionales ?? {};
  const suyo = extra?.reserva ?? extra?.Reserva;
  if (suyo && String(suyo) !== identificador) return { ok: false, motivo: "otra_reserva" };

  // Además, el ENLACE (2026-10-21): la vuelta del navegador trae el
  // identificador en la URL, y cualquiera puede pegarle una transacción
  // aprobada de otro enlace con el mismo monto. Si la transacción (o el aviso)
  // dice con qué enlace se pagó, tiene que ser el de este cobro.
  const enlaceTx = enlaceDe(tx) ?? opciones.enlaceAviso ?? null;
  if (enlaceTx || (opciones.vuelta && !suyo)) {
    const { data: pago, error: eP } = await admin.from("app_reservas_pagos")
      .select("enlace_id").eq("identificador", identificador).maybeSingle();
    if (eP) throw eP;
    if (pago?.enlace_id != null && enlaceTx && String(pago.enlace_id) !== enlaceTx) {
      return { ok: false, motivo: "otro_enlace" };
    }
    // En la vuelta, sin `datosAdicionales` ni enlace en la transacción no hay
    // cómo atarla a este cobro: no se confirma acá. El aviso de Wompi
    // (firmado, con su enlace) la confirma igual en segundos.
    if (opciones.vuelta && !suyo && !enlaceTx) {
      console.warn("[wompi] vuelta sin datos del enlace; se espera el aviso:", identificador, idTransaccion);
      return { ok: false, motivo: "sin_enlace" };
    }
  }

  const { data, error } = await admin.rpc("app_reserva_pago_confirmar", {
    p_identificador: identificador,
    p_id_transaccion: tx.idTransaccion ?? idTransaccion,
    p_monto: Number(tx.monto),
    p_es_real: !!tx.esReal,
    p_codigo: tx.codigoAutorizacion ?? null,
    p_forma: tx.formaPago ?? null,
    // Sólo lo que hace falta para conciliar (2026-10-17). La respuesta de
    // Wompi trae también datos del pagador —nombre, correo, la tarjeta
    // enmascarada— que la farmacia no necesita; guardarlos obligaría a
    // declarar «información de pago» en la ficha de privacidad de las tiendas.
    p_detalle: {
      idTransaccion: tx.idTransaccion ?? idTransaccion, monto: tx.monto, esReal: !!tx.esReal,
      esAprobada: !!tx.esAprobada, formaPago: tx.formaPago ?? null, codigoAutorizacion: tx.codigoAutorizacion ?? null,
      // deno-lint-ignore no-explicit-any
      fecha: (tx as any).fechaTransaccion ?? null,
    },
  });
  if (error) throw error;
  if (!data?.ok) console.error("[wompi] no se confirmó:", identificador, idTransaccion, JSON.stringify(data));
  return data;
}

const pagina = (titulo: string, texto: string, volver = VOLVER_A_LA_APP) => `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="1;url=${volver}"><title>${titulo}</title>
<style>body{font-family:-apple-system,system-ui,sans-serif;text-align:center;padding:48px 24px;color:#1c1c1e;background:#fff}
@media(prefers-color-scheme:dark){body{color:#f2f2f7;background:#000}}h1{font-size:22px}p{font-size:16px;opacity:.75}
a{display:inline-block;margin-top:20px;padding:14px 24px;border-radius:14px;background:#C2185B;color:#fff;text-decoration:none;font-weight:700}</style>
</head><body><h1>${titulo}</h1><p>${texto}</p><a href="${volver}">Volver a la app</a>
<script>setTimeout(function(){location.href=${JSON.stringify(volver)}},300)</script></body></html>`;

Deno.serve(async (req) => {
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // ── La vuelta del navegador ────────────────────────────────────────────
  if (req.method === "GET") {
    const q = new URL(req.url).searchParams;
    const identificador = q.get("identificadorEnlaceComercio") ?? q.get("ref") ?? "";
    const idTransaccion = q.get("idTransaccion") ?? "";
    let r: { ok?: boolean; motivo?: string; prueba?: boolean; credito?: boolean } = { ok: false, motivo: "incompleto" };
    try {
      if (idTransaccion) r = await confirmar(admin, identificador, idTransaccion, { vuelta: true });
      abonarSiEsCredito(admin, r);
    } catch (e) {
      console.error("[wompi] vuelta:", (e as Error)?.message ?? e);
    }
    // El identificador de un crédito empieza con «CR-» (ver `pagar_credito`).
    if (r?.credito || identificador.startsWith("CR-")) {
      const html = r?.ok && r?.prueba
        ? pagina("Pago de prueba", "Este cobro fue de prueba: no se cargó dinero y tu crédito sigue igual.", VOLVER_A_CREDITOS)
        : r?.ok
        ? pagina("¡Pago recibido!", "Tu crédito se actualiza en unos segundos.", VOLVER_A_CREDITOS)
        : pagina("Volviendo a la app", "Si completaste el pago, tu crédito se actualiza en unos segundos.", VOLVER_A_CREDITOS);
      return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
    }
    // Un cobro de PRUEBA (2026-10-19) no es dinero: se dice, y la sala lo cobra en caja.
    const html = r?.ok && r?.prueba
      ? pagina("Pago de prueba", "Este cobro fue de prueba: no se cargó dinero. Pagas al retirar en la sucursal.")
      : r?.ok
      ? pagina("¡Pago recibido!", "Tu reserva ya figura como pagada.")
      : pagina("Volviendo a la app", "Si completaste el pago, tu reserva se actualiza en unos segundos.");
    return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
  }

  if (req.method !== "POST") return new Response("solo POST o GET", { status: 405 });

  // ── El aviso de Wompi ──────────────────────────────────────────────────
  // El cuerpo se lee como TEXTO: la firma es sobre los bytes exactos.
  const crudo = await req.text();
  const firma = req.headers.get("wompi_hash") ?? req.headers.get("wompi-hash");
  if (firma && !(await avisoAutentico(crudo, firma))) {
    console.error("[wompi] aviso con firma inválida");
    return new Response("firma inválida", { status: 401 });
  }
  // Sin firma no se rechaza (decisión del dueño, 2026-10-22: la firma la exige
  // el banco sólo en algunos casos, y un proxy puede tirar una cabecera con
  // «_»). Con firma, se valida arriba; sin ella, recibe los mismos controles
  // que la vuelta del navegador (ver la llamada a `confirmar`).
  if (!firma) console.warn("[wompi] aviso sin cabecera wompi_hash; se verifica contra la API");

  // deno-lint-ignore no-explicit-any
  let aviso: any;
  try { aviso = JSON.parse(crudo); } catch { return new Response("json inválido", { status: 400 }); }
  const identificador = String(aviso?.EnlacePago?.IdentificadorEnlaceComercio ?? "");
  const idTransaccion = String(aviso?.IdTransaccion ?? "");
  try {
    // H6 (auditoría 2026-10-21): un aviso SIN firma no es más confiable que la
    // vuelta del navegador. Se le aplica la misma regla (`vuelta: true` →
    // sin datos que la aten a este cobro, `sin_enlace` y no se confirma), y el
    // enlace que trae su cuerpo NO se usa: lo escribió quien mandó el POST.
    const r = await confirmar(admin, identificador, idTransaccion,
      firma ? { enlaceAviso: enlaceDe(aviso) } : { vuelta: true });
    abonarSiEsCredito(admin, r);
    // 200 también cuando no se confirmó por una razón definitiva (no aprobada,
    // prueba, monto distinto): reintentarlo no la va a cambiar.
    return new Response(JSON.stringify(r), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    // Una falla pasajera (Wompi o la base no respondieron): 500 para que
    // Wompi lo reintente.
    console.error("[wompi] aviso:", (e as Error)?.message ?? e);
    return new Response("reintentar", { status: 500 });
  }
});
