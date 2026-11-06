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
  /** Si viene, se descarta ESE lote y no el que vence primero (un producto
   *  devuelto sale con el lote con que entró). */
  lote?: string | null;
}

export interface LoteDeDescargo { id: string; numero: string; vence: string; stock: number }
export interface RenglonDeDescargo { idLote: string; numero: string; vence: string; cantidad: number }

const esGenerico = (n: string) => /^gen[eé]rico$/i.test(String(n ?? "").trim());

/**
 * De qué lotes sale un descargo, en presentaciones ENTERAS (2026-11-05).
 *
 * Hasta ese día se pedía UN registro que alcanzara solo. Dos casos reales lo
 * rompían sin que faltara producto: lo «sin lote asignado» partido en varios
 * registros (FOLIMEN en Bodega: 2 + 2) y la existencia repartida entre lotes.
 *
 * 1. Si un lote alcanza solo, ése: el que vence primero (un renglón, como antes).
 *    Lo sin lote asignado cuenta JUNTO para esta pregunta.
 * 2. Si no, se completa por vencimiento, cada paquete entero de un lote.
 * Con `numero`, sólo los registros de ESE lote (un producto devuelto sale con el
 * lote con que entró). Devuelve lo que falta; no inventa.
 */
export function lotesDelDescargo(
  lotes: LoteDeDescargo[], paquetes: number, unidad: number, numero?: string | null,
): { renglones: RenglonDeDescargo[]; faltan: number } {
  const u = Number(unidad) || 1;
  const caben = (x: LoteDeDescargo) => Math.floor((Number(x.stock) + 1e-9) / u);
  const pool = numero
    ? lotes.filter((x) => esGenerico(numero) ? esGenerico(x.numero) : x.numero === String(numero))
    : lotes;
  const porVence = [...pool].filter((x) => x.stock > 0)
    .sort((a, b) => (a.vence || "").localeCompare(b.vence || ""));
  const comoRenglon = (x: LoteDeDescargo, n: number) => ({ idLote: x.id, numero: x.numero, vence: x.vence, cantidad: n });

  // 1. Un solo lote. Lo sin lote asignado es UN lote aunque viva en varios registros.
  const solo = porVence.find((x) => !esGenerico(x.numero) && caben(x) >= paquetes);
  const gen = porVence.filter((x) => esGenerico(x.numero));
  const genCaben = gen.reduce((n, x) => n + caben(x), 0);
  const genVence = gen[0]?.vence ?? "";
  const usarGen = genCaben >= paquetes && (!solo || genVence.localeCompare(solo.vence || "") <= 0);
  if (usarGen) {
    const renglones: RenglonDeDescargo[] = [];
    let resto = paquetes;
    for (const x of [...gen].sort((a, b) => caben(b) - caben(a))) {
      if (resto <= 0) break;
      const t = Math.min(caben(x), resto);
      if (t > 0) { renglones.push(comoRenglon(x, t)); resto -= t; }
    }
    return { renglones, faltan: 0 };
  }
  if (solo) return { renglones: [comoRenglon(solo, paquetes)], faltan: 0 };

  // 2. Por vencimiento, paquetes enteros.
  const renglones: RenglonDeDescargo[] = [];
  let resto = paquetes;
  for (const x of porVence) {
    if (resto <= 0) break;
    const t = Math.min(caben(x), resto);
    if (t > 0) { renglones.push(comoRenglon(x, t)); resto -= t; }
  }
  return { renglones, faltan: resto };
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
  // Sin tipo (un producto erróneo, que se descarga por unidades): cualquier
  // presentación de ese factor; el factor se vuelve a comprobar abajo.
  const buscada = norm(`${l.presentacion_tipo} (${l.factor})`);
  const elegida = l.presentacion_tipo
    ? presentaciones.find((p) => p.etiqueta === buscada)
    : presentaciones.find((p) => p.etiqueta.endsWith(`(${l.factor})`));
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

  // Existencia, en unidades base. En un producto con lote, la casilla de
  // existencia trae la del lote que la pantalla preselecciona y no la del
  // producto (ver `disponibleEnBodega`): se suma de los lotes.
  const enUnidades = Number(l.cantidad) * Number(unidad);
  const existencia = regulado ? lotes.reduce((n, x) => n + x.stock, 0) : stock;
  if (existencia !== null && enUnidades > existencia + 1e-9) {
    return { ok: false, codigo: "SIN_EXISTENCIA",
             error: `De ${nombre} quedan ${existencia} unidades y el descarte lleva ${enUnidades}.` };
  }

  // Lotes: uno si alcanza (el que vence primero), si no por vencimiento con
  // paquetes enteros, y si ninguna combinación arma la presentación, en la
  // presentación de una unidad — que sale de los mismos lotes. Cada lote es un
  // renglón del mismo descargo: se sabe exactamente qué salió de cuál.
  let presId = elegida.id;
  let cantidad = Number(l.cantidad);
  let renglones: RenglonDeDescargo[] = [{ idLote: "0", numero: "", vence: "", cantidad }];
  const avisos: string[] = [];
  if (regulado) {
    let r = lotesDelDescargo(lotes, cantidad, Number(unidad), l.lote);
    if (r.faltan > 0 && Number(unidad) > 1) {
      const base = presentaciones.find((p) => p.etiqueta.endsWith("(1)"));
      const enU = lotesDelDescargo(lotes, enUnidades, 1, l.lote);
      if (base && enU.faltan === 0) {
        try {
          const jb = JSON.parse(await pedir(cookie, DESCARGO, new URLSearchParams({
            process: "getpresentacion", id_presentacion: base.id,
          }), { extra: { Referer: DESCARGO } }));
          if (Number(jb?.unidad) !== 1) throw new Error("factor");
          costo = String(jb.costo); precio = String(jb.precio); unidad = "1";
        } catch {
          return { ok: false, codigo: "PRESENTACION_ILEGIBLE", error: `No se pudo leer la presentación de una unidad de ${nombre}.` };
        }
        avisos.push(`ningún lote completaba ${l.presentacion_tipo} (${l.factor}): salió en ${enUnidades} unidades`);
        presId = base.id;
        cantidad = enUnidades;
        r = enU;
      }
    }
    if (r.faltan > 0) {
      if (l.lote) return { ok: false, codigo: "SIN_LOTE", error: `${nombre}: el lote ${l.lote} no alcanza en esta ubicación.` };
      return { ok: false, codigo: "SIN_LOTE",
               error: `${nombre}: los lotes de esta sucursal no alcanzan para ${l.cantidad} de ${l.presentacion_tipo || "la presentación"}.` };
    }
    renglones = r.renglones;
  }

  const datos = renglones.map((r) =>
    [l.erp_product_id, costo, precio, r.cantidad, unidad, "", presId, r.idLote].join("|")).join("#") + "#";
  const total = Number(costo || 0) * cantidad;
  // Una sola vez: un descarte reenviado tras un corte descarta dos veces.
  const crudo = await pedir(cookie, DESCARGO, new URLSearchParams({
    process: "insert", datos, cuantos: String(renglones.length), total: total.toFixed(4), fecha: hoySV(),
    concepto, origen: String(erpUbicacion), iden,
  }), { extra: { Referer: DESCARGO }, reintentos: 1 });
  const resp = leerRespuesta(crudo);
  if (!resp.ok) {
    let legible = true;
    try { JSON.parse(crudo); } catch { legible = false; }
    if (!legible) return { ok: false, codigo: "INCIERTO", error: "El sistema contestó algo que no se entiende: puede haber entrado." };
    return { ok: false, codigo: "RECHAZADO", error: `El sistema de la caja no aceptó el descarte: ${resp.msg || "sin detalle"}` };
  }

  return {
    ok: true,
    aplicado: {
      at: new Date().toISOString(), movimiento: "DESCARTE", iden, concepto,
      erp_sucursal_id: erpSucursal, erp_ubicacion_id: erpUbicacion,
      erp_product_id: l.erp_product_id, presentacion: `${l.presentacion_tipo} (${l.factor})`,
      id_presentacion_erp: presId, cantidad, unidad, costo, precio,
      total: Number(total.toFixed(4)), stock_previo: existencia,
      // `lote` (el primero) se conserva para quien ya lo lee; `lotes` es el detalle completo.
      lote: regulado ? { numero: renglones[0].numero, vence: renglones[0].vence } : null,
      lotes: regulado ? renglones.map((r) => ({ numero: r.numero, vence: r.vence, cantidad: r.cantidad })) : null,
      avisos, msg: resp.msg,
    },
  };
}
