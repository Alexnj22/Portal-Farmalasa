// ── El formulario de una compra, armado desde el documento (2026-10-29) ─────
//
// Es la traducción de `senddata()` + `storeTblValue()` + `totales()` de
// `js/funciones/funciones_compras.js` del sistema de la caja: lo que su
// pantalla de compras manda al apretar Guardar. Se escribe acá UNA vez y la usan
// el simulacro y el envío real, así que lo que se revisa es exactamente lo que
// se mandaría.
//
// Pura a propósito: `tests/unit/compraSobre.test.js` la corre sin red.
//
// Tres cosas de ese formulario que no se ven leyéndolo de corrido:
//   · `cant` va en la PRESENTACIÓN elegida y `compra` es el costo de UNA de
//     ellas; las existencias que suma son `cant × unidad`. Por eso una caja de
//     10 que el sistema lleva por unidad entra como 10 × (costo / 10) y no como
//     1 × costo: sumada a la presentación de 1 serían 9 unidades de menos.
//   · El IVA lo calcula él (13 % de lo gravado, sólo en CCF) y la percepción
//     también (tasa del proveedor, sólo si lo gravado llega a $100). No se le
//     manda ninguno de los dos como dato: se le manda lo que él mismo
//     calcularía, y la revisión compara ESE total contra el del documento.
//   · El vencimiento de un producto perecedero va como `AAAA-MM-01` (su
//     calendario sólo elige mes) y el de uno que no lo es, como la cadena
//     `NULL`. El lote sólo lo lee si el producto es regulado.

export type Presentacion = { id: string; unidad: number; costo: number; precio: number };

export type ProductoDelSistema = {
  id: number;
  nombre: string;
  perecedero: boolean;
  regulado: boolean;
  presentaciones: Presentacion[];
};

export type RenglonDoc = {
  descripcion: string;
  cantidad: number;
  precio: number;      // precioUni del documento
  descuento: number;   // montoDescu
  exento: boolean;
};

export type Decision =
  | { tipo: "producto"; producto: ProductoDelSistema; factor: number; lote: string | null; vence: string | null }
  | { tipo: "consumo" };

export type LineaSobre = {
  id_producto: string;
  compra: string;
  venta: string;
  cant: string;
  unidad: string;
  vence: string;
  id_presentacion: string;
  exento: number;
  bandera: "PRODUCTO" | "SERVICIO";
  descripcion_ser: string;
  compra_fin: string;
  numero_lote: string;
};

export type Problema = { renglon: number | null; texto: string };

const r4 = (n: number) => Math.round(n * 1e4) / 1e4;
const r2 = (n: number) => Math.round(n * 100) / 100;

/** El costo por unidad del proveedor, neto de su descuento. */
export function costoNeto(r: RenglonDoc): number {
  if (!(r.cantidad > 0)) return r.precio;
  return r4((r.precio * r.cantidad - (r.descuento || 0)) / r.cantidad);
}

/**
 * Un renglón del documento → un renglón del formulario.
 *
 * `factor` es cuántas unidades del producto trae CADA unidad que factura el
 * proveedor (lo aprende el diccionario). Se busca una presentación del sistema
 * de ese mismo tamaño; si no la hay, se carga en la de 1 multiplicando la
 * cantidad. Si tampoco hay de 1, el renglón no se puede cargar y se dice.
 */
export function lineaDelSobre(
  i: number, r: RenglonDoc, d: Decision,
): { linea: LineaSobre | null; problemas: Problema[]; detalle?: Record<string, unknown> } {
  const problemas: Problema[] = [];
  const costo = costoNeto(r);
  if (!(r.cantidad > 0)) problemas.push({ renglon: i, texto: "La cantidad del documento no es válida." });

  if (d.tipo === "consumo") {
    return {
      linea: {
        id_producto: "SERV", compra: costo.toFixed(4), venta: "0", cant: String(r.cantidad),
        unidad: "1", vence: "NULL", id_presentacion: "1", exento: r.exento ? 1 : 0,
        bandera: "SERVICIO", descripcion_ser: String(r.descripcion ?? "").slice(0, 200),
        compra_fin: costo.toFixed(4), numero_lote: "",
      },
      problemas,
    };
  }

  const p = d.producto;
  const factor = Number(d.factor) > 0 ? Number(d.factor) : 1;
  let pres = p.presentaciones.find((x) => x.unidad === factor) ?? null;
  let cant = r.cantidad;
  let compra = costo;
  if (!pres) {
    pres = p.presentaciones.find((x) => x.unidad === 1) ?? null;
    if (pres) { cant = r4(r.cantidad * factor); compra = r4(costo / factor); }
  }
  if (!pres) {
    problemas.push({
      renglon: i,
      texto: `«${p.nombre}» no tiene presentación de ${factor} ni de 1 unidad.`,
    });
    return { linea: null, problemas };
  }

  let vence = "NULL";
  if (p.perecedero) {
    const m = /^(\d{4})-(\d{2})/.exec(d.vence ?? "");
    if (m) vence = `${m[1]}-${m[2]}-01`;
    else problemas.push({ renglon: i, texto: `«${p.nombre}» vence y el renglón no dice cuándo.` });
  }
  const lote = p.regulado ? String(d.lote ?? "").trim() : "";
  if (p.regulado && !lote) problemas.push({ renglon: i, texto: `«${p.nombre}» lleva lote y el renglón no lo trae.` });

  return {
    linea: {
      id_producto: String(p.id), compra: compra.toFixed(4), venta: pres.precio.toFixed(4),
      cant: String(cant), unidad: String(pres.unidad), vence, id_presentacion: pres.id,
      exento: r.exento ? 1 : 0, bandera: "PRODUCTO", descripcion_ser: "-",
      compra_fin: compra.toFixed(4), numero_lote: lote,
    },
    problemas,
    detalle: { presentacion: pres.unidad, existencias: r4(cant * pres.unidad) },
  };
}

/** Lo que el formulario calcularía con esas líneas (copia de `totales()`). */
export function totalesDelSobre(
  lineas: LineaSobre[], tipoDoc: "CCF" | "COF" | "FSE", tasaPercepcion: number,
) {
  let gravado = 0, exento = 0;
  for (const l of lineas) {
    const sub = r4(Number(l.compra_fin) * Number(l.cant));
    if (l.exento) exento += sub; else gravado += sub;
  }
  const percepcion = gravado >= 100 ? r4(gravado * tasaPercepcion) : 0;
  const iva = tipoDoc === "CCF" ? r4(gravado * 0.13) : 0;
  const total = r2(gravado + percepcion + iva + exento);
  return {
    sumas_sin_iva: r4(gravado).toFixed(4),
    subtotal: r4(gravado + iva).toFixed(4),
    iva: r4(iva).toFixed(4),
    venta_exenta: exento.toFixed(2),
    total_percepcion: r2(percepcion).toFixed(2),
    total: total.toFixed(2),
  };
}

/** El tipo de documento del sistema a partir del `tipoDte` del estándar. */
export function tipoDocDe(tipoDte: string | null | undefined): "CCF" | "COF" | "FSE" | null {
  return tipoDte === "03" ? "CCF" : tipoDte === "01" ? "COF" : tipoDte === "14" ? "FSE" : null;
}

/** El total del documento, para compararlo con el que calcularía el sistema. */
export function totalDelDocumento(resumen: any): number | null {
  const v = resumen?.montoTotalOperacion ?? resumen?.totalPagar;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
