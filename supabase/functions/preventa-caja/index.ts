import { createClient } from "jsr:@supabase/supabase-js@2";
import { getCorsHeaders, permisoDeModulo, requireActiveEmployeeUser } from "../_shared/security.ts";
import { getCortesCreds } from "../_shared/creditos.ts";
import { enviarPreventaALaCaja, sesionDeCaja } from "../_shared/preventaCaja.ts";
import { armarVenta } from "../../../src/utils/preventa.js";

// ═══════════════════════════════════════════════════════════════════════════
// PREVENTA DE UNA RESERVA — dejar la venta lista en la caja (2026-10-21).
//
// La sala aprieta «Enviar a caja» en una reserva y la caja la encuentra ya
// armada: producto, cliente y vendedor (quien la envía; los cargos de
// administración firman con 1000). Cuando esa venta se factura, la reserva se
// cierra sola (`preventas_cerrar_facturadas`, cron).
//
// Tres piezas, cada una con su trabajo:
//   · la BASE decide si se puede (`preventa_preparar`: permiso, sala, estado,
//     receta, una sola preventa viva) y guarda en qué quedó (`preventa_registrar`);
//   · el NÚCLEO arma la venta (`armarVenta`, `src/utils/preventa.js`);
//   · el ADAPTADOR la traduce a la caja de hoy (`_shared/preventaCaja.ts`).
// El día que se facture en el portal, se cambia sólo el adaptador.
//
// La llama el NAVEGADOR con la sesión de quien la envía: va con JWT (no está
// en la lista de las que llama un cron).
//
// ── Freno por sucursal ─────────────────────────────────────────────────────
// Editar reservas, y la sala propia salvo alcance de toda la red. Se mira acá
// con la sala de la RESERVA —nunca la que diga el navegador— y la base lo
// vuelve a mirar en `preventa_preparar`.
// ═══════════════════════════════════════════════════════════════════════════

const json = (b: unknown, s = 200, h: HeadersInit = {}) =>
  new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json", ...h } });

const MENSAJES: Record<string, string> = {
  FORBIDDEN: "No puedes enviar preventas de esa sucursal.",
};

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const responder = (b: unknown, s = 200) => json(b, s, cors);

  try {
    const body = await req.json().catch(() => ({}));
    const accion = String(body.accion ?? "enviar");
    if (accion !== "enviar") return responder({ ok: false, error: "Acción desconocida." }, 400);

    const ids = (Array.isArray(body.reservas) ? body.reservas : [body.reserva])
      .map((x: unknown) => Number(x)).filter((x: number) => Number.isInteger(x) && x > 0);
    if (!ids.length || ids.length > 20) return responder({ ok: false, error: "No se dijo qué reserva." }, 400);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const quien = await requireActiveEmployeeUser(req, admin);
    if (!quien) return responder({ ok: false, error: "Sesión inválida o empleado inactivo." }, 401);

    const permiso = await permisoDeModulo(admin, quien.id, "reservas", "can_edit");
    if (permiso.roto) return responder({ ok: false, error: permiso.roto }, 503);
    if (!permiso.puede) return responder({ ok: false, error: "No tienes permiso para enviar preventas." }, 403);

    const { data: salas, error: eSalas } = await admin.from("app_reservas").select("branch_id").in("id", ids);
    if (eSalas) return responder({ ok: false, error: "No se pudieron leer las reservas." }, 503);
    const ramas = [...new Set((salas ?? []).map((s: { branch_id: number }) => Number(s.branch_id)))];
    if (ramas.length !== 1) return responder({ ok: false, error: "Esas reservas no son de una sola sala." }, 400);
    if (!permiso.alcanceTodo && Number(permiso.emp?.branch_id) !== ramas[0]) {
      return responder({ ok: false, error: MENSAJES.FORBIDDEN }, 403);
    }

    // La base decide y deja la preventa «enviando» (una sola viva por reserva).
    const { data: datos, error: ePrep } = await admin.rpc("preventa_preparar", { p_employee: quien.id, p_reservas: ids });
    if (ePrep) {
      const m = String(ePrep.message ?? "");
      return responder({ ok: false, error: MENSAJES[m] ?? m }, m === "FORBIDDEN" ? 403 : 409);
    }
    const preventaId = Number(datos.preventa_id);

    let venta;
    try {
      venta = armarVenta(datos);
    } catch (e) {
      const { error: eFalla } = await admin.rpc("preventa_registrar", { p_id: preventaId, p_ok: false, p_error: (e as Error).message });
      if (eFalla) console.error("[preventa-caja] registrar fallida:", eFalla.message);
      return responder({ ok: false, error: (e as Error).message }, 409);
    }

    let resultado;
    try {
      const { username, password } = getCortesCreds();
      const http = await sesionDeCaja(username, password, Number(datos.erp_sucursal));
      resultado = await enviarPreventaALaCaja(http, venta);
    } catch (e) {
      const m = (e as Error).message;
      console.error("[preventa-caja] envío:", m);
      const { error: eReg } = await admin.rpc("preventa_registrar", { p_id: preventaId, p_ok: false, p_venta: venta, p_error: m });
      if (eReg) console.error("[preventa-caja] registrar fallida:", eReg.message);
      return responder({ ok: false, error: m }, 502);
    }

    const { data: reg, error: eReg } = await admin.rpc("preventa_registrar", {
      p_id: preventaId, p_ok: true, p_venta: venta, p_externo_id: resultado.externo_id,
      p_externo_ref: resultado.referencia,
      p_destino: { total_caja: resultado.total_caja, renglones: resultado.renglones_caja, avisos: resultado.avisos },
    });
    if (eReg) {
      // La preventa YA está en la caja: se dice con su número para que nadie la mande otra vez.
      console.error("[preventa-caja] registrar:", eReg.message);
      return responder({ ok: false, error: `La preventa #${resultado.referencia} quedó en la caja, pero el portal no la pudo guardar.` }, 500);
    }

    return responder({
      ok: true, preventa: reg, referencia: resultado.referencia, externo_id: resultado.externo_id,
      cliente_generico: venta.cliente.generico, total_caja: resultado.total_caja, avisos: resultado.avisos,
    });
  } catch (e) {
    console.error("[preventa-caja]", (e as Error).message);
    return responder({ ok: false, error: "No se pudo enviar la preventa." }, 500);
  }
});
