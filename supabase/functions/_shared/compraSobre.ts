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
  /** ventaGravada + ventaExenta + ventaNoSuj: lo que el proveedor cobró por
   *  el renglón, ya con su redondeo. Manda sobre precio × cantidad, que en un
   *  documento de Steiner da 2,123.88 donde la factura suma 2,123.89. */
  subtotal?: number;
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
  if (Number(r.subtotal) > 0) return r4(Number(r.subtotal) / r.cantidad);
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

  // Sin vencimiento: el sistema lo acepta vacío —así se carga hoy Sarita,
  // medido en sus lotes del 21-oct— y el lote es UNO para toda la red, así que
  // la primera sala que lo recibe le pone la fecha (usuario, 2026-10-29). Sólo
  // un producto REGULADO frena: ahí la fecha es parte del control sanitario.
  let vence = "NULL";
  let vencePendiente = false;
  if (p.perecedero) {
    const m = /^(\d{4})-(\d{2})/.exec(d.vence ?? "");
    if (m) vence = `${m[1]}-${m[2]}-01`;
    else if (p.regulado) problemas.push({ renglon: i, texto: `«${p.nombre}» es regulado y el renglón no dice cuándo vence.` });
    else { vence = ""; vencePendiente = true; }
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
    // `costo_anterior` es el de la presentación en Bodega ANTES de esta compra,
    // en la misma base que `linea.compra` (sin IVA, por presentación): la
    // pantalla compara los dos para decir si subió y si el precio aguanta.
    detalle: {
      presentacion: pres.unidad, existencias: r4(cant * pres.unidad), vence_pendiente: vencePendiente,
      costo_anterior: Number.isFinite(pres.costo) && pres.costo > 0 ? pres.costo : null,
    },
  };
}

/** Lo que el formulario calcularía con esas líneas (copia de `totales()`). */
/**
 * Producto de regalo (renglón de producto a $0, como «PROMOCIONAL ELECTROLIT»):
 * su costo se REPARTE entre todas las unidades de la compra, que es como lo
 * carga Bodega a mano — medido en las compras 5871, 5872 y 6372 de Steiner:
 * 1,200 unidades pagadas a $1.7699 y 108 de regalo quedan TODAS a
 * $1.6237/$1.6238 (= 2,123.87 ÷ 1,308). Cargado a $0, el regalo bajaría el
 * costo promedio de ese sabor solo y el de los demás quedaría alto.
 *
 * Generalizado: el regalo vale lo que en promedio costó una unidad pagada, y
 * todo se escala por la misma razón para que el total no se mueva. Cada
 * renglón conserva su subtotal redondeado; el costo por unidad sale de ahí.
 * Devuelve cuántos renglones eran regalo.
 */
export function repartirRegalos(lineas: LineaSobre[], cobrado: number[] = []): number {
  // `cobrado[i]` = subtotal de la factura para `lineas[i]`; sin él, costo × cant.
  const exactoDe = new Map(lineas.map((l, i) => [l, Number(cobrado[i]) > 0 ? Number(cobrado[i]) : Number(l.compra) * Number(l.cant)]));
  const prod = lineas.filter((l) => l.bandera === "PRODUCTO" && !l.exento);
  const regalos = prod.filter((l) => Number(l.compra) === 0 && Number(l.cant) > 0);
  const pagados = prod.filter((l) => Number(l.compra) > 0);
  if (!regalos.length || !pagados.length) return 0;
  // En existencias (cant × unidad), no en cajas: un regalo puede venir suelto.
  const exist = (l: LineaSobre) => Number(l.cant) * Number(l.unidad);
  const pagado = pagados.reduce((a, l) => a + exactoDe.get(l)!, 0);
  const uPagadas = pagados.reduce((a, l) => a + exist(l), 0);
  const uRegalo = regalos.reduce((a, l) => a + exist(l), 0);
  const ref = pagado / uPagadas;               // costo de una unidad pagada
  const k = pagado / (pagado + ref * uRegalo); // = uPagadas / (uPagadas + uRegalo)
  // El costo va con 4 decimales, y redondear cada renglón por su lado corre
  // el total hasta 4 centavos en una compra de 1,300 unidades. Se elige hacia
  // abajo o hacia arriba según cuál deje la suma acumulada más cerca de la
  // exacta — Bodega hace lo mismo a mano: alterna $1.6237 y $1.6238.
  let exacto = 0, armado = 0;
  for (const l of prod) {
    const cant = Number(l.cant);
    const valor = (Number(l.compra) > 0 ? exactoDe.get(l)! : ref * exist(l)) * k;
    exacto += valor;
    const u = (valor / cant) * 1e4;
    const abajo = Math.floor(u) / 1e4, arriba = Math.ceil(u) / 1e4;
    const c = Math.abs(armado + abajo * cant - exacto) <= Math.abs(armado + arriba * cant - exacto) ? abajo : arriba;
    armado += c * cant;
    l.compra = c.toFixed(4); l.compra_fin = l.compra;
  }
  return regalos.length;
}

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

