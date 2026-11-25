// solventar-venta — reponer con una venta de HOY una venta de un mes ya
// declarado que el cliente pide con documento (2026-11-25).
//
// POST { accion: "revisar" | "solventar", invoice_id } con la sesión de quien
// la hace (verify_jwt ON).
//
// ── Por qué existe ──────────────────────────────────────────────────────────
// El consumidor final de la noche no se manda al MH (`cof_no_se_envia_mh`). Si
// el cliente pide su documento, `dte-para-cliente` lo manda en ese momento…
// salvo que la venta sea de un mes anterior: ese mes ya se declaró sin ella
// (`_shared/mesCerrado.ts`). Pasó con 0000091241_COF de Salud 1 y hubo que
// invalidarla. Regla del usuario para esos casos:
//   1. cargar al inventario los productos de esa venta;
//   2. hacer la venta nueva (mismo cliente, mismos productos, MISMO total);
//   3. cobrarla con el mismo método de pago (tarjeta y transferencia sin
//      boleta: se anota «SOLVENTACION» para que el cuadre la reconozca);
//   4. si fue en efectivo, un vale saca ese efectivo, que no entró hoy;
//   5. con la venta nueva, el documento (se manda al MH aunque sean más de las
//      6:00 p. m.: el cliente lo está pidiendo).
// La venta vieja no se toca: nunca fue al MH y ya está en su mes.
//
// ── Cómo ────────────────────────────────────────────────────────────────────
// Cada paso usa la pieza que ya lo hace, con la MISMA sesión de quien solventa,
// así que cada una vuelve a mirar sus permisos:
//   1 → `aplicar-movimiento-inventario` (una solicitud de carga que se aplica
//       en el acto: quien solventa tiene que poder aprobar inventario);
//   2 → `preventa-caja` acción `directa` (la venta queda en la caja);
//   3 → el cobro de la caja (`prepararCobroEnLaCaja` / `guardarEnLaCaja` /
//       `finalizarEnLaCaja`, los mismos del kiosco);
//   4 → `operar-caja` acción `salida`, tipo SOLVENTA_VENTA, con una clave de
//       envío única por solventación (no se puede sacar dos veces);
//   5 → `enviarDteAlMH`, y el PDF lo entrega `dte-para-cliente` sobre la
//       factura nueva cuando llega al portal.
// Cada paso queda anotado en `solventaciones` ANTES de seguir. Una llamada
// cortada se retoma desde lo que falta. Si la caja no contesta al guardar o al
// finalizar, queda `incierta` y NO se reintenta sola: se revisa en la caja.
//
// Ni una línea de lo que ve el usuario habla del sistema de origen.
import { createClient } from "npm:@supabase/supabase-js@2";
import { type ClienteAdmin, getCorsHeaders, permisoDeModulo, requireActiveEmployeeUser } from "../_shared/security.ts";
import { getCortesCreds } from "../_shared/creditos.ts";
import { finalizarEnLaCaja, guardarEnLaCaja, prepararCobroEnLaCaja, sesionDeCaja } from "../_shared/preventaCaja.ts";
import { armarFinalizado } from "../../../src/utils/cobroDeCaja.js";
import { enviarDteAlMH, login as entrarAlSistema } from "../_shared/erp-dte.ts";
import { esDeMesCerrado } from "../_shared/mesCerrado.ts";

const selloValido = (s: unknown) => typeof s === "string" && s.length === 40;
const r2 = (n: unknown) => Math.round(Number(n ?? 0) * 100) / 100;
const PAGOS = new Set(["contado", "tarjeta", "transferencia", "cheque"]);
// En `sales_invoices` el contado se guarda como «efectivo»; la caja y la
// preventa lo llaman «contado».
const pagoDe = (tipoPago: unknown) => {
  const p = String(tipoPago ?? "").trim().toLowerCase();
  return p === "efectivo" ? "contado" : p;
};
const PRESUPUESTO_MS = 95_000;   // la función vive 150 s: se para a tiempo de contestar

