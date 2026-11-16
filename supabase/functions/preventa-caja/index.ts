import { createClient } from "jsr:@supabase/supabase-js@2";
import { getCorsHeaders, permisoDeModulo, requireActiveEmployeeUser } from "../_shared/security.ts";
import { getCortesCreds } from "../_shared/creditos.ts";
import { borrarPreventaDeLaCaja, enviarPreventaALaCaja, preventaVivaEnLaCaja, sesionDeCaja } from "../_shared/preventaCaja.ts";
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
    if (accion === "directa" || accion === "anular") return await directa(req, accion, body, responder);
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


// ═══════════════════════════════════════════════════════════════════════════
// LA PREVENTA DIRECTA — la vista Preventa (2026-11-16).
//
// Quien vende arma la venta en el portal (cliente, productos, documento) y
// llega a la caja con el precio que le toca al cliente. Mientras no se
// facture, se CORRIGE sobre la misma preventa (la caja la reescribe con su
// número) o se ANULA (se borra de la caja).
//
// La base decide todo lo que importa (`preventa_directa_preparar`: permiso del
// módulo `preventa` y sucursal, precio por cliente, existencia, autorización de
// otro precio) y esto sólo lo lleva a la caja. Antes de corregir o borrar se
// relee la preventa en la caja: si ya no está (se facturó o la borraron allá),
// no se escribe encima.
// ═══════════════════════════════════════════════════════════════════════════
async function directa(
  req: Request, accion: string, body: Record<string, unknown>,
  responder: (b: unknown, s?: number) => Response,
) {
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const quien = await requireActiveEmployeeUser(req, admin);
  if (!quien) return responder({ ok: false, error: "Sesión inválida o empleado inactivo." }, 401);
  const permiso = await permisoDeModulo(admin, quien.id, "preventa", "can_edit");
  if (permiso.roto) return responder({ ok: false, error: permiso.roto }, 503);
  if (!permiso.puede) return responder({ ok: false, error: "No tienes permiso para hacer preventas." }, 403);
  const motivoDe = (m: string) => (m === "FORBIDDEN" ? "No puedes hacer preventas en esa sucursal." : m);

  // ── Anular ──────────────────────────────────────────────────────────────
  if (accion === "anular") {
    const id = Number(body.preventa_id);
    if (!Number.isInteger(id) || id <= 0) return responder({ ok: false, error: "No se dijo qué preventa." }, 400);
    const { data: info, error: eInfo } = await admin.rpc("preventa_anular", { p_employee: quien.id, p_id: id, p_paso: "revisar" });
    if (eInfo) return responder({ ok: false, error: motivoDe(String(eInfo.message ?? "")) }, eInfo.message === "FORBIDDEN" ? 403 : 409);
    if (info.externo_id) {
      try {
        const { username, password } = getCortesCreds();
        const http = await sesionDeCaja(username, password, Number(info.erp_sucursal));
        const viva = await preventaVivaEnLaCaja(http, String(info.externo_id), info.vendedor ?? null);
        // Si no está en la lista puede estar facturada y todavía no llegó la
        // factura: marcarla anulada sería perder una venta. Se dice y se deja.
        if (!viva.viva) return responder({ ok: false, error: viva.motivo }, 409);
        await borrarPreventaDeLaCaja(http, String(info.externo_id), {
          vendedor: String(info.vendedor ?? ""), productos: (info.productos ?? []).map(Number),
        });
      } catch (e) {
        return responder({ ok: false, error: (e as Error).message }, 502);
      }
    }
    const { data: hecho, error: eHecho } = await admin.rpc("preventa_anular", { p_employee: quien.id, p_id: id, p_paso: "confirmar" });
    if (eHecho) {
      console.error("[preventa-caja] anular quedó a medias:", eHecho.message);
      return responder({ ok: false, error: `Se borró de la caja, pero el portal no la pudo marcar: ${eHecho.message}` }, 500);
    }
    return responder({ ok: true, preventa: hecho });
  }

  // ── Crear o corregir ────────────────────────────────────────────────────
  const corrige = body.preventa_id != null ? Number(body.preventa_id) : null;
  let vendedorPrevio: string | null = null;
  if (corrige) {
    const { data: previa, error: ePrev } = await admin.from("preventas").select("vendedor_codigo").eq("id", corrige).maybeSingle();
    if (ePrev) return responder({ ok: false, error: "No se pudo leer la preventa." }, 503);
    vendedorPrevio = previa?.vendedor_codigo ?? null;
  }
  const { data: datos, error: ePrep } = await admin.rpc("preventa_directa_preparar", {
    p_employee: quien.id, p_branch: Number(body.branch_id), p_customer: body.customer_id ? Number(body.customer_id) : null,
    p_documento: String(body.documento ?? "consumidor_final"), p_nota: String(body.nota ?? ""),
    p_lineas: Array.isArray(body.lineas) ? body.lineas : [], p_preventa: corrige,
    p_motivo_precio: body.motivo_precio ? String(body.motivo_precio) : null,
    p_pago: String(body.pago ?? "contado"),
  });
  if (ePrep) {
    const m = String(ePrep.message ?? "");
    return responder({ ok: false, error: motivoDe(m) }, m === "FORBIDDEN" ? 403 : 409);
  }
  const preventaId = Number(datos.preventa_id);
  const fallar = async (m: string, status: number, venta: unknown = null) => {
    const { error } = await admin.rpc("preventa_registrar", { p_id: preventaId, p_ok: false, p_venta: venta, p_error: m });
    if (error) console.error("[preventa-caja] registrar fallida:", error.message);
    return responder({ ok: false, error: m }, status);
  };

  let venta;
  try { venta = armarVenta(datos); } catch (e) { return await fallar((e as Error).message, 409); }
  // Un nombre con tilde o Ñ viaja como cliente genérico (defecto medido de la
  // caja, ver `clienteDeLaVenta`), y a un genérico no se le emite crédito fiscal
  // ni se le da crédito: se dice antes de mandar, no en la caja.
  if (venta.cliente.generico && datos.cliente && (venta.documento === "credito_fiscal" || venta.pago === "credito")) {
    return await fallar(venta.cliente.motivo === "nombre_con_tilde"
      ? "El nombre del cliente lleva tilde o Ñ y así no se puede emitir a su nombre. Corrígelo en sus datos."
      : "El cliente todavía no tiene número de ficha: espera unos minutos o revísalo en Clientes.", 409);
  }

  let resultado;
  try {
    const { username, password } = getCortesCreds();
    const http = await sesionDeCaja(username, password, Number(datos.erp_sucursal));
    if (datos.externo_id) {
      const viva = await preventaVivaEnLaCaja(http, String(datos.externo_id), vendedorPrevio);
      if (!viva.viva) return await fallar(viva.motivo, 409);
    }
    resultado = await enviarPreventaALaCaja(http, venta, { idFactura: datos.externo_id ?? null });
  } catch (e) {
    console.error("[preventa-caja] directa:", (e as Error).message);
    return await fallar((e as Error).message, 502, venta);
  }

  const { data: reg, error: eReg } = await admin.rpc("preventa_registrar", {
    p_id: preventaId, p_ok: true, p_venta: { ...venta, motivo_precio: datos.motivo_precio ?? null },
    p_externo_id: resultado.externo_id, p_externo_ref: resultado.referencia,
    p_destino: { total_caja: resultado.total_caja, renglones: resultado.renglones_caja, avisos: resultado.avisos },
  });
  if (eReg) {
    console.error("[preventa-caja] registrar directa:", eReg.message);
    return responder({ ok: false, error: `La preventa #${resultado.referencia} quedó en caja, pero el portal no la pudo guardar.` }, 500);
  }
  return responder({
    ok: true, preventa: reg, codigo: datos.codigo, referencia: resultado.referencia, externo_id: resultado.externo_id,
    corregida: Boolean(datos.externo_id), cliente_generico: venta.cliente.generico,
    total_caja: resultado.total_caja, avisos: resultado.avisos,
  });
}