/**
 * El tamaño de la caja cuando el proveedor lo escribe en la descripción:
 * «Barrita Fresa Sarita|7401090800083|25.000 |Caja» (Sarita) o
 * «PALETA FROZEN MIXTA CJA 25 UND» (Nevería). Sólo esas dos formas: un número
 * suelto en el nombre suele ser gramos o mililitros.
 */
export function factorEnLaDescripcion(t: string): number | null {
  const m = /\|\s*(\d+)(?:\.0+)?\s*\|\s*caja\b/i.exec(t) ?? /\bCJA\.?\s*(?:X\s*)?(\d+)\s*(?:U|UND|UNDS|UNIDADES)\b/i.exec(t);
  const n = m ? Number(m[1]) : NaN;
  return Number.isInteger(n) && n >= 2 && n <= 500 ? n : null;
}

/** El tipo de documento del sistema a partir del `tipoDte` del estándar. */
export function tipoDocDe(tipoDte: string | null | undefined): "CCF" | "COF" | "FSE" | null {
  return tipoDte === "03" ? "CCF" : tipoDte === "01" ? "COF" : tipoDte === "14" ? "FSE" : null;
}

/** El total del documento, para compararlo con el que calcularía el sistema. */
export function totalDelDocumento(resumen: any): number | null {
  const num = (v: unknown) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
  // El total de Bodega lleva la percepción adentro, y la percepción no tiene
  // un solo lugar: Hacienda la deja FUERA de `montoTotalOperacion` y la suma en
  // `totalPagar` (C. Imberton, 28-oct: 753.39 + 6.67 = 760.06); otros la meten
  // en los dos, y GAMMA ni siquiera llena `ivaPerci1` (342.45 → 345.48). Lo
  // que coincide siempre es `totalPagar`, con las retenciones devueltas (las
  // descuenta el que paga, no cambian la compra). Medido contra las compras
  // que Bodega cargó a mano desde agosto: ver el changelog de v2.1382.1.
  const pagar = num(resumen?.totalPagar);
  if (pagar != null) {
    const rete = (num(resumen?.ivaRete1) ?? 0) + (num(resumen?.reteRenta) ?? 0);
    return Math.round((pagar + rete) * 100) / 100;
  }
  return num(resumen?.montoTotalOperacion);
}

// ── Producto nuevo desde un renglón (paso 4 del plan) ────────────────────────
//
// Traducción de `senddata()` de `js/funciones/funciones_producto.js` con
// `process=insert`. El producto nuevo COPIA a uno parecido —categoría,
// laboratorio, proveedor, marcas de perecedero/exento/regulado/antibiótico—
// porque son siete decisiones que la persona que carga una compra no tiene
// por qué saber, y equivocarse en «regulado» saca al producto del control.
// Lo único que se pide es lo que el modelo no puede saber: nombre, código de
// barras y precio de venta.

export type Modelo = {
  id: number; nombre: string;
  categoria: string | null; laboratorio: string | null; proveedor: string | null;
  perecedero: boolean; exento: boolean; decimal: boolean; regulado: boolean; antibiotico: boolean;
  marca: string;
  /** Los 7 precios de su presentación de 1 unidad, en el orden del formulario. */
  precios: number[] | null;
};

