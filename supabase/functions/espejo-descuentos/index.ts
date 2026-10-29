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
  getPromosCreds, getSessionCookie, listarDescuentos, productosDelDescuento, salasDelOrigen,
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

    const { data: ya, error: eYa } = await admin.from("descuentos_espejo").select("id").limit(5000);
    if (eYa) throw eYa;
    const conocidas = new Set((ya ?? []).map((r) => Number(r.id)));
    // La fecha de El Salvador (UTC-6), con un día de margen hacia atrás.
    const ayer = new Date(Date.now() - 30 * 3600_000).toISOString().slice(0, 10);

    const mapa = getErpBranchMap();
    const filas = await Promise.all(lista.map(async (d) => {
      const releer = !conocidas.has(d.id) || d.fin >= ayer;
      // `null` = no se releyó (o falló): la base conserva los que tenía.
      const productos = releer
        ? await productosDelDescuento(cookie, d.id).then((p) => p.filter((x) => x > 0)).catch(() => null)
        : null;
      return {
        id: d.id, descripcion: d.descripcion, tipo: d.tipo, monto: d.monto,
        inicio: d.inicio, fin: d.fin, todas_las_salas: d.todas_las_salas,
        branch_id: d.erp_sucursal_id === null ? null : (mapa.find((e) => e.erpId === d.erp_sucursal_id)?.branchId ?? null),
        productos,
      };
    }));

    const { data, error } = await admin.rpc("descuentos_espejo_sync", { p: filas, completa: true });
    if (error) throw error;
    return json({ ok: true, campanas: filas.length, releidas: filas.filter((f) => f.productos).length, ...data });
  } catch (e) {
    console.error("[espejo-descuentos]", e instanceof Error ? e.message : e);
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
