// Corregir el vencimiento de un perecedero SIN control de lote (2026-11-27).
//
// ── Por qué existe ────────────────────────────────────────────────────────
// «Corregir lote o vencimiento» sólo aceptaba productos con control de lote, y
// el usuario lo reclamó con NUT CLUB SUPER MIX: perecedero, sin lote, 96 u. en
// Bodega con vencimiento 05/2026, y la pantalla decía «no lleva control de
// lote». Un producto así no tiene número que corregir, pero sí fechas.
//
// ── Cómo guarda la fecha el sistema de la caja ────────────────────────────
// Sin lotes en la pantalla (`lotes_select` vacío, `data-regulado='0'`), pero
// el reporte de inventario lo separa por fecha: cada carga con otra fecha abre
// un renglón GENERICO aparte (204 de 522 existencias perecederas sin lote
// tenían más de una fecha el 2026-11-27).
//
// ── Lo que se midió (2026-11-27, Bodega, SUPER MIX, con permiso) ──────────
// Carga de 1 u. con 2027-11 → quedó 96 @ 2026-05 + 1 @ 2027-11. Descargo de
// 1 u. (sin lote, el sistema elige) → salió de 2026-05: 95 + 1. O sea, el
// descargo NO deja elegir la fecha: descuenta primero la más próxima. Se
// revirtió (descargo de 96 + carga de 96 @ 2026-05).
//
// ── Por eso, el orden es el inverso al de los lotes ───────────────────────
//   1. DESCARGO de N unidades (el sistema las toma de la fecha más próxima).
//   2. Se relee: si no salieron todas de la fecha que se corrige, se devuelven
//      a la fecha de donde salieron y se avisa. Nada queda cambiado.
//   3. CARGA de N unidades con la fecha correcta.
// Cargar primero fallaría si la fecha correcta es MÁS PRÓXIMA que la mala: el
// descargo saldría justo de lo recién cargado. Por eso sólo se puede corregir
// la fecha más próxima de la sucursal (`revisarVenceSinLote`), y la pantalla lo
// adelanta. Si el paso 3 se corta, faltan unidades y se dice cuántas y con qué
// fecha cargarlas.
import { BASE, pedir, leerRespuesta } from "./erp-dte.ts";
import { descartarUnaLinea, conceptoDe } from "./erp-descarte.ts";
import { resolverPresentacion, traerFila } from "./erp-traslado.ts";

const INGRESO = `${BASE}/ingreso_inventario.php`;
const REPORTE = `${BASE}/reporte_inventario_json.php`;

