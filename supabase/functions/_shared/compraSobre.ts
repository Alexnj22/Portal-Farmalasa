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

export type Presentacion = { id: string; unidad: number; costo: number; precio: number; nombre?: string };

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
  | { tipo: "producto"; producto: ProductoDelSistema; factor: number; lote: string | null; vence: string | null; venta?: number | null }
  | { tipo: "consumo" }
  // Un renglón que no es mercadería dentro de una compra que sí lo es: el
  // flete (2026-11-05). Entra como SERVICIO en la MISMA compra —el botón
  // «+ Servicio» del sistema—: suma al total y al libro, no toca inventario.
  | { tipo: "servicio" };

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

export type Problema = { renglon: number | null; texto: string; pistas?: string[] };

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

  if (d.tipo === "consumo" || d.tipo === "servicio") {
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
  // Cada una de la factura trae un número ENTERO de unidades (1, 10, 25…).
  // Un factor partido sale de escribir en «Cantidad a cargar» menos de lo
  // facturado —45 de 50 dan 0.9—, y sin este freno entraban 45 unidades a
  // $6.26 en vez de 50 a $5.63: el faltante se escondía en un costo inflado.
  if (!Number.isInteger(Math.round(factor * 1e6) / 1e6)) {
    const unidades = r4(r.cantidad * factor);
    problemas.push({
      renglon: i,
      texto: unidades < r.cantidad
        ? `«${p.nombre}»: se cargan ${unidades} y la factura cobra ${r.cantidad}. Se carga lo facturado; si llegó menos, hay que pedir la nota de crédito.`
        : `«${p.nombre}»: ${unidades} unidades no se reparten parejo en las ${r.cantidad} que factura el proveedor.`,
    });
    return { linea: null, problemas };
  }
  let pres = p.presentaciones.find((x) => x.unidad === factor) ?? null;
  let cant = r.cantidad;
  let compra = costo;
  if (!pres) {
    pres = p.presentaciones.find((x) => x.unidad === 1) ?? null;
    if (pres) { cant = r4(r.cantidad * factor); compra = r4(costo / factor); }
  }
  if (!pres) {
    // Decir QUÉ hay y QUÉ hacer (Bodega, 2026-11-05, NOR-CLAMIDA X 30: el texto
    // viejo «no tiene presentación de 1 ni de 1 unidad» no se entendía).
    const hay = p.presentaciones.map((x) => `${x.nombre ?? "presentación"} de ${x.unidad}`).join(", ");
    const tam = p.presentaciones.filter((x) => x.unidad > 1).map((x) => x.unidad);
    const sugerencia = tam.length
      ? ` Si cada una de la factura es una ${p.presentaciones.find((x) => x.unidad === tam[0])?.nombre ?? "caja"} de ${tam[0]}, elígela en «Se carga como» (entran ${r4(r.cantidad * tam[0])} unidades).`
      : "";
    problemas.push({
      renglon: i,
      texto: factor === 1
        ? `«${p.nombre}» sólo se vende en el sistema como ${hay || "ninguna presentación"}: no tiene presentación de 1 unidad.${sugerencia} Si de verdad se compró suelto, hay que crearle la presentación de 1 unidad al producto.`
        : `«${p.nombre}» no tiene presentación de ${factor} ni de 1 unidad (tiene ${hay || "ninguna"}).${sugerencia} Si no, hay que crearle la presentación al producto.`,
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
  // La viñeta: la que Bodega leyó en la caja, o la que ya tiene. El sistema
  // la guarda como el precio de venta de esa presentación.
  const vinetaNueva = Number(d.venta) > 0 ? r2(Number(d.venta)) : null;
  if (vinetaNueva && pres.precio > 0 && (vinetaNueva > pres.precio * 3 || vinetaNueva < pres.precio / 3)) {
    problemas.push({ renglon: i, texto: `«${p.nombre}»: la viñeta nueva ($${vinetaNueva.toFixed(2)}) está muy lejos de la actual ($${pres.precio.toFixed(2)}). Revisa que sea de la misma presentación.` });
  }
  const venta = vinetaNueva ?? pres.precio;
  const lote = p.regulado ? String(d.lote ?? "").trim() : "";
  if (p.regulado && !lote) problemas.push({ renglon: i, texto: `«${p.nombre}» lleva lote y el renglón no lo trae.` });

  return {
    linea: {
      id_producto: String(p.id), compra: compra.toFixed(4), venta: venta.toFixed(4),
      cant: String(cant), unidad: String(pres.unidad), vence, id_presentacion: pres.id,
      exento: r.exento ? 1 : 0, bandera: "PRODUCTO", descripcion_ser: "-",
      compra_fin: compra.toFixed(4), numero_lote: lote,
    },
    problemas,
    // `costo_anterior` es el de la presentación en Bodega ANTES de esta compra,
    // en la misma base que `linea.compra` (sin IVA, por presentación): la
    // pantalla compara los dos para decir si subió y si el precio aguanta.
    detalle: {
      presentacion: pres.unidad, presentacion_nombre: pres.nombre ?? null,
      existencias: r4(cant * pres.unidad), vence_pendiente: vencePendiente,
      costo_anterior: Number.isFinite(pres.costo) && pres.costo > 0 ? pres.costo : null,
      venta_anterior: Number.isFinite(pres.precio) && pres.precio > 0 ? pres.precio : null,
    },
  };
}

/**
 * Descuento de la FACTURA, no del renglón (`resumen.descuGravada` /
 * `descuExenta`): RONASA 226C02B8 trae 50 × $5.63 = $281.50 y un 35 % al pie
 * ($98.52). Cada renglón dice $5.63, pero lo que se paga por unidad es
 * $3.6595 — el mismo costo con que Bodega la cargó a mano la vez anterior.
 * Sin repartirlo, la carga salía $111.33 arriba del documento y el aviso de
 * margen gritaba «sube 53.8 %».
 *
 * Devuelve por cuánto multiplicar el subtotal de cada renglón gravado y
 * exento. Sólo se aplica si el propio documento lo resta (`subTotal` =
 * ventas − descuentos de la factura): un emisor que repite ahí la suma de los
 * descuentos por renglón —que ya vienen restados en `ventaGravada`— lo
 * restaría dos veces.
 */
export function factorDescuentoDeFactura(resumen: any): { gravada: number; exenta: number } {
  const n = (v: unknown) => Number(v) || 0;
  const dG = n(resumen?.descuGravada), dE = n(resumen?.descuExenta), dN = n(resumen?.descuNoSuj);
  const sin = { gravada: 1, exenta: 1 };
  if (!(dG > 0 || dE > 0)) return sin;
  const ventas = n(resumen?.subTotalVentas) || n(resumen?.totalGravada) + n(resumen?.totalExenta) + n(resumen?.totalNoSuj);
  if (Math.abs(ventas - dG - dE - dN - n(resumen?.subTotal)) > 0.02) return sin;
  const g = n(resumen?.totalGravada), e = n(resumen?.totalExenta);
  return {
    gravada: g > 0 && dG > 0 ? (g - dG) / g : 1,
    exenta: e > 0 && dE > 0 ? (e - dE) / e : 1,
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
 * El encabezado de la compra con los montos del DOCUMENTO, al centavo
 * (usuario, 2026-11-06: «muy bien» — la compra se registra como la emitió el
 * proveedor).
 *
 * `totalesDelSobre` suma las partes con 4 decimales y redondea al final; el
 * proveedor redondea cada parte y después suma. Con todo bien armado, eso
 * corría el total un centavo en 5 de 41 compras del 6-nov (6538: el documento
 * dice 604.60 + 78.60 + 6.05 = 689.25 y se cargó 689.24), y el sistema guardaba
 * un encabezado que no suma su propio total. El centavo es del COSTO de los
 * renglones —inventario—, no del documento.
 *
 * Sólo cuando la diferencia es de redondeo (≤ `tolerancia`): una mayor es un
 * problema de verdad y la revisión ya frena. Cada parte se toma del documento
 * sólo si está a 2 centavos de la nuestra: un proveedor que no llena
 * `ivaPerci1` (GAMMA) o un descuento global dejan la nuestra.
 */
export function encabezadoDelDocumento(
  tot: ReturnType<typeof totalesDelSobre>, resumen: any, totalDoc: number | null, tolerancia: number,
): ReturnType<typeof totalesDelSobre> {
  if (totalDoc == null || !(Math.abs(Number(tot.total) - totalDoc) <= tolerancia)) return tot;
  const num = (v: unknown) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
  const tributos = Array.isArray(resumen?.tributos) ? resumen.tributos : null;
  const ivaDoc = tributos
    ? tributos.filter((t: any) => String(t?.codigo) === "20").reduce((a: number, t: any) => a + Number(t?.valor ?? 0), 0)
    : num(resumen?.totalIva);
  const gravDoc = num(resumen?.totalGravada) == null ? null : num(resumen.totalGravada)! - (num(resumen?.descuGravada) ?? 0);
  const percDoc = num(resumen?.ivaPerci1);
  const cerca = (nuestro: number, delDoc: number | null) =>
    delDoc != null && Math.abs(nuestro - delDoc) <= 0.02 ? r2(delDoc) : nuestro;
  const grav = cerca(Number(tot.sumas_sin_iva), gravDoc);
  const iva = Number(tot.iva) === 0 ? 0 : cerca(Number(tot.iva), ivaDoc);
  const perc = Number(tot.total_percepcion) === 0 ? 0 : cerca(Number(tot.total_percepcion), percDoc);
  return {
    ...tot,
    sumas_sin_iva: r4(grav).toFixed(4),
    subtotal: r4(grav + iva).toFixed(4),
    iva: r4(iva).toFixed(4),
    total_percepcion: r2(perc).toFixed(2),
    total: totalDoc.toFixed(2),
  };
}

/**
 * El tamaño de la caja cuando el proveedor lo escribe en la descripción:
 * «Barrita Fresa Sarita|7401090800083|25.000 |Caja» (Sarita) o
 * «PALETA FROZEN MIXTA CJA 25 UND» (Nevería). Sólo esas dos formas: un número
 * suelto en el nombre suele ser gramos o mililitros.
 */
export function factorEnLaDescripcion(t: string): number | null {
  // «FARDO AGUA $0.9166 DE 25 UNIDADES 500 ml» (Agua Fría): un empaque
  // nombrado y «de/x/con N unidades». Sin la palabra del empaque no cuenta:
  // «X 30 TABLETAS» es lo que trae el producto, no cuántos vienen.
  const empaque = /\b(FARDO|CAJA|CJA|PAQUETE|PAQ|DISPLAY|BULTO|SIXPACK)\b/i.test(t)
    ? /\b(?:DE|X|CON)\s*(\d+)\s*(?:UNIDADES|UNIDAD|UNDS|UND|U)\b/i.exec(t) : null;
  const m = /\|\s*(\d+)(?:\.0+)?\s*\|\s*caja\b/i.exec(t) ?? /\bCJA\.?\s*(?:X\s*)?(\d+)\s*(?:U|UND|UNDS|UNIDADES)\b/i.exec(t) ?? empaque;
  const n = m ? Number(m[1]) : NaN;
  return Number.isInteger(n) && n >= 2 && n <= 500 ? n : null;
}

/**
 * Un tamaño que el documento sugiere pero no afirma: «DISP. X 50 TAB.»
 * (MONTREAL, GRIPE-MED, 2026-11-05). «X 50 TAB» puede ser lo que trae el
 * producto o cuántos trae el display, así que `elegirFactor` sólo lo acepta si
 * el producto ya tiene una presentación de ese tamaño. A $10.91 contra $0.19 la
 * unidad, el precio solo daba 57 —el costo subió 15 %— y la caja es de 50.
 */
/** Los tamaños que nombra la descripción («X 30 TAB», «X50»): sólo pistas. */
export function tamanosEnLaDescripcion(t: string): number[] {
  return [...String(t ?? "").matchAll(/\bX\s*(\d{1,3})\b/gi)].map((m) => Number(m[1])).filter((n) => n >= 2 && n <= 500);
}

/**
 * ¿La descripción nombra un empaque («CAJA X 100 CAPS», «CJA X 30»)? Con eso,
 * el «X N» que la acompaña deja de ser una pista y pasa a ser lo que el papel
 * dice — siempre que el catálogo ya venda ese tamaño (`elegirFactor`).
 */
export function empaqueEnLaDescripcion(t: string): boolean {
  return /\b(CAJA|CAJ|CJA|CJ|DISPLAY|DISP|PAQUETE|PAQ|FARDO|BULTO)\b/i.test(String(t ?? ""));
}

/**
 * ¿La descripción habla de UN envase y nada más? «MEBEZOL SUSPENSION FCO X 30
 * ML»: el frasco es la unidad y el «X 30» son mililitros. Si nombra cuántas
 * piezas trae («FCO X 100 TAB») o un empaque («CAJA»), no lo es: ahí el
 * tamaño sí puede ser más de 1.
 */
export function envaseUnitarioEnLaDescripcion(t: string): boolean {
  const s = String(t ?? "");
  if (!/\b(FCO|FRASCO|TUBO|BOTE|BOTELLA|GOTERO|SPRAY|LATA)\b/i.test(s)) return false;
  if (empaqueEnLaDescripcion(s)) return false;
  return !/\bX\s*\d+\s*(TAB|TABS|TABL|TABLETAS?|CAP|CAPS|CAPSULAS?|COMP|COMPRIMIDOS?|GRAG|GRAGEAS?|SOBRES?|AMP|AMPOLLAS?|UND|UNDS|UNIDADES|U|PZ|PIEZAS?|PERLAS?)\b/i.test(s);
}

/**
 * Cuántas piezas dice la factura que trae su caja, para compararlo con las
 * presentaciones del catálogo (2026-11-06): «CAJA X 100 CAPS» → 100. Sólo con
 * un empaque nombrado y UN tamaño que no sea una medida («X 120 ML» no cuenta).
 * Con dos tamaños o ninguno, null: la pantalla no adivina.
 */
export function tamanoDeCajaEnLaDescripcion(t: string): number | null {
  const s = String(t ?? "");
  const doc = factorEnLaDescripcion(s) ?? factorDebilEnLaDescripcion(s);
  if (doc) return doc;
  if (!empaqueEnLaDescripcion(s)) return null;
  const n = [...new Set([...s.matchAll(/\bX\s*(\d{1,3})\b(?!\s*(?:\.\d|ML|CC|L|LT|LTS|G|GR|GRS|GRAMOS|MG|MCG|KG|OZ|%|UI)\b)/gi)]
    .map((m) => Number(m[1])).filter((x) => x >= 2 && x <= 500))];
  return n.length === 1 ? n[0] : null;
}

export function factorDebilEnLaDescripcion(t: string): number | null {
  const m = /\bDISP(?:LAY)?\.?\s*(?:X|DE|CON)\s*(\d+)\b/i.exec(String(t ?? ""));
  const n = m ? Number(m[1]) : NaN;
  return Number.isInteger(n) && n >= 2 && n <= 500 ? n : null;
}

/**
 * Cuántas unidades trae cada una que factura el proveedor, con el PRECIO como
 * juez (2026-11-05).
 *
 * BRANDSTAR factura «CAJA MELOFLEX RELAX 15 MG X 10 COMP» × 15 a $4.90 neto,
 * y la unidad cuesta $0.49 en el catálogo: son 15 cajas de 10. Pero el
 * diccionario tenía «aprendido» factor 1 —de agosto, cuando todavía no se
 * guardaba el factor y todo quedaba en 1— y lo aprendido le ganaba al costo,
 * así que proponía 15 unidades. Lo mismo ANARA: aprendió 237 (474 ÷ 2, a mano)
 * cuando el precio dice 200.
 *
 * Orden: lo que dice el documento; después lo aprendido, SÓLO si el precio no
 * lo contradice; después el precio. El precio que se compara es NETO: con el
 * descuento del renglón (BRANDSTAR da 17–21 %) y el del pie de factura.
 * Dentro de la tolerancia gana una presentación que exista en el catálogo.
 */
export function elegirFactor(x: {
  delDoc: number | null; aprendido: number | null; costoNeto: number;
  costoUnidad: number | null | undefined; presentaciones: number[];
  debil?: number | null; pistas?: number[]; vinetaUno?: number | null; empaque?: boolean; unitario?: boolean;
}): { factor: number; origen: "documento" | "aprendido" | "costo" | null; corrige?: number } {
  if (x.delDoc) return { factor: x.delDoc, origen: "documento" };
  // Lo que el papel dice a medias («DISP. X 50 TAB.») sólo vale si el catálogo
  // ya vende ese tamaño: así no se confunde con lo que trae el producto.
  if (x.debil && x.presentaciones.includes(x.debil)) return { factor: x.debil, origen: "documento" };
  // «MEBEZOL SUSPENSION FCO X 30 ML» × 6 a $1.72 neto contra $0.837 en el
  // catálogo (2026-11-06): el precio daba 2 y entraban 12 frascos. Un envase
  // suelto es UNA unidad cuando el catálogo vende la de 1; el alza la avisa la
  // revisión de costos. Le gana también a lo aprendido, como el documento.
  if (x.unitario && x.presentaciones.includes(1)) return { factor: 1, origen: "documento" };
  const cu = Number(x.costoUnidad);
  const razon = cu > 0 && x.costoNeto > 0 ? x.costoNeto / cu : null;
  // «RINOKEM PLUS CAJA X 100 CAPS» a $8.90 con la cápsula a $0.0637 en el
  // catálogo (2026-11-06): el precio daba 140 —el costo subió 40 %— y entraban
  // 280 en vez de 200. Si la descripción nombra el empaque y un tamaño que el
  // catálogo ya vende, es ése: un aumento de precio no cambia la caja, y el
  // alza la avisa la revisión de costos. Sólo un precio que lo contradice de
  // plano (menos de la mitad o más del doble) lo descarta.
  if (x.empaque) {
    const nombrados = [...new Set((x.pistas ?? []).filter((f) => f >= 2 && x.presentaciones.includes(f)))];
    if (nombrados.length === 1 && (razon == null || (razon / nombrados[0] >= 0.5 && razon / nombrados[0] <= 2))) {
      return { factor: nombrados[0], origen: "documento" };
    }
  }
  const cuadra = (f: number) => razon != null && Math.abs(razon / f - 1) <= 0.08;
  let porCosto: number | null = null;
  if (razon != null) {
    porCosto = x.presentaciones.filter((f) => f >= 2 && cuadra(f)).sort((a, b) => Math.abs(razon / a - 1) - Math.abs(razon / b - 1))[0] ?? null;
    // Antes de redondear a un número que nadie vende: si la descripción nombra
    // un tamaño («X 30 TAB») que el catálogo vende y el precio queda a ±25 %,
    // es ése — el costo subió, no cambió la caja. NOR-CLAMIDA X 30 salía ×33
    // (+10 %) y sin presentación de 1 no se podía cargar (2026-11-05).
    if (!porCosto) {
      porCosto = (x.pistas ?? []).filter((f) => f >= 2 && x.presentaciones.includes(f) && Math.abs(razon / f - 1) <= 0.25)
        .sort((a, b) => Math.abs(razon / a - 1) - Math.abs(razon / b - 1))[0] ?? null;
    }
    // Y aunque el catálogo no venda ese tamaño, el que nombra la factura le
    // gana a un redondeo cercano: «ATROLIP … X 28 TABL» da 26 por precio.
    if (!porCosto) {
      porCosto = (x.pistas ?? []).filter((f) => f >= 2 && Math.abs(razon / f - 1) <= 0.12)
        .sort((a, b) => Math.abs(razon / a - 1) - Math.abs(razon / b - 1))[0] ?? null;
    }
    if (!porCosto) { const n = Math.round(razon); if (n >= 2 && cuadra(n)) porCosto = n; }
    // Un tamaño que el catálogo NO vende entra en la presentación de 1. Si con
    // él cada unidad costaría menos de un quinto de lo que se vende esa
    // presentación, la de 1 no es una unidad suelta: es la caja entera.
    // NOR-CLAMIDA (2026-11-05): su «CAJA» de 1 quedó con costo de tableta
    // ($0.087) y el precio pedía 30 — habrían entrado 30 cajas a $0.096.
    const v1 = Number(x.vinetaUno);
    if (porCosto && !x.presentaciones.includes(porCosto) && v1 > 0 && v1 / (x.costoNeto / porCosto) > 5) porCosto = null;
  }
  if (x.aprendido && (razon == null || cuadra(x.aprendido) || !porCosto)) return { factor: x.aprendido, origen: "aprendido" };
  if (porCosto) return x.aprendido ? { factor: porCosto, origen: "costo", corrige: x.aprendido } : { factor: porCosto, origen: "costo" };
  return { factor: 1, origen: null };
}

/**
 * ¿El renglón es un flete o un servicio y no mercadería? Sólo SUGIERE: la
 * pantalla lo marca y la persona lo puede deshacer. Medido en la cola del
 * 2026-11-05: «FLETE», «Flete», «PAGO DE 50% DE FLETE AEROFLASH»,
 * «NA|SERVICIO DE TRANSPORTE».
 */
export function esFleteOServicio(descripcion: string): boolean {
  return /\b(fletes?|transporte|acarreo|encomienda|env[ií]o)\b/i.test(String(descripcion ?? ""));
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
  /** El costo de esa misma presentación (para sugerir el precio con su margen). */
  costo?: number | null;
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
  let costo: number | null = null;
  const tabla = /id=["']presentacion_table["'][^>]*>([\s\S]*?)<\/tbody>/.exec(html)?.[1] ?? "";
  const celda = (fila: string, clase: string) => {
    const m = new RegExp(`<td[^>]*class=['"][^'"]*\\b${clase}\\b[^'"]*['"][^>]*>([^<]*)<`).exec(fila);
    return m ? Number(m[1].trim()) : NaN;
  };
  for (const fila of tabla.split(/<tr/i).slice(1)) {
    if (/fa-eye-slash/.test(fila)) continue;
    if (celda(fila, "unidad_p") !== 1) continue;
    const p7 = [0, 1, 2, 3, 4, 5, 6].map((k) => celda(fila, `precio${k}`));
    if (p7.every((x) => Number.isFinite(x))) {
      precios = p7;
      const c = celda(fila, "costo");
      costo = Number.isFinite(c) ? c : null;
      break;
    }
  }
  return {
    id, nombre: valorDe(html, "descripcion"),
    categoria: seleccionado(html, "id_categoria"),
    laboratorio: seleccionado(html, "id_laboratorio"),
    proveedor: seleccionado(html, "proveedor"),
    perecedero: marcado(html, "perecedero"), exento: marcado(html, "exento"),
    decimal: marcado(html, "decimal"), regulado: marcado(html, "regulado"),
    antibiotico: marcado(html, "antibiotico"),
    marca: valorDe(html, "marca"), precios, costo,
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

/**
 * Qué revisar cuando el total armado no cuadra con el de la factura (Bodega,
 * 2026-11-05: «que dé más info de qué puede ser»). Compara pieza por pieza
 * —gravado, exento, IVA, percepción, otros impuestos, cada renglón— y sólo
 * nombra las que explican la diferencia. Lo que no se pueda atribuir lo dice
 * como tal en vez de inventar una causa.
 *
 * `diferencia` = total armado − total de la factura.
 */
export function pistasDeDiferencia(x: {
  diferencia: number;
  carga: { gravada: number; exenta: number; iva: number; percepcion: number };
  resumen: any;
  tasaPercepcion: number;
  tipoDoc: "CCF" | "COF" | "FSE";
  renglones: { renglon: number; descripcion: string; armado: number; cobrado: number }[];
  hayRegalos: boolean;
}): string[] {
  const $ = (n: number) => `$${Math.abs(n).toFixed(2)}`;
  const num = (v: unknown) => (v == null || v === "" || !Number.isFinite(Number(v)) ? 0 : Number(v));
  const cerca = (a: number, b: number, tol = 0.03) => Math.abs(a - b) <= tol;
  const res = x.resumen ?? {};
  const d = x.diferencia;
  const pistas: string[] = [];
  const tributos: any[] = Array.isArray(res.tributos) ? res.tributos : [];

  // 1. Renglón por renglón (sin IVA). Con regalos no sirve: el reparto mueve
  //    costo de los pagados a los de $0 a propósito y todos «diferirían».
  if (!x.hayRegalos) {
    for (const r of x.renglones) {
      const dif = r2(r.armado - r.cobrado);
      if (Math.abs(dif) > 0.05) {
        pistas.push(`Renglón ${r.renglon + 1} «${r.descripcion.slice(0, 60)}»: la factura lo cobra ${$(r.cobrado)} y se carga como ${$(r.armado)} (${dif > 0 ? "sobran" : "faltan"} ${$(dif)}). Revisa «Se carga como», la cantidad y si trae descuento.`);
      }
    }
  }

  // 2. Gravado y exento: un renglón marcado al revés cambia el IVA.
  const gravDoc = num(res.totalGravada) - num(res.descuGravada);
  const exeDoc = num(res.totalExenta) + num(res.totalNoSuj) - num(res.descuExenta) - num(res.descuNoSuj);
  if (!cerca(gravDoc, x.carga.gravada, 0.05) && !cerca(exeDoc, x.carga.exenta, 0.05) && cerca(gravDoc + exeDoc, x.carga.gravada + x.carga.exenta, 0.10)) {
    pistas.push(`Gravado y exento están cruzados: la factura dice gravado ${$(gravDoc)} y exento ${$(exeDoc)}; la carga, ${$(x.carga.gravada)} y ${$(x.carga.exenta)}. Algún producto está marcado exento (o gravado) distinto a como lo factura el proveedor.`);
  }

  // 3. IVA.
  const ivaDoc = tributos.filter((t) => String(t?.codigo) === "20").reduce((a, t) => a + num(t?.valor), 0) || num(res.totalIva);
  if (ivaDoc > 0 && x.tipoDoc !== "CCF") {
    pistas.push(`La factura trae IVA (${$(ivaDoc)}) pero se está cargando como ${x.tipoDoc}, que no lo suma.`);
  } else if (x.tipoDoc === "CCF" && !cerca(ivaDoc, x.carga.iva, 0.05) && ivaDoc > 0) {
    pistas.push(`IVA: la factura dice ${$(ivaDoc)} y la carga calcula ${$(x.carga.iva)} (13 % de lo gravado).`);
  }

  // 4. Percepción: la diferencia más común, y no se ve en los renglones.
  const percDoc = num(res.ivaPerci1);
  const sinPercepcion = cerca(Math.abs(d), x.carga.percepcion) && x.carga.percepcion > 0;
  const percDe1 = r2(x.carga.gravada * 0.01);
  if (!cerca(percDoc, x.carga.percepcion) && (percDoc > 0 || x.carga.percepcion > 0)) {
    pistas.push(`Percepción: la factura trae ${$(percDoc)} y la carga calcula ${$(x.carga.percepcion)}${x.tasaPercepcion ? ` (${(x.tasaPercepcion * 100).toFixed(0)} % del proveedor)` : " (el proveedor está sin percepción)"}. Revisa si el proveedor es agente de percepción en su ficha.`);
  } else if (!sinPercepcion && x.carga.percepcion === 0 && d < 0 && cerca(-d, percDe1) && x.carga.gravada >= 100) {
    pistas.push(`La diferencia (${$(d)}) es el 1 % de lo gravado: parece una percepción que la factura cobra y el proveedor no tiene en su ficha.`);
  }

  // 5. Impuestos que la carga no suma (FOVIAL, COTRANS, turismo…).
  const otros = tributos.filter((t) => String(t?.codigo) !== "20" && num(t?.valor) > 0);
  if (otros.length) {
    const suma = otros.reduce((a, t) => a + num(t.valor), 0);
    pistas.push(`La factura trae otros impuestos que la carga no suma: ${otros.map((t) => `${String(t.descripcion ?? t.codigo).trim()} ${$(num(t.valor))}`).join(", ")}${cerca(-d, suma) ? " — y son exactamente la diferencia" : ""}.`);
  }

  // 6. Coincide con un renglón entero: falta, sobra o está repetido.
  for (const r of x.renglones) {
    const conIva = r2(r.cobrado * (x.tipoDoc === "CCF" ? 1.13 : 1));
    if (r.cobrado > 0.5 && (cerca(Math.abs(d), r.cobrado) || cerca(Math.abs(d), conIva))) {
      pistas.push(`La diferencia es lo que vale el renglón ${r.renglon + 1} «${r.descripcion.slice(0, 60)}»: revisa que no esté de más o que no falte.`);
      break;
    }
  }

  // 7. Centavos: el costo por unidad viaja con 4 decimales.
  if (!pistas.length && Math.abs(d) <= 0.5) {
    pistas.push(`Son ${$(d)}: parece redondeo del costo por unidad (va con 4 decimales). Revisa el renglón con más unidades o el que se partió en presentaciones.`);
  }
  if (!pistas.length) {
    pistas.push(`No se encontró una causa en los totales ni en los renglones. Compara la factura (vista «Documento») con «Totales» de abajo, pieza por pieza.`);
  }
  return pistas;
}