class ErrorUsuario extends Error {
  constructor(msg: string, readonly status = 409) { super(msg); }
}

// deno-lint-ignore no-explicit-any
type Fila = Record<string, any>;

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
  const URL_BASE = Deno.env.get("SUPABASE_URL") ?? "";
  const admin = createClient(URL_BASE, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
  const arranque = Date.now();
  let tomadaId: number | null = null;

  try {
    const body = await req.json().catch(() => ({}));
    const accion = body?.accion === "solventar" ? "solventar" : body?.accion === "revisar" ? "revisar" : null;
    const invoiceId = Number(body?.invoice_id);
    if (!accion) throw new ErrorUsuario("Acción no válida.", 400);
    if (!Number.isFinite(invoiceId) || invoiceId <= 0) throw new ErrorUsuario("Falta la venta.", 400);

    // ── Quién ──────────────────────────────────────────────────────────
    const emp = await requireActiveEmployeeUser(req, admin);
    if (!emp) return json({ ok: false, error: "Sesión inválida o empleado inactivo." }, 401);
    // Solventar es decidir sobre una factura: los mismos que aprueban las
    // solicitudes de facturación. Cada paso mira además su propio permiso.
    const { data: puede, error: ePerm } = await admin.rpc("puede_aprobar_modulo", {
      p_employee_id: emp.id, p_module_key: "requests_facturacion",
    });
    if (ePerm) throw ePerm;
    if (!puede) throw new ErrorUsuario("Solventar una venta lo hace quien aprueba las solicitudes de facturación. Avisa a un supervisor o administrador.", 403);
    const autorizacion = req.headers.get("Authorization") ?? "";

    // ── Qué venta ──────────────────────────────────────────────────────
    const { data: f, error: eF } = await admin.from("sales_invoices")
      .select("id, branch_id, customer_id, fecha, tipo_documento, correlativo, total, estado, recibido_mh, tipo_pago, cliente")
      .eq("id", invoiceId).maybeSingle();
    if (eF) throw eF;
    if (!f) throw new ErrorUsuario("Esa venta ya no está en el portal.", 404);
    // La sala sale de la factura, no del pedido: sin alcance de toda la red,
    // sólo la propia.
    const alcance = await permisoDeModulo(admin, emp.id, "ventas", "can_view");
    if (alcance.roto) return json({ ok: false, error: alcance.roto }, 503);
    if (!alcance.alcanceTodo && Number(alcance.emp?.branch_id) !== Number(f.branch_id))
      throw new ErrorUsuario("Esa venta es de otra sucursal.", 403);

    // La solventación que ya exista manda sobre todo lo demás: una vez
    // empezada, se termina aunque las condiciones de arriba cambien.
    const { data: previa, error: ePrev } = await admin.from("solventaciones")
      .select("*").eq("invoice_id", invoiceId).neq("estado", "cancelada").maybeSingle();
    if (ePrev) throw ePrev;

    if (!previa) {
      const { data: valida, error: eV } = await admin.rpc("venta_valida", { p_estado: f.estado });
      if (eV) throw eV;
      if (!valida) throw new ErrorUsuario("Esta venta está anulada. No hay nada que solventar.");
      if (selloValido(f.recibido_mh)) throw new ErrorUsuario("Esta venta ya tiene sello del MH. Entrega su documento normal.");
      if (!esDeMesCerrado(f.fecha)) throw new ErrorUsuario("Esta venta es de este mes. Entrega su documento normal.");
      if (f.tipo_documento !== "COF") throw new ErrorUsuario("Sólo se solventa un consumidor final.");
      const pago = pagoDe(f.tipo_pago);
      if (pago === "credito") throw new ErrorUsuario("Una venta al crédito no se solventa aquí: la venta nueva crearía otra deuda. Avisa a un administrador.");
      if (!PAGOS.has(pago)) throw new ErrorUsuario(`No se reconoce la forma de pago de esta venta (${f.tipo_pago ?? "vacía"}).`);
    }

    const plan = previa?.plan ?? await armarPlan(admin, f);

    if (accion === "revisar") {
      return json({
        ok: true, plan, estado: previa?.estado ?? null, error_previo: previa?.error ?? null,
        nueva_invoice_id: previa?.nueva_invoice_id ?? null,
      });
    }

    // ── La fila y el arriendo ───────────────────────────────────────────
    let sol: Fila | null = previa;
    if (!sol) {
      const { data: nueva, error: eIns } = await admin.from("solventaciones").insert({
        invoice_id: invoiceId, branch_id: f.branch_id, employee_id: emp.id,
        pago: plan.pago, total: plan.total, plan,
      }).select("*").single();
      if (eIns?.code === "23505") {
        const { data: ya, error: eYa } = await admin.from("solventaciones")
          .select("*").eq("invoice_id", invoiceId).neq("estado", "cancelada").maybeSingle();
        if (eYa) throw eYa;
        sol = ya;
      } else if (eIns) throw eIns;
      else sol = nueva;
    }
    if (!sol) throw new Error("No se pudo empezar la solventación.");
    if (sol.estado === "lista") return json({ ok: true, ...resumen(sol) });
    if (sol.estado === "incierta")
      throw new ErrorUsuario(`No se sabe si la caja guardó la venta nueva (${sol.error ?? "sin respuesta"}). Revísala en la caja y avisa a Soporte antes de volver a intentar.`);

    const ahoraIso = new Date().toISOString();
    const { data: tomada, error: eTom } = await admin.from("solventaciones")
      .update({ tomada_hasta: new Date(Date.now() + 160_000).toISOString() })
      .eq("id", sol.id).or(`tomada_hasta.is.null,tomada_hasta.lt.${ahoraIso}`).select("id");
    if (eTom) throw eTom;
    if (!tomada?.length) throw new ErrorUsuario("Esta venta se está solventando en este momento. Espera un minuto.");
    tomadaId = Number(sol.id);

    const anotar = async (cambios: Fila) => {
      const { data, error } = await admin.from("solventaciones")
        .update({ ...cambios, updated_at: new Date().toISOString() }).eq("id", sol!.id).select("*").single();
      if (error) throw new Error(`No se pudo anotar el avance: ${error.message}`);
      sol = data;
    };
    const llamar = async (fn: string, cuerpo: unknown) => {
      const r = await fetch(`${URL_BASE}/functions/v1/${fn}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json", Authorization: autorizacion,
          apikey: Deno.env.get("SUPABASE_ANON_KEY") ?? "",
        },
        body: JSON.stringify(cuerpo),
        signal: AbortSignal.timeout(Math.max(10_000, PRESUPUESTO_MS + 40_000 - (Date.now() - arranque))),
      });
      const res = await r.json().catch(() => ({}));
      return { status: r.status, ok: r.ok && res?.ok !== false, res };
    };
    const queda = () => PRESUPUESTO_MS - (Date.now() - arranque);

    const erpSucursal = Number(plan.erp_sucursal_id);

    // ── 1 · Cargar los productos ──────────────────────────────────────────
    if (sol.estado === "nueva") {
      // La venta nueva se cobra en la caja de hoy y el vale sale de ella: sin
      // caja abierta no se empieza (a medias, el corte quedaría descuadrado).
      const { data: abierta, error: eCaja } = await admin.rpc("sala_con_caja_abierta", { p_branch_id: f.branch_id });
      if (eCaja) throw eCaja;
      if (!abierta) throw new ErrorUsuario(`${plan.sucursal} no tiene caja abierta. Se solventa con la caja abierta.`);
      let reqId: string | null = sol.carga_request_id;
      if (!reqId) {
        const { data: ar, error: eAr } = await admin.from("approval_requests").insert({
          employee_id: emp.id, approver_id: emp.id, type: "INVENTORY_LOAD_REQUEST", status: "PENDING",
          note: `Solventa la venta ${plan.correlativo}`,
          metadata: {
            items: plan.lineas.map((l: Fila) => ({
              erp_product_id: l.producto_id, presentacion_tipo: l.tipo, factor: l.factor, cantidad: l.cantidad,
              numero_lote: l.lote ?? null, vence: l.vence ?? null, descripcion: l.nombre,
            })),
            reason: `Solventa la venta ${plan.correlativo} del ${plan.fecha}: vuelve a entrar para facturarla hoy`,
            branch_id: f.branch_id, branch_name: plan.sucursal, movimiento: "CARGA",
            erp_sucursal_id: erpSucursal, erp_ubicacion_id: Number(plan.erp_ubicacion_id),
            total_unidades: plan.lineas.reduce((s: number, l: Fila) => s + Number(l.cantidad) * Number(l.factor), 0),
            solventacion_id: sol.id,
          },
        }).select("id").single();
        if (eAr) throw new Error(`No se pudo pedir la carga: ${eAr.message}`);
        reqId = String(ar.id);
        await anotar({ carga_request_id: reqId, error: null });
      }
      const { data: estadoCarga, error: eEc } = await admin.from("approval_requests")
        .select("status").eq("id", reqId).maybeSingle();
      if (eEc) throw eEc;
      if (estadoCarga?.status === "PENDING") {
        const r = await llamar("aplicar-movimiento-inventario", { request_id: reqId });
        if (!r.ok) {
          const m = `La carga de los productos no entró: ${r.res?.error ?? `respuesta ${r.status}`}. Puedes revisarla en Solicitudes y volver a intentar.`;
          await anotar({ error: m });
          throw new ErrorUsuario(m);
        }
      } else if (estadoCarga?.status !== "APPROVED") {
        const m = `La carga de los productos quedó ${estadoCarga?.status ?? "sin estado"}. Avisa a Soporte.`;
        await anotar({ error: m });
        throw new ErrorUsuario(m);
      }
      await anotar({ estado: "cargada", error: null });
    }

    // ── 2 · La venta nueva, en la caja ──────────────────────────────────
    if (sol.estado === "enviando_venta") {
      // Se mandó y no se supo la respuesta: otra vuelta podría duplicarla.
      throw new ErrorUsuario("No se sabe si la venta nueva llegó a la caja. Revisa la cola de la caja y avisa a Soporte antes de volver a intentar.");
    }
    if (sol.estado === "cargada" && queda() > 30_000) {
      await anotar({ estado: "enviando_venta" });
      const r = await llamar("preventa-caja", {
        accion: "directa", branch_id: f.branch_id, customer_id: f.customer_id ?? null,
        documento: "consumidor_final", pago: plan.pago, total_esperado: plan.total,
        nota: `Solventa ${plan.correlativo}`.slice(0, 60),
        lineas: plan.lineas.map((l: Fila) => ({
          producto_id: l.producto_id, factor: l.factor, cantidad: l.cantidad,
          ...(l.lista ? { lista: l.lista } : {}),
          ...(l.lote ? { lote: { nombre: l.lote, vence: l.vence ?? null } } : {}),
        })),
        motivo_precio: plan.lineas.some((l: Fila) => l.lista) ? `Solventa ${plan.correlativo}: mismo precio de la venta original` : null,
      });
      if (!r.ok || !r.res?.externo_id) {
        // La función contestó que no (o no contestó). Si contestó con un error
        // legible, no escribió en la caja: se puede volver a intentar.
        const legible = r.status >= 400 && r.status < 500 && r.res?.error;
        const m = `La venta nueva no llegó a la caja: ${r.res?.error ?? `respuesta ${r.status}`}`;
        await anotar({ estado: legible ? "cargada" : "enviando_venta", error: m });
        throw new ErrorUsuario(m);
      }
      await anotar({ estado: "en_caja", externo_id: String(r.res.externo_id), referencia: String(r.res.referencia ?? ""), error: null });
    }

    // ── 3 · Cobrarla con el mismo método ─────────────────────────────────
    let http: Awaited<ReturnType<typeof sesionDeCaja>> | null = null;
    const caja = async () => {
      if (!http) {
        const { username, password } = getCortesCreds();
        http = await sesionDeCaja(username, password, erpSucursal);
      }
      return http;
    };
    if (sol.estado === "en_caja" && queda() > 25_000) {
      const detalle = detalleDelPago(plan.pago, plan.correlativo);
      const cobro = await prepararCobroEnLaCaja(await caja(), String(sol.externo_id), {
        total: Number(plan.total), efectivo: Number(plan.total), pago: plan.pago, detalle,
      });
      if (cobro.motivo) {
        await anotar({ error: cobro.motivo });
        throw new ErrorUsuario(`La venta nueva está en la caja pero no se pudo cobrar: ${cobro.motivo}`);
      }
      await anotar({ estado: "cobrando", total_caja: cobro.totales.total, respuestas: { cabecera: cobro.cabecera, caja: cobro.caja } });
      const g = await guardarEnLaCaja(await caja(), cobro.guardado);
      if (!g.ok && g.rechazo) {
        await anotar({ estado: "en_caja", error: g.rechazo });
        throw new ErrorUsuario(`La caja no guardó la venta nueva: ${g.rechazo}`);
      }
      if (!g.ok) {
        await anotar({ estado: "incierta", error: g.incierta });
        throw new ErrorUsuario("No se sabe si la caja guardó la venta nueva. Revísala en la caja y avisa a Soporte antes de volver a intentar.", 502);
      }
      await anotar({
        estado: "guardada", numero: String(g.resp.numdoc ?? g.resp.ultimo ?? "") || null,
        respuestas: { ...sol.respuestas, guardado: g.resp }, error: null,
      });
    }
    if (sol.estado === "guardada" && queda() > 20_000) {
      const { cabecera, caja: datosCaja, guardado } = sol.respuestas ?? {};
      if (!cabecera || !datosCaja || !guardado) throw new Error("Al cobro le faltan datos para finalizar.");
      const fin = armarFinalizado({
        cabecera, guardado: { ...guardado, id_factura: guardado.id_factura ?? sol.externo_id },
        caja: datosCaja, efectivo: Number(sol.total_caja ?? plan.total),
      });
      const fz = await finalizarEnLaCaja(await caja(), fin);
      if (!fz.ok && fz.rechazo) {
        await anotar({ error: fz.rechazo });
        throw new ErrorUsuario(`La caja guardó la venta nueva pero no la finalizó: ${fz.rechazo}. Intenta otra vez.`);
      }
      if (!fz.ok) {
        await anotar({ estado: "incierta", error: fz.incierta });
        throw new ErrorUsuario("No se sabe si la caja finalizó la venta nueva. Revísala en la caja y avisa a Soporte.", 502);
      }
      await anotar({ estado: "finalizada", respuestas: { ...sol.respuestas, finalizado: fz.resp }, error: null });
    }

    // ── 4 · El vale, si fue en efectivo ──────────────────────────────────
    if (sol.estado === "finalizada" && queda() > 15_000) {
      if (sol.pago === "contado" && !sol.vale_mov_id) {
        const monto = r2(sol.total_caja ?? plan.total);
        const r = await llamar("operar-caja", {
          accion: "salida", sala: f.branch_id, tipo: "SOLVENTA_VENTA", monto,
          concepto: `Solventa ${plan.correlativo}`.slice(0, 50),
          detalle: `Solventa la venta ${plan.correlativo} del ${plan.fecha}: el efectivo de la venta nueva no entró hoy`,
          clave_envio: `solventa-${sol.id}`, recibe: String(f.cliente ?? "").slice(0, 60),
        });
        if (!r.ok || !r.res?.movimiento_del_portal) {
          const m = `La venta nueva quedó cobrada, pero el vale no se hizo: ${r.res?.error ?? `respuesta ${r.status}`}. Vuelve a intentar.`;
          await anotar({ error: m });
          throw new ErrorUsuario(m);
        }
        await anotar({ vale_mov_id: Number(r.res.movimiento_del_portal) });
      }
      await anotar({ estado: "vale", error: null });
    }

    // ── 5 · Al MH ──────────────────────────────────────────────────────
    if (sol.estado === "vale" && queda() > 15_000) {
      try {
        const cookie = await entrarAlSistema();
        const r = await enviarDteAlMH(cookie, String(sol.externo_id), "COF", { anula: false });
        await anotar({ estado: "con_sello", sello: r.sello, codigo_generacion: r.codigoGeneracion ?? null, error: null });
      } catch (e) {
        const m = `La venta nueva está cobrada, pero el MH todavía no la recibió: ${(e as Error).message}. Vuelve a intentar en unos minutos.`;
        await anotar({ error: m });
        throw new ErrorUsuario(m, 502);
      }
    }

    // ── La factura nueva en el portal ────────────────────────────────────
    if (sol.estado === "con_sello") {
      const { data: nueva, error: eN } = await admin.from("sales_invoices").select("id")
        .eq("branch_id", f.branch_id).eq("erp_invoice_id", String(sol.externo_id)).maybeSingle();
      if (eN) throw eN;
      if (nueva) await anotar({ estado: "lista", nueva_invoice_id: nueva.id, error: null });
    }

    return json({ ok: true, ...resumen(sol) });
  } catch (e) {
    if (e instanceof ErrorUsuario) return json({ ok: false, error: e.message }, e.status);
    console.error("solventar-venta:", e instanceof Error ? e.message : String(e));
    return json({ ok: false, error: "No se pudo solventar la venta. Intenta de nuevo." }, 500);
  } finally {
    if (tomadaId) {
      const { error } = await admin.from("solventaciones").update({ tomada_hasta: null }).eq("id", tomadaId);
      if (error) console.error("solventar-venta: soltar:", error.message);
    }
  }
});

/** Lo que va a pasar, armado una vez y guardado con la solventación. */
async function armarPlan(admin: ClienteAdmin, f: Fila) {
  const { data: items, error: eI } = await admin.from("sales_invoice_items")
    .select("erp_product_id, descripcion, cantidad, factor_unidades, precio_unitario, total_linea, lote, fecha_vencimiento")
    .eq("invoice_id", f.id).order("linea_num");
  if (eI) throw eI;
  if (!items?.length) throw new ErrorUsuario("Esta venta no tiene productos en el portal.");
  const { data: mapa, error: eM } = await admin.from("erp_sucursal_map")
    .select("erp_sucursal_id, nombre, inv_ubicaciones").eq("branch_id", f.branch_id).eq("es_bodega", false).maybeSingle();
  if (eM) throw eM;
  const ubicacion = Array.isArray(mapa?.inv_ubicaciones)
    ? mapa.inv_ubicaciones.find((u: Fila) => !u.isVencidos)?.id : null;
  if (!mapa?.erp_sucursal_id || !ubicacion) throw new ErrorUsuario("No se pudo ubicar la sucursal de la venta.");

  // Un producto va una vez por presentación (lo exige la preventa): se suman.
  const porClave = new Map<string, Fila>();
  for (const it of items) {
    const clave = `${it.erp_product_id}|${Number(it.factor_unidades) || 1}`;
    const ya = porClave.get(clave);
    if (ya) {
      if (Math.abs(Number(ya.precio_original) - Number(it.precio_unitario)) > 0.004)
        throw new ErrorUsuario(`«${it.descripcion}» va dos veces con precios distintos. Avisa a Soporte.`);
      ya.cantidad += Number(it.cantidad);
      continue;
    }
    const lote = String(it.lote ?? "").trim();
    porClave.set(clave, {
      producto_id: Number(it.erp_product_id), factor: Number(it.factor_unidades) || 1, cantidad: Number(it.cantidad),
      nombre: it.descripcion, precio_original: r2(it.precio_unitario),
      lote: lote && lote.toUpperCase() !== "GENERICO" ? lote : null,
      vence: it.fecha_vencimiento ? String(it.fecha_vencimiento).slice(0, 10) : null,
    });
  }
  const lineas = [...porClave.values()];

  // El precio de hoy para ese cliente; si cambió, la lista de precio que da el
  // de la venta original. Si ninguna lo da, no se empieza: el documento diría
  // otro monto que el que pagó el cliente.
  const { data: cot, error: eC } = await admin.rpc("preventa_cotizar", {
    p_branch: f.branch_id, p_customer: f.customer_id ?? null,
    p_lineas: lineas.map((l) => ({ producto_id: l.producto_id, factor: l.factor, cantidad: l.cantidad })),
  });
  if (eC) throw eC;
  const cotizadas: Fila[] = Array.isArray(cot?.lineas) ? cot.lineas : [];
  for (const l of lineas) {
    const c = cotizadas.find((x) => Number(x.producto_id) === l.producto_id && Number(x.factor) === l.factor);
    if (!c) throw new ErrorUsuario(`«${l.nombre}» no se pudo cotizar hoy.`);
    if (c.error && !/existencia/i.test(String(c.error))) throw new ErrorUsuario(`«${l.nombre}»: ${c.error}`);
    l.tipo = c.tipo;
    if (Math.abs(Number(c.precio) - l.precio_original) > 0.004) {
      const lista = Object.entries(c.precios ?? {}).find(([, v]) => Math.abs(Number(v) - l.precio_original) <= 0.004)?.[0];
      if (!lista) {
        throw new ErrorUsuario(`«${l.nombre}» se vendió a $${l.precio_original.toFixed(2)} y hoy no hay un precio igual. No se puede reponer por el mismo total. Avisa a un administrador.`);
      }
      l.lista = lista;
    }
    if (!l.tipo) throw new ErrorUsuario(`«${l.nombre}» no tiene presentación de ${l.factor}.`);
  }
  const total = r2(lineas.reduce((s, l) => s + l.precio_original * l.cantidad, 0));
  if (Math.abs(total - r2(f.total)) > 0.005)
    throw new ErrorUsuario(`Los productos suman $${total.toFixed(2)} y la venta dice $${r2(f.total).toFixed(2)}. Avisa a Soporte.`);

  return {
    correlativo: String(f.correlativo ?? "").split("_")[0], fecha: f.fecha, cliente: f.cliente ?? null,
    sucursal: mapa.nombre, erp_sucursal_id: mapa.erp_sucursal_id, erp_ubicacion_id: ubicacion,
    pago: pagoDe(f.tipo_pago), total, lineas,
  };
}

/** Lo que va en el cobro según el método: sin boleta, marcado como solventación. */
function detalleDelPago(pago: string, correlativo: string): Record<string, string> {
  if (pago === "tarjeta") return { terminal: "SOLVENTACION", boleta: "0" };
  if (pago === "transferencia") return { banco: "SOLVENTACION", referencia: correlativo };
  if (pago === "cheque") return { banco: "SOLVENTACION", numero: correlativo };
  return {};
}

function resumen(sol: Fila) {
  return {
    estado: sol.estado, listo: sol.estado === "lista", nueva_invoice_id: sol.nueva_invoice_id ?? null,
    numero: sol.numero ?? null, total: sol.total_caja ?? sol.total, pago: sol.pago,
    vale: Boolean(sol.vale_mov_id), con_sello: selloValido(sol.sello),
    // Falta que la factura nueva llegue al portal (un minuto): se vuelve a llamar.
    sigue: sol.estado !== "lista",
  };
}
