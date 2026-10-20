// Descartar UNA línea de inventario en el sistema de la caja, sin solicitud de
// por medio (2026-10-19). Lo usa `entregar-premio`: un premio del raspable que
// es un producto sale del inventario de la sala como DESCARTE, con el concepto
// «PREMIO PUNTOS SALUD - código - cliente».
//
// ── De dónde sale cada paso ───────────────────────────────────────────────
// Es el mismo camino de `aplicar-movimiento-inventario` (descargos aprobados),
// reducido a una línea: abrir la sucursal en una sesión PROPIA, consultar el
// producto, resolver la presentación por su ETIQUETA, pedir su detalle
// (`getpresentacion`) para que costo y factor sean los de esa presentación,
// comprobar existencia, elegir lote si el producto lo exige, y enviar. Las
// trampas que cada paso esquiva están escritas allá con su medición; acá sólo
// se nombran. ⚠️ Deuda declarada: `aplicar-movimiento-inventario` tiene su
// propia copia de este camino. Al tocar uno, mirar el otro — y el día que se
// toque aquella función, que pase a usar ésta.
import { BASE, login, pedir, leerRespuesta } from "./erp-dte.ts";

const DESCARGO = `${BASE}/descargo_inventario.php`;
const SESION   = `${BASE}/cambio_sesion.php`;
const CONCEPTO_MAX = 200;

const norm = (s: string) => String(s ?? "").replace(/\s+/g, " ").trim().toUpperCase();

