// Entregar en la sala un premio del raspable que no es puntos (2026-10-19).
//
//   · PRODUCTO    → se DESCARTA en el sistema de la caja, con el concepto
//                   «PREMIO PUNTOS SALUD - <código> - <cliente> - Entrega: <quien>»
//                   (decisión del usuario: que se identifique). No hay factura.
//   · PROMOCIONAL → baja del inventario de promocionales de esa sala.
//
// La llama el NAVEGADOR con la sesión de quien entrega: va con JWT (no es un
// cron). Quién entrega sale del JWT, nunca del cuerpo.
//
// ── El orden importa ──────────────────────────────────────────────────────
//   1. ¿Puede entregar en ESA sala? (`promocionales_puede_en_sala`, como él)
//   2. Tomar el premio: ENTREGANDO, atómico. Dos clics a la vez no descartan
//      dos veces.
//   3. El descarte en el sistema de la caja (sólo producto).
//   4. Cerrar: ENTREGADO (y el promocional baja, en la misma transacción).
// Si 3 falla, se suelta y el premio vuelve a POR_RETIRAR. Si 3 entra y 4
// falla, el premio queda ENTREGANDO con el descarte hecho: el arriendo de 3
// minutos lo devolvería a POR_RETIRAR y se descartaría dos veces. Por eso el
// cierre se reintenta y, si igual falla, se contesta con el concepto para que
// alguien lo cierre a mano — nunca se suelta después de un descarte que entró.
import { createClient } from "npm:@supabase/supabase-js@2";
import { getCorsHeaders, requireActiveEmployeeUser } from "../_shared/security.ts";
import { conceptoDe, descartarUnaLinea } from "../_shared/erp-descarte.ts";

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");

  let tomado: number | null = null;
  let descartado = false;
  try {
    const { premio_id } = await req.json().catch(() => ({}));
    const id = Number(premio_id);
    if (!Number.isInteger(id) || id <= 0) return json({ ok: false, error: "Falta el premio." }, 400);

    const quien = await requireActiveEmployeeUser(req, admin);
    if (!quien) return json({ ok: false, error: "Sesión inválida o empleado inactivo." }, 401);

    const { data: fila, error: filaErr } = await admin
      .from("puntos_premios").select("id, branch_id, estado").eq("id", id).maybeSingle();
    if (filaErr) throw filaErr;
    if (!fila) return json({ ok: false, error: "Ese premio no existe." }, 404);
    if (!fila.branch_id) return json({ ok: false, error: "El cliente todavía no eligió dónde retirarlo." }, 409);

    // El permiso se pregunta COMO el usuario: la regla vive en la base.
    const comoEl = createClient(url, Deno.env.get("SUPABASE_ANON_KEY") ?? "", {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    });
    const { data: puedeObrarPor, error: puedeErr } = await comoEl.rpc("promocionales_puede_en_sala", { p_branch: fila.branch_id });
    if (puedeErr) throw puedeErr;
    if (!puedeObrarPor) return json({ ok: false, error: "Este premio se entrega en otra sucursal." }, 403);

    const { data: p, error: tomarErr } = await admin.rpc("puntos_premio_tomar", { p_id: id, p_branch: fila.branch_id });
    if (tomarErr) return json({ ok: false, error: tomarErr.message }, 409);
    tomado = id;

    let erp: Record<string, unknown> | null = null;
    if (p.tipo === "producto") {
      const { data: mapa, error: mapaErr } = await admin
        .from("erp_sucursal_map").select("erp_sucursal_id, inv_ubicaciones").eq("branch_id", p.branch_id).maybeSingle();
      if (mapaErr) throw mapaErr;
      const ubic = (mapa?.inv_ubicaciones ?? []).find((u: { isVencidos?: boolean }) => !u.isVencidos);
      if (!mapa?.erp_sucursal_id || !ubic?.id) {
        await admin.rpc("puntos_premio_soltar", { p_id: id });
        tomado = null;
        return json({ ok: false, error: "Esta sucursal no tiene ubicación de inventario configurada." }, 422);
      }
      const concepto = conceptoDe(["PREMIO PUNTOS SALUD", p.codigo, p.cliente, `Entrega: ${quien.name}`]);
      const r = await descartarUnaLinea({
        erpSucursal: Number(mapa.erp_sucursal_id), erpUbicacion: Number(ubic.id), concepto,
        linea: { erp_product_id: Number(p.product_id), presentacion_tipo: p.presentacion_tipo,
                 factor: Number(p.factor), cantidad: Number(p.cantidad), descripcion: p.nombre },
      });
      if (!r.ok) {
        await admin.rpc("puntos_premio_soltar", { p_id: id });
        tomado = null;
        return json({ ok: false, codigo: r.codigo, error: r.error }, 409);
      }
      descartado = true;
      erp = r.aplicado;
    }

    // Cerrar. Después de un descarte que entró no se suelta nunca: se reintenta.
    let cierreErr: { message: string } | null = null;
    for (let i = 0; i < 3; i++) {
      const { error } = await admin.rpc("puntos_premio_cerrar", { p_id: id, p_employee: quien.id, p_erp: erp });
      cierreErr = error;
      if (!error) break;
      if (!descartado) break;   // un promocional sin existencia no mejora reintentando
      await new Promise((r) => setTimeout(r, 800));
    }
    if (cierreErr) {
      if (!descartado) {
        await admin.rpc("puntos_premio_soltar", { p_id: id });
        tomado = null;
        return json({ ok: false, error: cierreErr.message }, 409);
      }
      console.error("entregar-premio: descarte hecho y cierre fallido", id, cierreErr.message, erp);
      tomado = null;
      return json({
        ok: false, codigo: "CIERRE_PENDIENTE",
        error: `El producto ya se descargó, pero el premio no quedó marcado como entregado. No lo entregues de nuevo: avisa a administración con el código ${p.codigo}.`,
      }, 500);
    }
    tomado = null;
    return json({ ok: true, premio: { id, codigo: p.codigo, tipo: p.tipo, nombre: p.nombre, cantidad: p.cantidad, cliente: p.cliente }, erp });
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  } finally {
    // Algo lanzó entre tomar y descartar: el premio vuelve a estar disponible.
    if (tomado && !descartado) {
      await admin.rpc("puntos_premio_soltar", { p_id: tomado })
        .then(({ error }) => { if (error) console.error("puntos_premio_soltar:", error.message); });
    }
  }
});
