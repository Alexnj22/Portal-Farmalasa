// supabase/functions/espejo-descuentos/index.ts
// Copia las campañas de descuento del sistema de ventas a `descuentos_espejo`
// (PENDIENTES 30, 2026-10-29). Con esa copia la base separa, en cada venta,
// la rebaja de campaña del precio cambiado a mano (`rebajas_en_ventas`): la
// factura no trae el descuento del renglón, sólo el total ya rebajado.
//
// Allá una campaña se borra o se edita sin dejar rastro; por eso se copia y
// se conserva. Los productos se releen sólo de las campañas vigentes, futuras
// o nuevas: los de una ya terminada no cambian, y releerlas todas sería una
// petición por campaña en cada corrida.
//
// Cron `espejo-descuentos` (x-cron-secret), deploy con --no-verify-jwt.
// Sólo LEE del sistema de ventas.
import { createClient } from "npm:@supabase/supabase-js@2";
import { checkCronSecret, getErpBranchMap } from "../_shared/security.ts";
import {
  ayerSV, filaDeLaCopia, getPromosCreds, getSessionCookie, hayQueReleer, listarDescuentos,
  productosDelDescuento, salasDelOrigen,
} from "../_shared/descuentos.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (!checkCronSecret(req)) return json({ ok: false, error: "UNAUTHORIZED" }, 401);
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { username, password } = getPromosCreds();
    const cookie = await getSessionCookie(username, password);
    const lista = await listarDescuentos(cookie, await salasDelOrigen(cookie));

    /* Los ids que la copia ya conoce, por páginas: PostgREST corta en 1000
       filas sin avisar, y un `.limit(5000)` no lo evita. */
    const conocidas = new Set<number>();
    for (let desde = 0; ; desde += 1000) {
      const { data: ya, error: eYa } = await admin.from("descuentos_espejo")
        .select("id").order("id").range(desde, desde + 999);
      if (eYa) throw eYa;
      for (const r of ya ?? []) conocidas.add(Number(r.id));
      if (!ya || ya.length < 1000) break;
    }
    const ayer = ayerSV();

    const mapa = getErpBranchMap();
    const filas = await Promise.all(lista.map(async (d) => {
      // `null` = no se releyó (o falló): la base conserva los que tenía.
      const productos = hayQueReleer(d, conocidas, ayer)
        ? await productosDelDescuento(cookie, d.id).catch(() => null)
        : null;
      return filaDeLaCopia(d, productos, mapa);
    }));

    const { data, error } = await admin.rpc("descuentos_espejo_sync", { p: filas, completa: true });
    if (error) throw error;
    return json({ ok: true, campanas: filas.length, releidas: filas.filter((f) => f.productos).length, ...data });
  } catch (e) {
    console.error("[espejo-descuentos]", e instanceof Error ? e.message : e);
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
