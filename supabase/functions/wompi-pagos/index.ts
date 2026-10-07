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

const VOLVER_A_LA_APP = "puntossalud://reservas";

// deno-lint-ignore no-explicit-any
async function confirmar(admin: any, identificador: string, idTransaccion: string) {
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

  const { data, error } = await admin.rpc("app_reserva_pago_confirmar", {
    p_identificador: identificador,
    p_id_transaccion: tx.idTransaccion ?? idTransaccion,
    p_monto: Number(tx.monto),
    p_es_real: !!tx.esReal,
    p_codigo: tx.codigoAutorizacion ?? null,
    p_forma: tx.formaPago ?? null,
    p_detalle: tx,
  });
  if (error) throw error;
  if (!data?.ok) console.error("[wompi] no se confirmó:", identificador, idTransaccion, JSON.stringify(data));
  return data;
}

const pagina = (titulo: string, texto: string) => `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="1;url=${VOLVER_A_LA_APP}"><title>${titulo}</title>
<style>body{font-family:-apple-system,system-ui,sans-serif;text-align:center;padding:48px 24px;color:#1c1c1e;background:#fff}
@media(prefers-color-scheme:dark){body{color:#f2f2f7;background:#000}}h1{font-size:22px}p{font-size:16px;opacity:.75}
a{display:inline-block;margin-top:20px;padding:14px 24px;border-radius:14px;background:#C2185B;color:#fff;text-decoration:none;font-weight:700}</style>
</head><body><h1>${titulo}</h1><p>${texto}</p><a href="${VOLVER_A_LA_APP}">Volver a la app</a>
<script>setTimeout(function(){location.href=${JSON.stringify(VOLVER_A_LA_APP)}},300)</script></body></html>`;

Deno.serve(async (req) => {
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // ── La vuelta del navegador ────────────────────────────────────────────
  if (req.method === "GET") {
    const q = new URL(req.url).searchParams;
    const identificador = q.get("identificadorEnlaceComercio") ?? q.get("ref") ?? "";
    const idTransaccion = q.get("idTransaccion") ?? "";
    let r: { ok?: boolean; motivo?: string } = { ok: false, motivo: "incompleto" };
    try {
      if (idTransaccion) r = await confirmar(admin, identificador, idTransaccion);
    } catch (e) {
      console.error("[wompi] vuelta:", (e as Error)?.message ?? e);
    }
    const html = r?.ok
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
  // Sin firma no se rechaza (un proxy puede tirar una cabecera con «_»): el
  // veredicto igual sale de la API, así que un aviso falso no marca nada.
  if (!firma) console.warn("[wompi] aviso sin cabecera wompi_hash; se verifica contra la API");

  // deno-lint-ignore no-explicit-any
  let aviso: any;
  try { aviso = JSON.parse(crudo); } catch { return new Response("json inválido", { status: 400 }); }
  const identificador = String(aviso?.EnlacePago?.IdentificadorEnlaceComercio ?? "");
  const idTransaccion = String(aviso?.IdTransaccion ?? "");
  try {
    const r = await confirmar(admin, identificador, idTransaccion);
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