const dia = (s: string | null | undefined) => {
  const d = String(s ?? "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) && !d.startsWith("0000") ? d : "";
};
const mesAnio = (d: string) => (d ? `${d.slice(5, 7)}/${d.slice(0, 4)}` : "sin vencimiento");

function hoySV(): string {
  return new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** Existencia por fecha: { 'AAAA-MM-DD' | '' (sin fecha): unidades }. */
export type PorFecha = Record<string, number>;

export type ResultadoVence =
  | { ok: true; lote: string; vence: string; unidades: number; concepto: string; avisos: string[] }
  | { ok: false; codigo: string; error: string; descuadre?: string };

/** El vencimiento escrito: AAAA-MM-DD válido y futuro. */
export function validarVenceEscrito(vence: unknown): { ok: true; vence: string } | { ok: false; error: string } {
  const v = dia(String(vence ?? ""));
  if (!v || Number.isNaN(Date.parse(`${v}T12:00:00Z`))) return { ok: false, error: "Falta el vencimiento, o no es una fecha." };
  if (v <= hoySV()) return { ok: false, error: `El vencimiento ${mesAnio(v)} ya pasó.` };
  return { ok: true, vence: v };
}

/**
 * Lo que se pide, revisado antes de tocar nada. Puro, para anclarlo en
 * pruebas. Sólo se corrige la fecha más próxima: es la que el descargo toma.
 * Lo sin fecha se deja pasar (no se midió dónde lo ordena el sistema) y lo
 * cuida la relectura del paso 2.
 */
export function revisarVenceSinLote(opc: {
  filas: PorFecha; venceViejo: string | null; unidades: number; venceNuevo: string;
}): { ok: true } | { ok: false; codigo: string; error: string } {
  const viejo = dia(opc.venceViejo);
  const n = opc.unidades;
  if (!Number.isInteger(n) || n <= 0) return { ok: false, codigo: "SIN_UNIDADES", error: "Indica cuántas unidades se corrigen." };
  if (viejo === opc.venceNuevo) return { ok: false, codigo: "SIN_CAMBIO", error: "Es el mismo vencimiento: no hay nada que corregir." };
  const hay = Number(opc.filas[viejo] ?? 0);
  if (hay <= 0) return { ok: false, codigo: "FECHA_NO_EXISTE", error: `Ya no hay existencia con vencimiento ${mesAnio(viejo)}.` };
  if (n > hay) return { ok: false, codigo: "NO_ALCANZA", error: `Con vencimiento ${mesAnio(viejo)} hay ${hay} unidades y se piden ${n}.` };
  if (viejo) {
    const antes = Object.keys(opc.filas).filter((f) => f && f < viejo && Number(opc.filas[f]) > 0).sort();
    if (antes.length)
      return {
        ok: false, codigo: "OTRA_FECHA_PRIMERO",
        error: `Primero corrige el vencimiento ${mesAnio(antes[0])}: el sistema descuenta primero la fecha más próxima.`,
      };
  }
  return { ok: true };
}

/** Cuánto bajó cada fecha entre dos lecturas (sólo las que bajaron). */
export function bajasEntre(antes: PorFecha, despues: PorFecha): PorFecha {
  const out: PorFecha = {};
  for (const f of Object.keys(antes)) {
    const b = Number(antes[f] ?? 0) - Number(despues[f] ?? 0);
    if (b > 0) out[f] = b;
  }
  return out;
}

/** Las fechas del producto en la ubicación, desde el reporte de inventario. */
async function leerPorFecha(cookie: string, erpSucursal: number, erpUbicacion: number, erpProductId: number): Promise<PorFecha> {
  const crudo = await pedir(cookie, `${REPORTE}?id_ubicacion=${erpUbicacion}&id_sucursal=${erpSucursal}`, undefined, { timeoutMs: 60_000 });
  let j: { inventario?: { id_producto: string; detalles?: { fecha_vencimiento?: string; cantidad?: string | number }[] }[] };
  try { j = JSON.parse(crudo); } catch { throw new Error("No se pudo leer el inventario de la sucursal."); }
  const p = (j.inventario ?? []).find((x) => Number(x.id_producto) === erpProductId);
  const out: PorFecha = {};
  for (const d of p?.detalles ?? []) {
    const f = dia(d.fecha_vencimiento);
    out[f] = (out[f] ?? 0) + (Number(d.cantidad) || 0);
  }
  return out;
}

export async function corregirVenceSinLote(opc: {
  cookie: string;
  erpSucursal: number;
  erpUbicacion: number;
  erpProductId: number;
  descripcion: string;
  venceViejo: string | null;
  unidades: number;
  venceNuevo: string;
  referencia: string;
}): Promise<ResultadoVence> {
  const o = opc;
  const nombre = o.descripcion || `el producto ${o.erpProductId}`;
  const v = validarVenceEscrito(o.venceNuevo);
  if (!v.ok) return { ok: false, codigo: "VENCE_INVALIDO", error: v.error };
  const venceNuevo = v.vence, viejo = dia(o.venceViejo);

  const fila = await traerFila(o.cookie, o.erpProductId, o.erpUbicacion);
  if (!fila.encontrado) return { ok: false, codigo: "SIN_EXISTENCIA", error: `${nombre} no tiene existencia en esta sucursal.` };
  if (fila.regulado) return { ok: false, codigo: "LLEVA_LOTE", error: `${nombre} lleva control de lote: escribe el lote de la caja.` };
  const pres = await resolverPresentacion(o.cookie, fila, "UNIDAD", 1, { porFactor: true });
  if (!pres) return { ok: false, codigo: "SIN_PRESENTACION_DE_UNO", error: `${nombre} no tiene presentación de una unidad.` };

  const antes = await leerPorFecha(o.cookie, o.erpSucursal, o.erpUbicacion, o.erpProductId);
  const rev = revisarVenceSinLote({ filas: antes, venceViejo: viejo, unidades: o.unidades, venceNuevo });
  if (!rev.ok) return { ...rev, error: `${nombre}: ${rev.error}` };

  const concepto = conceptoDe([`CORRIGE VENCE ${viejo || "SIN FECHA"} A ${venceNuevo}`, o.referencia]);
  const cargar = async (n: number, fecha: string, conc: string) => leerRespuesta(await pedir(o.cookie, INGRESO, new URLSearchParams({
    process: "insert",
    datos: [o.erpProductId, pres.costo, pres.precio, n, "1", fecha || "NULL", pres.id, ""].join("|") + "#",
    cuantos: "1",
    total: (Number(pres.costo || 0) * n).toFixed(4),
    fecha: hoySV(),
    concepto: conc,
    destino: String(o.erpUbicacion),
    // Una sola vez: una carga reenviada tras un corte carga dos veces.
  }), { extra: { Referer: INGRESO }, reintentos: 1 }));

  // ── 1. El descargo: el sistema lo toma de la fecha más próxima ──────────
  const desc = await descartarUnaLinea({
    erpSucursal: o.erpSucursal, erpUbicacion: o.erpUbicacion,
    linea: { erp_product_id: o.erpProductId, presentacion_tipo: "", factor: 1, cantidad: o.unidades, descripcion: nombre },
    concepto, iden: "DESCARTE",
  });
  if (!desc.ok) {
    if (desc.codigo === "INCIERTO")
      return {
        ok: false, codigo: "DESCARGO_INCIERTO", error: `${nombre}: ${desc.error}`,
        descuadre: `No se sabe si salieron ${o.unidades} unidades de ${nombre}. Revisar el kardex antes de reintentar.`,
      };
    return { ok: false, codigo: "DESCARGO_RECHAZADO", error: `${nombre}: ${desc.error} (no se cambió nada).` };
  }

  // ── 2. ¿Salieron de la fecha que se corrige? ────────────────────────────
  const medio = await leerPorFecha(o.cookie, o.erpSucursal, o.erpUbicacion, o.erpProductId);
  const bajas = bajasEntre(antes, medio);
  const fechas = Object.keys(bajas);
  if (!(fechas.length === 1 && fechas[0] === viejo && bajas[viejo] === o.unidades)) {
    const fallidas: string[] = [];
    for (const f of fechas) {
      const r = await cargar(bajas[f], f, conceptoDe([`DESHACE CORRECCION VENCE ${venceNuevo}`, o.referencia]));
      if (!r.ok) fallidas.push(`${bajas[f]} u. con vencimiento ${mesAnio(f)}`);
    }
    const error = `${nombre}: el sistema no descontó la fecha ${mesAnio(viejo)}. No se cambió nada.`;
    return fallidas.length
      ? { ok: false, codigo: "FECHA_EQUIVOCADA", error, descuadre: `Faltan por devolver ${fallidas.join(" y ")} de ${nombre}.` }
      : { ok: false, codigo: "FECHA_EQUIVOCADA", error };
  }

  // ── 3. La carga, con la fecha correcta ──────────────────────────────────
  const carga = await cargar(o.unidades, venceNuevo, concepto);
  const despues = await leerPorFecha(o.cookie, o.erpSucursal, o.erpUbicacion, o.erpProductId);
  const subio = Number(despues[venceNuevo] ?? 0) - Number(medio[venceNuevo] ?? 0);
  if (subio < o.unidades)
    return {
      ok: false, codigo: "CARGA_INCOMPLETA",
      error: `${nombre}: no entró la existencia con vencimiento ${mesAnio(venceNuevo)}${carga.msg ? `: ${carga.msg}` : ""}.`,
      descuadre: `Salieron ${o.unidades} unidades de ${nombre} con vencimiento ${mesAnio(viejo)} y entraron ${Math.max(0, subio)} `
        + `con ${mesAnio(venceNuevo)}. Faltan ${o.unidades - Math.max(0, subio)}.`,
    };
  return { ok: true, lote: "", vence: venceNuevo, unidades: o.unidades, concepto, avisos: [] };
}
