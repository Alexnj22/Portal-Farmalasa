import { createClient } from "jsr:@supabase/supabase-js@2";
import { getCorsHeaders, permisoDeModulo, requireActiveEmployeeUser } from "../_shared/security.ts";
import { getCortesCreds } from "../_shared/creditos.ts";
import {
  borrarPreventaDeLaCaja, buscarPreventaEnLaCaja, enviarPreventaALaCaja, fechaDeLaCaja, finalizarEnLaCaja, guardarEnLaCaja, listaDeLaCaja,
  prepararCobroEnLaCaja, preventaVivaEnLaCaja, sesionDeCaja,
} from "../_shared/preventaCaja.ts";
import { armarFinalizado, CODIGO_DE_PAGO } from "../../../src/utils/cobroDeCaja.js";
import { armarVenta } from "../../../src/utils/preventa.js";
import { enviarDteAlMH, login as entrarAlSistema } from "../_shared/erp-dte.ts";
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
    if (accion === "cobrar") return await cobrar(req, body, responder);
    if (accion === "cola") return await colaDeLaCaja(req, body, responder);
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
        // factura: marcarla anulada sería perder una venta. Se pregunta a quien
        // anula si la borraron allá (2026-11-17: borrada en caja, el portal la
        // seguía mostrando «En caja» y no había cómo sacarla). Si dice que sí y
        // no hay factura con ese número, se marca anulada; si después aparece
        // facturada, el cierre automático la pasa a facturada igual.
        if (!viva.viva) {
          if (!("fuera" in viva && viva.fuera)) return responder({ ok: false, error: viva.motivo }, 409);
          if (body.borrada_en_caja !== true) return responder({ ok: false, error: viva.motivo, no_en_caja: true }, 409);
          const { data: fac, error: eFac } = await admin.from("sales_invoices").select("id")
            .eq("erp_invoice_id", String(info.externo_id)).eq("branch_id", Number(info.branch_id ?? 0)).limit(1);
          if (eFac) return responder({ ok: false, error: "No se pudo revisar si se facturó. Intenta de nuevo." }, 502);
          if (fac?.length) return responder({ ok: false, error: "Esa preventa ya se facturó. En un momento sale como facturada." }, 409);
        } else {
          await borrarPreventaDeLaCaja(http, String(info.externo_id), {
            vendedor: String(info.vendedor ?? ""), productos: (info.productos ?? []).map(Number),
          });
        }
      } catch (e) {
        return responder({ ok: false, error: (e as Error).message }, 502);
      }
    }
    const { data: hecho, error: eHecho } = await admin.rpc("preventa_anular", { p_employee: quien.id, p_id: id, p_paso: "confirmar" });
    if (eHecho) {
      console.error("[preventa-caja] anular quedó a medias:", eHecho.message);
      return responder({ ok: false, error: `Se borró de la caja, pero el portal no la pudo marcar: ${eHecho.message}` }, 500);
    }
    if (body.borrada_en_caja === true) {
      // La marca deja que el cierre automático la pase a facturada si resulta que sí se cobró.
      const { error: eMarca } = await admin.from("preventas").update({ error: "La borraron en caja." }).eq("id", id);
      if (eMarca) console.error("[preventa-caja] marca de borrada:", eMarca.message);
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
    return await fallar("El cliente todavía no tiene número. Espera unos minutos o revísalo en Clientes.", 409, venta);
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
  let httpCaja: Awaited<ReturnType<typeof sesionDeCaja>> | null = null;
  try {
    const { username, password } = getCortesCreds();
    const http = await sesionDeCaja(username, password, Number(datos.erp_sucursal));
    httpCaja = http;
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
  // Ensayo del cobro en paralelo (etapa 1 del cobro desde el kiosco,
  // 2026-11-18): recién enviada, la preventa SEGURO existe en la caja, y se
  // le arma el cobro que haría el kiosco SIN mandarlo. Revisar la caja cada
  // minuto no servía: el usuario midió que la preventa se guarda, se lleva a
  // caja y se finaliza en el mismo momento. Corre DESPUÉS de responder (no hace
  // esperar a quien vende) y nunca hace fallar el envío. Lo compara
  // `cobro_caja_ensayo_comparar()` cuando la factura llega.
  const ensayar = async () => {
    try {
      if (!httpCaja || !resultado?.externo_id) return;
      const ext = String(resultado.externo_id);
      // La sala que ya validó `preventa_directa_preparar` (permiso y alcance).
      const sucursalDelEnsayo = Number(body.branch_id);
      const plan = await prepararCobroEnLaCaja(httpCaja, ext, { total: null, efectivo: 1e9 })
        .catch((e) => ({ error: (e as Error).message }));
      const { data: prev, error: ePrevEns } = await admin.from("cobro_caja_ensayos").select("veces")
        .eq("branch_id", sucursalDelEnsayo).eq("externo_id", ext).maybeSingle();
      if (ePrevEns) { console.error("[preventa-caja] ensayo:", ePrevEns.message); return; }
      const { error: eEns } = await admin.from("cobro_caja_ensayos").upsert({
        branch_id: sucursalDelEnsayo, externo_id: ext, referencia: String(resultado.referencia ?? ""),
        total_caja: resultado.total_caja ?? null, plan, captado_at: new Date().toISOString(),
        veces: Number(prev?.veces ?? 0) + 1, comparado_at: null, cuadra: null, diferencias: null,
      }, { onConflict: "branch_id,externo_id" });
      if (eEns) console.error("[preventa-caja] ensayo:", eEns.message);
    } catch (e) {
      console.error("[preventa-caja] ensayo:", (e as Error).message);
    }
  };
  // deno-lint-ignore no-explicit-any
  const rt = (globalThis as any).EdgeRuntime;
  if (rt?.waitUntil) rt.waitUntil(ensayar()); else await ensayar();

  return responder({
    ok: true, preventa: reg, codigo: datos.codigo, referencia: resultado.referencia, externo_id: resultado.externo_id,
    corregida: Boolean(datos.externo_id), cliente_generico: venta.cliente.generico,
    total_caja: resultado.total_caja, avisos: resultado.avisos,
  });
}


// ── Cobrar una preventa desde el kiosco de caja ────────────────────────────
// Dos modos:
//   · `ensayo: true` (2026-11-17): lee la preventa en la caja y devuelve lo que
//     se le mandaría, sin mandarlo.
//   · el cobro de verdad (etapa 2, 2026-11-18): los mismos pasos que la
//     pantalla de la caja —guardar (F2 Pagar) y finalizar con el efectivo— y
//     después Hacienda, con la misma rutina del envío de cada noche. SÓLO si la
//     sucursal tiene el cobro encendido (`cobro_kiosco_sucursales`).
// Permiso: el de la caja (`caja_vales` editar), en la sala de la PREVENTA.
//
// El candado y la constancia de cada paso viven en `cobro_kiosco_cobros` (una
// fila por preventa). Cada paso que escribe en la caja queda anotado ANTES de
// seguir, así un cobro cortado se retoma desde lo que falta:
//   · ya `finalizada` → no se toca: se devuelve lo que quedó;
//   · `guardada`      → falta finalizar: se finaliza (con el efectivo nuevo);
//   · `cobrando` o `incierta` → no se sabe si la caja escribió: NO se reintenta;
//     se revisa en la caja.
async function cobrar(req: Request, body: Record<string, unknown>, responder: (b: unknown, s?: number) => Response) {
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const quien = await requireActiveEmployeeUser(req, admin);
  if (!quien) return responder({ ok: false, error: "Sesión inválida o empleado inactivo." }, 401);
  const permiso = await permisoDeModulo(admin, quien.id, "caja_vales", "can_edit");
  if (permiso.roto) return responder({ ok: false, error: permiso.roto }, 503);
  if (!permiso.puede) return responder({ ok: false, error: "No tienes permiso para cobrar." }, 403);
  const ensayo = body.ensayo === true;

  const id = Number(body.preventa_id);
  let efectivo = Number(body.efectivo);
  if (!Number.isInteger(id) || id <= 0) return responder({ ok: false, error: "No se dijo qué preventa." }, 400);
  if (!Number.isFinite(efectivo) || efectivo < 0) return responder({ ok: false, error: "Falta el efectivo recibido." }, 400);
  // La forma de pago y sus datos (POS y boleta, banco y referencia…). Sólo las
  // claves conocidas y cortas: van a la caja como texto.
  const pago = ensayo && body.pago == null ? undefined : String(body.pago ?? "contado");
  if (pago !== undefined && !(pago in CODIGO_DE_PAGO)) return responder({ ok: false, error: "Elige la forma de pago." }, 400);
  const detalle: Record<string, string> = {};
  const bruto = (body.detalle && typeof body.detalle === "object") ? body.detalle as Record<string, unknown> : {};
  for (const k of ["terminal", "boleta", "banco", "referencia", "numero"]) {
    const v = String(bruto[k] ?? "").trim().slice(0, 40);
    if (v) detalle[k] = v;
  }

  const { data: pv, error: ePv } = await admin.from("preventas")
    .select("id, branch_id, estado, sistema, externo_id, externo_ref, total").eq("id", id).maybeSingle();
  if (ePv) return responder({ ok: false, error: "No se pudo leer la preventa." }, 503);
  if (!pv || pv.sistema !== "caja") return responder({ ok: false, error: "Esa preventa no existe." }, 404);
  if (!permiso.alcanceTodo && Number(permiso.emp?.branch_id) !== Number(pv.branch_id)) {
    return responder({ ok: false, error: "No puedes cobrar en esa sucursal." }, 403);
  }

  // Un cobro que ya empezó manda sobre el estado de la preventa: una vez
  // finalizada, la preventa deja de estar «viva» y aun así hay que contestar.
  let previo: Record<string, any> | null = null;
  if (!ensayo) {
    const { data: sw, error: eSw } = await admin.from("cobro_kiosco_sucursales")
      .select("encendido").eq("branch_id", pv.branch_id).maybeSingle();
    if (eSw) return responder({ ok: false, error: "No se pudo saber si el cobro está encendido." }, 503);
    if (!sw?.encendido) return responder({ ok: false, error: "El cobro desde el kiosco no está encendido en esta sucursal." }, 409);
    const { data: c, error: eC } = await admin.from("cobro_kiosco_cobros").select("*").eq("preventa_id", id).maybeSingle();
    if (eC) return responder({ ok: false, error: "No se pudo leer el cobro." }, 503);
    previo = c;
    if (previo?.estado === "finalizada") return responder({ ok: true, ya_cobrada: true, ...resumenDeCobro(previo, pv) });
    if (previo && previo.estado !== "guardada") {
      return responder({ ok: false, error: `La preventa #${pv.externo_ref ?? id} ya se empezó a cobrar y no se sabe si la caja la guardó. Revísala en la caja antes de volver a cobrar.` }, 409);
    }
  }
  if (!previo && (pv.estado !== "viva" || !pv.externo_id)) return responder({ ok: false, error: "Esa preventa no está lista para cobrar." }, 409);

  const { data: mapa, error: eMapa } = await admin.from("erp_sucursal_map")
    .select("erp_sucursal_id").eq("branch_id", pv.branch_id).eq("es_bodega", false).maybeSingle();
  if (eMapa || !mapa) return responder({ ok: false, error: "No se sabe qué sala de la caja es esta sucursal." }, 503);

  const externo = String(pv.externo_id);
  let http;
  try {
    const { username, password } = getCortesCreds();
    http = await sesionDeCaja(username, password, Number(mapa.erp_sucursal_id));
  } catch (e) {
    return responder({ ok: false, error: (e as Error).message }, 502);
  }

  const anotar = async (cambios: Record<string, unknown>) => {
    const { error } = await admin.from("cobro_kiosco_cobros")
      .update({ ...cambios, updated_at: new Date().toISOString() }).eq("preventa_id", id);
    if (error) console.error(`[preventa-caja] cobro ${id}:`, error.message);
    return !error;
  };

  let fila = previo;
  if (!fila) {
    let plan;
    try {
      plan = await prepararCobroEnLaCaja(http, externo, { total: pv.total == null ? null : Number(pv.total), efectivo, pago, detalle });
    } catch (e) {
      return responder({ ok: false, error: (e as Error).message }, 502);
    }
    if (ensayo) return responder({ ok: true, ensayo: true, ...plan });
    if (plan.motivo) return responder({ ok: false, error: plan.motivo }, 409);
    // Lo que no es efectivo se cobra completo: no hay vuelto.
    if (pago !== "contado") efectivo = plan.totales.total;

    if (pago === "credito") {
      // Crédito sólo a quien no debe nada vencido (el espejo de cuentas por cobrar).
      const { data: cli, error: eCli } = await admin.from("customers").select("id").eq("erp_id", String(plan.cabecera.id_cliente)).maybeSingle();
      if (eCli) return responder({ ok: false, error: "No se pudo leer el cliente." }, 503);
      if (cli) {
        const hoy = new Date(Date.now() - 6 * 3600_000).toISOString().slice(0, 10);
        const { count, error: eVen } = await admin.from("creditos_de_clientes").select("id", { count: "exact", head: true })
          .eq("customer_id", cli.id).eq("estado", "PENDIENTE").gt("saldo", 0).lt("vencio_el", hoy);
        if (eVen) return responder({ ok: false, error: "No se pudieron leer los créditos del cliente." }, 503);
        if ((count ?? 0) > 0) return responder({ ok: false, error: "El cliente tiene créditos vencidos. Que pague primero o cóbrale de otra forma." }, 409);
      }
    }
    if (pago === "tarjeta") {
      // Misma terminal, misma boleta y mismo monto en los últimos días: es la misma operación.
      const desde = new Date(Date.now() - 3 * 86400_000).toISOString();
      const { data: rep, error: eRep } = await admin.from("cobro_kiosco_cobros").select("externo_id, total")
        .eq("pago", "tarjeta").eq("detalle->>terminal", detalle.terminal).eq("detalle->>boleta", detalle.boleta).gte("created_at", desde);
      if (eRep) return responder({ ok: false, error: "No se pudo revisar la boleta." }, 503);
      if ((rep ?? []).some((r: { total: number }) => Math.abs(Number(r.total) - plan.totales.total) < 0.005)) {
        return responder({ ok: false, error: `La boleta ${detalle.boleta} de ese POS ya se usó en otra venta por el mismo monto.` }, 409);
      }
    }

    // El candado: dos toques (o dos equipos) no cobran dos veces.
    const { data: nueva, error: eIns } = await admin.from("cobro_kiosco_cobros").insert({
      preventa_id: id, branch_id: pv.branch_id, externo_id: externo, empleado_id: quien.id,
      total: plan.totales.total, efectivo, pago, detalle, respuestas: { cabecera: plan.cabecera, caja: plan.caja },
    }).select("*").single();
    if (eIns) {
      return eIns.code === "23505"
        ? responder({ ok: false, error: "Esa preventa ya se está cobrando." }, 409)
        : responder({ ok: false, error: "No se pudo empezar el cobro." }, 503);
    }

    const g = await guardarEnLaCaja(http, plan.guardado);
    if (!g.ok && g.rechazo) {
      // La caja dijo que no: no escribió nada. Se suelta el candado.
      const { error: eDel } = await admin.from("cobro_kiosco_cobros").delete().eq("preventa_id", id).eq("estado", "cobrando");
      if (eDel) console.error(`[preventa-caja] soltar ${id}:`, eDel.message);
      return responder({ ok: false, error: `La caja no guardó la venta: ${g.rechazo}` }, 409);
    }
    if (!g.ok) {
      await anotar({ estado: "incierta", error: g.incierta });
      return responder({ ok: false, error: "No se sabe si la caja guardó la venta. Revísala en la caja antes de volver a cobrar." }, 502);
    }
    const numero = String(g.resp.numdoc ?? g.resp.ultimo ?? "") || null;
    const respuestas = { ...nueva.respuestas, guardado: g.resp };
    if (!(await anotar({ estado: "guardada", numero, respuestas, error: null }))) {
      return responder({ ok: false, error: `La caja guardó la venta #${pv.externo_ref ?? id}, pero el portal no lo pudo anotar. Finalízala en la caja.` }, 500);
    }
    fila = { ...nueva, estado: "guardada", numero, respuestas };
  } else if (ensayo) {
    return responder({ ok: false, error: "Esa preventa ya se está cobrando." }, 409);
  }

  // ── Finalizar con el efectivo ──
  const { cabecera, caja, guardado } = fila.respuestas ?? {};
  if (!cabecera || !caja || !guardado) return responder({ ok: false, error: "Al cobro le faltan datos para finalizar. Finalízala en la caja." }, 500);
  if (fila.pago && fila.pago !== "contado") efectivo = Number(fila.total ?? 0);
  if (!(efectivo >= Number(fila.total ?? 0))) return responder({ ok: false, error: "El efectivo no alcanza para el total." }, 409);
  const fin = armarFinalizado({ cabecera, guardado: { ...guardado, id_factura: guardado.id_factura ?? externo }, caja, efectivo });
  const f = await finalizarEnLaCaja(http, fin);
  if (!f.ok && f.rechazo) {
    await anotar({ efectivo, error: f.rechazo });
    return responder({ ok: false, error: `La caja guardó la venta pero no la finalizó: ${f.rechazo}. Intenta cobrar otra vez.` }, 409);
  }
  if (!f.ok) {
    await anotar({ estado: "incierta", efectivo, error: f.incierta });
    return responder({ ok: false, error: "No se sabe si la caja finalizó la venta. Revísala en la caja." }, 502);
  }
  const respuestasFin = { ...fila.respuestas, finalizado: f.resp };
  await anotar({ estado: "finalizada", efectivo, respuestas: respuestasFin, error: null });

  // ── Hacienda ── nunca tumba el cobro: lo que no se mande ahora lo manda el
  // envío de cada noche, como a cualquier factura.
  const mh = await mandarAHacienda(admin, {
    externo, tipo: String(cabecera.tipo_documento), branch: Number(pv.branch_id),
    clienteErp: String(cabecera.id_cliente ?? ""), deshabilitar: Number(f.resp.deshabilitar ?? 0) === 1,
  });
  await anotar({ mh });

  return responder({ ok: true, ...resumenDeCobro({ ...fila, estado: "finalizada", efectivo, mh, respuestas: respuestasFin }, pv) });
}

function resumenDeCobro(c: Record<string, any>, pv: Record<string, any>) {
  const total = Number(c.total ?? 0);
  const efectivo = Number(c.efectivo ?? 0);
  const g = c.respuestas?.guardado ?? {};
  return {
    referencia: pv.externo_ref ?? null, externo_id: c.externo_id, total, efectivo,
    vuelto: Math.round((efectivo - total) * 100) / 100, numero: c.numero ?? null,
    documento: c.respuestas?.cabecera?.tipo_documento ?? null, cliente: g.nombre ?? null,
    mh: c.mh ?? null, pago: c.pago ?? "contado", detalle: c.detalle ?? {},
    // El ticket OFICIAL de la caja, tal como lo arma ella al finalizar: el
    // kiosco lo manda al mismo programa de impresión de la computadora de la
    // caja (que también abre la gaveta).
    ticket: ticketDeLaCaja(c.respuestas?.finalizado),
  };
}

function ticketDeLaCaja(f: Record<string, unknown> | undefined) {
  if (!f || f.facturar == null || !f.dir_print) return null;
  return {
    facturar: f.facturar, headers: f.headers ?? null, footers: f.footers ?? null,
    dir_print: String(f.dir_print), sist_ope: String(f.sist_ope ?? ""), shared_printer_pos: f.shared_printer_pos ?? null,
  };
}

// La regla de las 6 pm (`cof_no_se_envia_mh`), la pausa por sucursal y el
// interruptor de la propia caja (`deshabilitar`): lo mismo que mira el envío de
// cada noche. Si algo no se puede leer, NO se manda (lo levanta la noche).
async function mandarAHacienda(
  admin: ReturnType<typeof createClient>,
  d: { externo: string; tipo: string; branch: number; clienteErp: string; deshabilitar: boolean },
): Promise<Record<string, unknown>> {
  if (d.deshabilitar) return { enviado: false, motivo: "La caja tiene el envío apagado." };
  if (d.tipo !== "COF") return { enviado: false, motivo: `Un ${d.tipo} se manda con el envío de la noche.` };
  const { data: pausa, error: ePausa } = await admin.from("dte_sucursales_en_pausa").select("motivo").eq("branch_id", d.branch).maybeSingle();
  if (ePausa) return { enviado: false, motivo: "No se pudo leer la pausa de la sucursal." };
  if (pausa) return { enviado: false, motivo: `Sucursal en pausa: ${pausa.motivo}` };
  let customerId: number | null = null;
  if (/^\d+$/.test(d.clienteErp)) {
    const { data: cli, error: eCli } = await admin.from("customers").select("id").eq("erp_id", d.clienteErp).maybeSingle();
    if (eCli) return { enviado: false, motivo: "No se pudo leer el cliente." };
    customerId = cli?.id ?? null;
  }
  const ahora = new Date(Date.now() - 6 * 3600_000).toISOString();   // El Salvador, sin horario de verano
  const { data: noSe, error: eNo } = await admin.rpc("cof_no_se_envia_mh", {
    p_tipo: d.tipo, p_fecha: ahora.slice(0, 10), p_hora: ahora.slice(11, 19), p_customer_id: customerId,
  });
  if (eNo) return { enviado: false, motivo: "No se pudo leer la regla de las 6:00 p. m." };
  if (noSe === true) return { enviado: false, motivo: "Desde las 6:00 p. m. el consumidor final no se manda." };
  try {
    const cookie = await entrarAlSistema();
    const r = await enviarDteAlMH(cookie, d.externo, d.tipo, { anula: false });
    return { enviado: true, sello: r.sello, codigo_generacion: r.codigoGeneracion, fh: r.fh };
  } catch (e) {
    return { enviado: false, error: (e as Error).message, observaciones: (e as { observaciones?: string[] }).observaciones ?? [] };
  }
}

// ── Las preventas hechas EN la caja (usuario, 2026-11-18: «que también salgan
// en la cola») ─────────────────────────────────────────────────────────────
// Sólo LEE la lista de preventas de la caja (`get_referencias`); no cambia
// nada. Devuelve las que el portal no conoce: las mandadas desde el portal ya
// están en la cola con todos sus datos. Dos formas de llamar:
//   · el equipo de kiosco de caja, con su id y su ficha (`kiosco_sucursal`):
//     la sucursal es la del EQUIPO, nunca la que diga el navegador;
//   · una sesión con permiso de caja (la vista previa del portal), en su sala
//     salvo alcance de toda la red.
async function colaDeLaCaja(req: Request, body: Record<string, unknown>, responder: (b: unknown, s?: number) => Response) {
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  let branch: number | null = null;
  if (body.device_id && body.device_token) {
    const { data, error } = await admin.rpc("kiosco_sucursal", { p_device_id: String(body.device_id), p_device_token: String(body.device_token) });
    if (error) return responder({ ok: false, error: "No se pudo validar el equipo." }, 503);
    if (data == null) return responder({ ok: false, error: "Equipo no válido." }, 401);
    const { data: eq, error: eEq } = await admin.from("kiosk_devices").select("tipo").eq("id", String(body.device_id)).maybeSingle();
    if (eEq) return responder({ ok: false, error: "No se pudo validar el equipo." }, 503);
    if (eq?.tipo !== "caja") return responder({ ok: false, error: "Este equipo no es de caja." }, 403);
    branch = Number(data);
  } else {
    const quien = await requireActiveEmployeeUser(req, admin);
    if (!quien) return responder({ ok: false, error: "Sesión inválida o empleado inactivo." }, 401);
    const permiso = await permisoDeModulo(admin, quien.id, "caja_vales", "can_view");
    if (permiso.roto) return responder({ ok: false, error: permiso.roto }, 503);
    if (!permiso.puede) return responder({ ok: false, error: "No tienes permiso para ver la caja." }, 403);
    branch = Number(body.sala);
    if (!Number.isInteger(branch) || branch <= 0) return responder({ ok: false, error: "No se dijo qué sucursal." }, 400);
    if (!permiso.alcanceTodo && Number(permiso.emp?.branch_id) !== branch) {
      return responder({ ok: false, error: "No puedes ver la caja de esa sucursal." }, 403);
    }
  }

  const { data: mapa, error: eMapa } = await admin.from("erp_sucursal_map")
    .select("erp_sucursal_id").eq("branch_id", branch).eq("es_bodega", false).maybeSingle();
  if (eMapa || !mapa) return responder({ ok: false, error: "No se sabe qué sala de la caja es esta sucursal." }, 503);

  try {
    const { username, password } = getCortesCreds();
    const http = await sesionDeCaja(username, password, Number(mapa.erp_sucursal_id));
    const lista = await listaDeLaCaja(http);
    const ids = lista.map((p) => p.id);
    let conocidas = new Set<string>();
    if (ids.length) {
      const { data: pv, error: ePv } = await admin.from("preventas").select("externo_id")
        .eq("branch_id", branch).eq("sistema", "caja").in("externo_id", ids);
      if (ePv) return responder({ ok: false, error: "No se pudo leer las preventas." }, 503);
      conocidas = new Set((pv ?? []).map((r) => String(r.externo_id)));
    }
    return responder({ ok: true, cola: lista.filter((p) => !conocidas.has(String(p.id))) });
  } catch (e) {
    return responder({ ok: false, error: (e as Error).message }, 502);
  }
}
