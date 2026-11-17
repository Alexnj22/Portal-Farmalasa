import { createClient } from "jsr:@supabase/supabase-js@2";
import { getCorsHeaders, permisoDeModulo, requireActiveEmployeeUser } from "../_shared/security.ts";
import { getCortesCreds } from "../_shared/creditos.ts";
import {
  borrarPreventaDeLaCaja, buscarPreventaEnLaCaja, enviarPreventaALaCaja, fechaDeLaCaja, preventaVivaEnLaCaja, sesionDeCaja,
} from "../_shared/preventaCaja.ts";
import { armarVenta } from "../../../src/utils/preventa.js";
import { login as entrarAlSistema } from "../_shared/erp-dte.ts";
import { fijarVineta, leerFichaDe } from "../_shared/erp-regulado.ts";

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
    if (ramas.length !== 1) return responder({ ok: false, error: "Esas reservas no son de una sola sucursal." }, 400);
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
    // Llegó a caja pero sin número: se busca por su referencia antes de
    // darla por anulada (si no, caja la seguiría teniendo para cobrar).
    if (!info.externo_id && info.estado === "sin_enlace") {
      try {
        const { username, password } = getCortesCreds();
        const http = await sesionDeCaja(username, password, Number(info.erp_sucursal));
        const fecha = await fechaDeLaCaja(http);
        const hallada = info.referencia
          ? await buscarPreventaEnLaCaja(http, fecha, {
            referencia: String(info.referencia), vendedor: String(info.vendedor ?? ""), productos: (info.productos ?? []).map(Number),
          })
          : null;
        if (!hallada) return responder({ ok: false, error: "No la encontramos en caja. Revísala allá antes de anularla." }, 409);
        info.externo_id = hallada.id;
      } catch (e) {
        return responder({ ok: false, error: (e as Error).message }, 502);
      }
    }
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
    p_puntos: Math.max(0, Math.trunc(Number(body.puntos) || 0)),
    p_total_esperado: Number.isFinite(Number(body.total_esperado)) && body.total_esperado != null ? Number(body.total_esperado) : null,
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
  // El lote que eligió quien vende viaja con la línea; no cambia precio ni
  // existencia (eso lo decidió la base), sólo de qué lote sale primero.
  const lotesPedidos = new Map<string, { nombre: string; vence: string | null }>();
  for (const l of Array.isArray(body.lineas) ? body.lineas : []) {
    const nombre = String(l?.lote?.nombre ?? "").trim().slice(0, 60);
    if (nombre) lotesPedidos.set(`${Number(l.producto_id)}|${Number(l.factor) || 1}`, { nombre, vence: l.lote.vence ? String(l.lote.vence).slice(0, 10) : null });
  }
  for (const r of venta.renglones) {
    const p = lotesPedidos.get(`${Number(r.producto_id)}|${Number(r.factor) || 1}`);
    if (p) r.lote = p;
  }
  // Un nombre con tilde o Ñ viaja como cliente genérico (defecto medido de la
  // caja, ver `clienteDeLaVenta`), y a un genérico no se le emite crédito fiscal
  // ni se le da crédito: se dice antes de mandar, no en la caja.
  if (venta.cliente.generico && datos.cliente && (venta.documento === "credito_fiscal" || venta.pago === "credito" || (venta.puntos ?? 0) > 0)) {
    return await fallar(venta.cliente.motivo === "nombre_con_tilde"
      ? "El nombre del cliente lleva tilde o Ñ y así no se puede emitir a su nombre. Corrígelo en sus datos."
      : "El cliente todavía no tiene número. Espera unos minutos o revísalo en Clientes.", 409, venta);
  }

  // Cobro con monto (2026-11-16): el monto que escribió administración es el
  // precio de esa presentación en la ficha del producto; se pone justo antes
  // de mandar, para que la caja lo encuentre entre sus precios. La base ya
  // decidió quién puede (`preventa_directa_preparar`). Tres cuidados
  // (auditoría del 2026-11-16):
  //   · se pone DESPUÉS de saber que la caja está abierta y que la preventa a
  //     corregir sigue viva: si no, quedaba cambiado sin venta;
  //   · uno a la vez por producto (`preventa_cobro_turno`): dos a la vez se
  //     pisaban el monto;
  //   · si el envío falla, el precio vuelve al que tenía.
  const cobros = (venta.renglones ?? []).filter((r: { cobro_con_monto?: boolean }) => r.cobro_con_monto);
  let filasCobro: { product_id: number; id_pres_prod_erp: string }[] = [];
  if (cobros.length) {
    const { data, error: eCob } = await admin.from("preventa_cobros_con_monto")
      .select("product_id, id_pres_prod_erp").in("product_id", cobros.map((r: { producto_id: number }) => Number(r.producto_id)));
    if (eCob) return await fallar("No se pudo leer qué presentación lleva el monto.", 503);
    filasCobro = data ?? [];
  }
  const turnos: number[] = [];
  const devolver: { cookie: string; id: number; prp: string; precio: number }[] = [];
  const soltar = async () => {
    for (const id of turnos) {
      const { error } = await admin.rpc("preventa_cobro_turno", { p_product: id, p_tomar: false });
      if (error) console.error("[preventa-caja] soltar turno:", error.message);
    }
  };
  const deshacer = async () => {
    for (const d of devolver) {
      try { await fijarVineta(d.cookie, d.id, d.prp, d.precio); } catch (e) {
        console.error("[preventa-caja] no se pudo devolver el precio:", d.id, (e as Error).message);
      }
    }
  };

  let resultado;
  try {
    const { username, password } = getCortesCreds();
    const http = await sesionDeCaja(username, password, Number(datos.erp_sucursal));
    await fechaDeLaCaja(http);
    if (datos.externo_id) {
      const viva = await preventaVivaEnLaCaja(http, String(datos.externo_id), vendedorPrevio);
      if (!viva.viva) return await fallar(viva.motivo, 409);
    }
    if (cobros.length) {
      for (const r of cobros) {
        const { data: tengo, error: eT } = await admin.rpc("preventa_cobro_turno", { p_product: Number(r.producto_id), p_tomar: true });
        if (eT) return await fallar("No se pudo apartar el cobro.", 503, venta);
        if (!tengo) return await fallar(`Otra persona está cobrando «${r.nombre}» en este momento. Espera un minuto y envía de nuevo.`, 409, venta);
        turnos.push(Number(r.producto_id));
      }
      try {
        const cookie = await entrarAlSistema();
        for (const r of cobros) {
          const f = filasCobro.find((x) => Number(x.product_id) === Number(r.producto_id));
          if (!f) throw new Error(`«${r.nombre}» no dice qué presentación lleva el monto.`);
          const ficha = await leerFichaDe(cookie, Number(r.producto_id));
          const antes = parseFloat(ficha.presentaciones.find((p) => p.id_prp === String(f.id_pres_prod_erp))?.precios[0] ?? "");
          await fijarVineta(cookie, Number(r.producto_id), String(f.id_pres_prod_erp), Number(r.precio));
          if (antes > 0 && Math.abs(antes - Number(r.precio)) >= 0.00005) {
            devolver.push({ cookie, id: Number(r.producto_id), prp: String(f.id_pres_prod_erp), precio: antes });
          }
        }
      } catch (e) {
        console.error("[preventa-caja] cobro con monto:", (e as Error).message);
        await deshacer();
        return await fallar((e as Error).message, 502, venta);
      }
    }
    try {
      resultado = await enviarPreventaALaCaja(http, venta, { idFactura: datos.externo_id ?? null });
    } catch (e) {
      await deshacer();
      throw e;
    }
  } catch (e) {
    console.error("[preventa-caja] directa:", (e as Error).message);
    return await fallar((e as Error).message, 502, venta);
  } finally {
    await soltar();
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