/** El concepto, en ASCII puro: el sistema relee los bytes como Latin-1. */
export function soloAscii(s: string): string {
  return String(s ?? "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[·•]/g, "-").replace(/[—–]/g, "-")
    .replace(/[«»“”„]/g, '"').replace(/[‘’]/g, "'").replace(/…/g, "...")
    .replace(/[^\x20-\x7E]/g, "").replace(/\s+/g, " ").trim();
}

/** Arma el concepto con las piezas en orden y lo recorta al tope del sistema. */
export function conceptoDe(piezas: string[]): string {
  const c = piezas.map(soloAscii).filter(Boolean).join(" - ");
  return c.length > CONCEPTO_MAX ? c.slice(0, CONCEPTO_MAX - 3) + "..." : c;
}

/** La fecha de El Salvador (UTC-6 todo el año), en yyyy-mm-dd. */
function hoySV(): string {
  return new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export interface LineaDescarte {
  erp_product_id: number;
  presentacion_tipo: string;   // «UNIDAD», «CAJA»…
  factor: number;
  cantidad: number;
  descripcion?: string;
}

export type ResultadoDescarte =
  | { ok: true; aplicado: Record<string, unknown> }
  | { ok: false; codigo: string; error: string };

export async function descartarUnaLinea(opc: {
  erpSucursal: number;
  erpUbicacion: number;
  linea: LineaDescarte;
  concepto: string;
  iden?: string;                 // el tipo de descargo del sistema
}): Promise<ResultadoDescarte> {
  const { erpSucursal, erpUbicacion, linea: l, concepto } = opc;
  const iden = opc.iden ?? "DESCARTE";
  const nombre = l.descripcion ?? `el producto ${l.erp_product_id}`;

  // Una sesión por llamada: la sucursal es estado GLOBAL de la sesión PHP.
  const cookie = await login();
  const rSesion = await pedir(cookie, SESION, new URLSearchParams({
    process: "set_sucursal", id_sucursal: String(erpSucursal),
  }), { extra: { Referer: `${BASE}/dashboard.php` } });
  let sesionOk = false;
  try { sesionOk = Boolean(JSON.parse(rSesion)?.success); } catch { sesionOk = false; }
  if (!sesionOk) return { ok: false, codigo: "SESION", error: "No se pudo abrir la sucursal en el sistema de la caja." };

  // Consultar el producto en ESA ubicación (el descargo publica lotes y stock).
  let j: Record<string, unknown>;
  try {
    j = JSON.parse(await pedir(cookie, DESCARGO, new URLSearchParams({
      process: "consultar_stock", tipo: "D", id_producto: String(l.erp_product_id), ubicacion: String(erpUbicacion),
    }), { extra: { Referer: DESCARGO } }));
  } catch {
    return { ok: false, codigo: "ILEGIBLE", error: `No se pudo leer ${nombre} en el sistema de la caja.` };
  }
  const tipo = String(j.typeinfo ?? "").toLowerCase();
  if (!(tipo ? tipo === "success" : Boolean(j.id_p))) {
    const deshabilitado = /no pertenece a ning/i.test(String(j.msg ?? ""));
    return {
      ok: false, codigo: deshabilitado ? "PRODUCTO_DESHABILITADO" : "PRODUCTO_ILEGIBLE",
      error: deshabilitado ? `${nombre} está deshabilitado: no se le puede descargar existencia.`
                           : `No se pudo leer ${nombre}.`,
    };
  }
  const presentaciones = [...String(j.select ?? "").matchAll(/<option value='(\d+)'>([^<]*)</g)]
    .map((m) => ({ id: m[1], etiqueta: norm(m[2]) }));
  const stock = j.stock === undefined ? null : Number(j.stock);
  const lotesHtml = String(j.lotes_select ?? "");
  const regulado = /data-regulado='1'/.test(lotesHtml);
  const lotes = [...lotesHtml.matchAll(/<option([^>]*)>([^<]*)</g)].map((m) => ({
    id: m[1].match(/value='(\d+)'/)?.[1] ?? "",
    numero: m[2].trim().split(" - ")[0].trim(),
    vence: m[1].match(/data-vencimiento='([^']*)'/)?.[1] ?? "",
    stock: Number(m[1].match(/data-stock='([^']*)'/)?.[1] ?? 0),
  })).filter((x) => x.id);

  // La presentación por su SIGNIFICADO: los ids del sistema no son los del portal.
  const buscada = norm(`${l.presentacion_tipo} (${l.factor})`);
  const elegida = presentaciones.find((p) => p.etiqueta === buscada);
  if (!elegida) {
    return { ok: false, codigo: "PRESENTACION_NO_EXISTE",
             error: `${nombre} ya no tiene la presentación ${l.presentacion_tipo} (${l.factor}).` };
  }

  // Costo, precio y factor de ESA presentación (consultar_stock da los de la por defecto).
  let costo = "", precio = "", unidad = "";
  try {
    const jp = JSON.parse(await pedir(cookie, DESCARGO, new URLSearchParams({
      process: "getpresentacion", id_presentacion: elegida.id,
    }), { extra: { Referer: DESCARGO } }));
    if (!jp?.unidad) throw new Error("sin unidad");
    costo = String(jp.costo); precio = String(jp.precio); unidad = String(jp.unidad);
  } catch {
    return { ok: false, codigo: "PRESENTACION_ILEGIBLE", error: `No se pudo leer la presentación de ${nombre}.` };
  }
  if (Number(unidad) !== Number(l.factor)) {
    return { ok: false, codigo: "FACTOR_CAMBIO",
             error: `${nombre}: la presentación ${l.presentacion_tipo} ya no trae ${l.factor}.` };
  }

  // Existencia, en unidades base.
  const enUnidades = Number(l.cantidad) * Number(unidad);
  if (stock !== null && enUnidades > stock) {
    return { ok: false, codigo: "SIN_EXISTENCIA",
             error: `De ${nombre} quedan ${stock} unidades en esta sucursal y el premio lleva ${enUnidades}.` };
  }

  // Lote: el que vence primero y alcanza (un regalo no elige lote; la sala
  // entrega el que está más cerca de vencer, que es lo que haría a mano).
  let idLote = "0";
  let loteUsado: { numero: string; vence: string } | null = null;
  if (regulado) {
    const lote = lotes.filter((x) => x.stock >= enUnidades).sort((a, b) => a.vence.localeCompare(b.vence))[0];
    if (!lote) {
      return { ok: false, codigo: "SIN_LOTE",
               error: `${nombre} lleva control de lote y ningún lote de esta sucursal alcanza para el premio.` };
    }
    idLote = lote.id;
    loteUsado = { numero: lote.numero, vence: lote.vence };
  }

  const datos = [l.erp_product_id, costo, precio, l.cantidad, unidad, "", elegida.id, idLote].join("|") + "#";
  const total = Number(costo || 0) * Number(l.cantidad);
  const resp = leerRespuesta(await pedir(cookie, DESCARGO, new URLSearchParams({
    process: "insert", datos, cuantos: "1", total: total.toFixed(4), fecha: hoySV(),
    concepto, origen: String(erpUbicacion), iden,
  }), { extra: { Referer: DESCARGO } }));
  if (!resp.ok) {
    return { ok: false, codigo: "RECHAZADO", error: `El sistema de la caja no aceptó el descarte: ${resp.msg || "sin detalle"}` };
  }

  return {
    ok: true,
    aplicado: {
      at: new Date().toISOString(), movimiento: "DESCARTE", iden, concepto,
      erp_sucursal_id: erpSucursal, erp_ubicacion_id: erpUbicacion,
      erp_product_id: l.erp_product_id, presentacion: `${l.presentacion_tipo} (${l.factor})`,
      id_presentacion_erp: elegida.id, cantidad: l.cantidad, unidad, costo, precio,
      total: Number(total.toFixed(4)), stock_previo: stock, lote: loteUsado, msg: resp.msg,
    },
  };
}