const seleccionado = (html: string, id: string): string | null => {
  const m = new RegExp(`<select[^>]*id=["']${id}["'][^>]*>([\\s\\S]*?)</select>`).exec(html);
  if (!m) return null;
  const o = /<option[^>]*value=['"]?(\d+)['"]?[^>]*\bselected\b/.exec(m[1]);
  return o ? o[1] : null;
};
const marcado = (html: string, id: string): boolean =>
  new RegExp(`<input[^>]*id=["']${id}["'][^>]*\\bchecked\\b`).test(html);
const valorDe = (html: string, id: string): string => {
  const m = new RegExp(`<input[^>]*id=["']${id}["'][^>]*value=["']([^"']*)["']`).exec(html);
  return m ? m[1].trim() : "";
};

/** Lee la pantalla de edición del modelo (`editar_producto.php`, un GET). */
export function leerModelo(id: number, html: string): Modelo {
  // La tabla de presentaciones: cada fila trae sus celdas con clase
  // (`unidad_p`, `precio0`…`precio6`). Se toma la ACTIVA de 1 unidad; una
  // presentación desactivada se dibuja igual y no sirve de modelo.
  let precios: number[] | null = null;
  const tabla = /id=["']presentacion_table["'][^>]*>([\s\S]*?)<\/tbody>/.exec(html)?.[1] ?? "";
  const celda = (fila: string, clase: string) => {
    const m = new RegExp(`<td[^>]*class=['"][^'"]*\\b${clase}\\b[^'"]*['"][^>]*>([^<]*)<`).exec(fila);
    return m ? Number(m[1].trim()) : NaN;
  };
  for (const fila of tabla.split(/<tr/i).slice(1)) {
    if (/fa-eye-slash/.test(fila)) continue;
    if (celda(fila, "unidad_p") !== 1) continue;
    const p7 = [0, 1, 2, 3, 4, 5, 6].map((k) => celda(fila, `precio${k}`));
    if (p7.every((x) => Number.isFinite(x))) { precios = p7; break; }
  }
  return {
    id, nombre: valorDe(html, "descripcion"),
    categoria: seleccionado(html, "id_categoria"),
    laboratorio: seleccionado(html, "id_laboratorio"),
    proveedor: seleccionado(html, "proveedor"),
    perecedero: marcado(html, "perecedero"), exento: marcado(html, "exento"),
    decimal: marcado(html, "decimal"), regulado: marcado(html, "regulado"),
    antibiotico: marcado(html, "antibiotico"),
    marca: valorDe(html, "marca"), precios,
  };
}

/**
 * Los 7 precios del nuevo: el primero es el que pone la persona y los otros
 * guardan la MISMA proporción que en el modelo. Un cero sigue en cero (esa
 * lista no se usa) y un precio simbólico de ≤ $0.05 se copia tal cual —el
 * modelo trae $0.01 en el séptimo y escalarlo no tiene sentido—.
 */
export function preciosDelNuevo(modelo: number[], precio: number): number[] {
  const base = modelo[0];
  return modelo.map((p, i) => {
    if (i === 0) return r2(precio);
    if (!(p > 0)) return 0;
    if (p <= 0.05 || !(base > 0)) return p;
    return r2((p / base) * precio);
  });
}

export function sobreDeProductoNuevo(
  m: Modelo, n: { nombre: string; barcode: string; costo: number; precio: number },
): Record<string, string> {
  const precios = preciosDelNuevo(m.precios ?? [n.precio, 0, 0, 0, 0, 0, 0], n.precio);
  // id_pp 1 = «UNIDAD» del catálogo de presentaciones; descripción «1X1» como
  // la de todos los modelos medidos.
  const lista = `1,1X1,1,0,0,${n.costo.toFixed(4)},${n.barcode},${precios.map((p) => p.toFixed(4)).join("#")}#;`;
  // El formulario original manda la cadena «undefined» en lo que no está
  // marcado (`$('#x:checked').val()`); se reproduce igual.
  const casilla = (b: boolean) => (b ? "1" : "undefined");
  const sobre: Record<string, string> = {
    process: "insert", id_producto: "0", barcode: n.barcode, descripcion: n.nombre,
    exento: casilla(m.exento), proveedor: m.proveedor ?? "", id_categoria: m.categoria ?? "",
    perecedero: casilla(m.perecedero), lista, marca: m.marca, minimo: "undefined",
    cuantos: "1", estado: "undefined", decimals: casilla(m.decimal), composicion: "",
    id_laboratorio: m.laboratorio ?? "", json_arr: "[]",
    regulado: m.regulado ? "1" : "0", antibiotico: m.antibiotico ? "1" : "0",
  };
  for (let i = 0; i < 7; i++) sobre[`desc${i}`] = "0";
  return sobre;
}
