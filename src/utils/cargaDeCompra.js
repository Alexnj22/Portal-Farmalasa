// Las reglas puras de «Cargar compra» (2026-11-19): cómo se arma lo que la
// persona ajusta en cada renglón, qué viaja al revisar y al cargar, y los
// avisos que salen de la revisión. Vivían dentro de la vista del portal
// (`PropuestaDeCompra.jsx`, `CargarCompraView.jsx`); acá las leen la vista y la
// app del personal, así las dos mandan EXACTAMENTE lo mismo.
//
// Nada de esto lee ni escribe: son cuentas sobre la propuesta (`fetchPropuesta`)
// y la revisión (`simularCarga`).
import { calcMargin, marginLabel } from './preciosDeProducto';

// Lo que la persona ajustó en un renglón: unidades por cada una del proveedor,
// lote y vencimiento. Arranca con lo que trae la propuesta.
export const ajusteInicial = (r) => ({
    factor: String(r.factor_proveedor ?? 1),
    lote: r.lote ?? '',
    vence: r.vence ? r.vence.slice(0, 7) : '',
    venta: '',   // viñeta nueva leída en la caja; vacío = la que ya tiene Bodega
    llegaron: '', // «Llegaron menos»: vacío = llegó todo
    // Flete / servicio: entra en la misma compra como servicio, sin producto
    // ni inventario. Viene marcado si la descripción lo dice o ya se apartó.
    servicio: r.servicio_sugerido === true,
});

// El borrador vuelve, pero NO le gana a la propuesta en lo que la persona no
// tocó (2026-11-05). BRANDSTAR se abrió cuando el lector todavía no entendía
// «FECHA VENC.» y el precio no corregía la caja: el borrador guardó vence
// vacío y factor 1, y después del arreglo la pantalla los seguía restaurando.
// Vacío en el borrador = no se escribió nada → manda lo leído ahora. El factor
// sólo lo cambia «Cantidad a cargar» (que deja `cargar`): sin `cargar`, nadie
// lo tocó.
export const conBorrador = (inicial, guardado) => {
    if (!guardado) return inicial;
    const r = { ...inicial, ...guardado };
    if (!guardado.lote) r.lote = inicial.lote;
    if (!guardado.vence) r.vence = inicial.vence;
    if (guardado.cargar == null) r.factor = inicial.factor;
    if (guardado.servicio == null) r.servicio = inicial.servicio;
    return r;
};

// La viñeta que tiene hoy Bodega para la presentación con que entraría: la de
// la revisión si ya se revisó, si no la de la propuesta (misma regla que el
// servidor: la presentación del tamaño del factor, si no la de 1).
export const vinetaActual = (r, aj, sim, lista) => {
    if (sim?.venta_anterior > 0) return Number(sim.venta_anterior);
    const f = Number(aj?.factor) || 1;
    const l = lista ?? r.vinetas ?? [];
    const v = (l.find(x => x.factor === f) ?? l.find(x => x.factor === 1))?.vineta;
    return Number(v) > 0 ? Number(v) : null;
};

// Las presentaciones del catálogo, sin la copia de factor 0, de menor a mayor.
export const presDelCatalogo = (lista) => [...new Map((lista ?? []).filter(x => Number(x.factor) > 0).map(x => [Number(x.factor), x])).values()]
    .sort((a, b) => a.factor - b.factor);
export const nombrePres = (x) => `${x.nombre ?? (x.factor > 1 ? 'CAJA' : 'UNIDAD')} (${x.factor})`;

// El nombre del producto con el tamaño nuevo, si lo nombra una sola vez
// («RINOKEM PLUS X 100 CAPSULAS» → «… X 120 CAPSULAS»). Una medida no cuenta.
const MEDIDA = String.raw`(?!\s*(?:[.,]\d|%|(?:ML|CC|L|LT|LTS|G|GR|GRS|MG|MCG|KG|OZ|UI)\b))`;
export const nombreConTamano = (nombre, tam) => {
    const re = new RegExp(String.raw`\bX\s*(\d{1,3})\b` + MEDIDA, 'gi');
    const m = [...String(nombre ?? '').matchAll(re)];
    if (m.length !== 1 || Number(m[0][1]) === tam) return null;
    return String(nombre).replace(m[0][0], `X ${tam}`).replace(/\s+/g, ' ').trim();
};

// ¿Este tamaño se puede aprender sin preguntar? Si Bodega vende esa
// presentación, o si es lo que dice la factura. Si no —140 en RINOKEM, 2 en
// MEBEZOL (2026-11-06)—, una confirmación de pasada no lo vuelve regla.
export const tamanoAprendible = (factor, lista, r) => {
    const f = Number(factor);
    if (!(f > 1)) return true;
    return presDelCatalogo(lista).some(x => x.factor === f) || f === Number(r?.tamano_factura);
};

// Al múltiplo de 5 centavos de arriba: así se ponen las viñetas.
export const subirA5 = (n) => Math.ceil(Math.round(n * 100) / 5) * 5 / 100;

// Las unidades que entran con un factor dado, y la línea de ayuda debajo del
// campo: de dónde salió y cómo se reparte en lo que factura el proveedor.
export const cargarDe = (r, factor) => {
    const n = Number(r.cantidad) * Number(factor || 1);
    return Number.isFinite(n) ? String(Math.round(n * 1000) / 1000) : '';
};
export const cargarAyuda = (r, aj) => {
    const cant = Number(r.cantidad), f = Number(aj.factor);
    if (!(f > 0)) return 'Escribe cuántas unidades entran en total.';
    if (!Number.isInteger(Math.round(f * 1000) / 1000)) {
        const abajo = Math.floor(f) * cant, arriba = Math.ceil(f) * cant;
        return `${aj.cargar ?? cargarDe(r, f)} no se reparte entre las ${cant} de la factura (saldrían ${Math.round(f * 100) / 100} por cada una). `
            + `Tiene que ser múltiplo de ${cant}: ${abajo > 0 ? `${abajo} o ` : ''}${arriba}.`;
    }
    // Lo normal no se dice: con el rótulo denso la ayuda va al lado del título
    // y se cortaba («60 DE LA I»). Cómo entra lo dice la fila de abajo.
    return null;
};

/**
 * La persona escribe las UNIDADES que entran; lo que viaja es el factor
 * (unidades por cada una que factura el proveedor). Devuelve el ajuste nuevo.
 */
export const conCarga = (aj, r, valor) => {
    const limpio = String(valor).replace(/[^\d]/g, '');
    const n = Number(limpio), cant = Number(r.cantidad);
    return { ...aj, cargar: limpio, ...(n > 0 && cant > 0 ? { factor: String(n / cant) } : {}) };
};

// Producto nuevo desde un renglón: el nombre y el código de barras que trae la
// descripción de la factura.
export const nombreDelRenglon = (t) => String(t ?? '').split('|')[0].replace(/\s+/g, ' ').trim().toUpperCase();
export const barrasDelRenglon = (t) => /\b(\d{12,14})\b/.exec(String(t ?? ''))?.[1] ?? '';

/** Qué renglones trae el documento, para no aplicar un borrador a otros. */
export const huellaDe = (renglones) => (renglones ?? []).map(r => [r.codigo_proveedor, r.descripcion, r.cantidad].join('|')).join('\n');

/** La llave de un renglón: la del diccionario (código del proveedor, o `#`+nombre
 *  si no trae), o su posición si ni eso hay. */
export const claveDe = (r, i) => r.llave || r.codigo_proveedor || `@${i}`;

/** `{ branchId: '12' }` tecleado → `{ branchId: 12 }` sin vacíos, o null. */
export function aRepartir(reparto) {
    if (!reparto) return null;
    // `por`: cuántas unidades trae cada una de lo que se escribió (CAJA 20 →
    // 2 cajas son 40). Al servidor viaja siempre en unidades.
    const por = Number(reparto.por) || 1;
    const limpio = Object.fromEntries(Object.entries(reparto).filter(([b]) => b !== 'por')
        .map(([b, v]) => [b, Number(v) * por]).filter(([, n]) => n > 0));
    return Object.keys(limpio).length ? limpio : null;
}

/**
 * «A vencidos» (Bodega, 2026-11-05): el producto es el correcto, entra con su
 * nombre, y todas o algunas unidades pasan al área de vencidos de Bodega al
 * cargar. El motivo es obligatorio.
 */
export const MOTIVOS_VENCIDOS = [
    { value: 'devolucion', label: 'Se devuelve al proveedor' },
    { value: 'corto_vencimiento', label: 'Corto vencimiento' },
    { value: 'danado', label: 'Dañado' },
    { value: 'otro', label: 'Otro' },
];

/** Las unidades que entran de un renglón (lo escrito, o cantidad × factor). */
export const unidadesQueEntran = (r, aj) => Number(aj.cargar ?? cargarDe(r, aj.factor)) || 0;
/** Las que se pueden enviar o mandar a vencidos: las que llegaron, si faltó. */
export const unidadesQueLlegaron = (r, aj) => (aj.llegaron !== '' && aj.llegaron != null
    ? Math.min(Number(aj.llegaron), unidadesQueEntran(r, aj))
    : unidadesQueEntran(r, aj));

/**
 * La decisión de UN renglón tal como viaja a la revisión y al envío. Lo que se
 * revisa y lo que se manda es esta misma forma: la función se niega si cambió.
 * `productId`: el producto que se mandaría (nunca un parecido sin confirmar).
 */
export const decisionDeRenglon = (aj, productId) => ({
    product_id: aj?.servicio ? null : productId,
    servicio: aj?.servicio === true,
    factor: Number(aj?.factor) || 1,
    lote: aj?.lote || null,
    // El campo de mes emite el texto mientras no está completo: eso no viaja.
    vence: /^\d{4}-\d{2}$/.test(aj?.vence ?? '') ? aj.vence : null,
    venta: Number(aj?.venta) > 0 ? Number(aj.venta) : null,
    llegaron: aj?.llegaron !== '' && aj?.llegaron != null ? Number(aj.llegaron) : null,
    erroneo: aj?.erroneo === true,
    vencidos: aj?.vencidos ? {
        unidades: aj.vencidos.modo === 'algunas' ? (Number(aj.vencidos.unidades) || 0) : null,
        motivo: aj.vencidos.motivo || null,
        detalle: aj.vencidos.motivo === 'otro' ? (aj.vencidos.detalle || '').trim() : null,
    } : null,
    reparto: aRepartir(aj?.reparto),
});

/**
 * El producto que se mandaría por renglón: lo elegido en pantalla, o lo que
 * llegó por código de barras o por el diccionario. Un parecido NUNCA viaja sin
 * confirmar (acierta 91.5 %), ni un aprendido con concentración o tamaño
 * distinto (`numeros_distintos`).
 */
export const productoDelRenglon = (r, elegido) => elegido?.product_id
    ?? (['codigo_barras', 'aprendido'].includes(r.match_origen) && !r.numeros_distintos?.length ? r.producto_id : null);

/** Qué le falta a un renglón para quedar completo (el aviso de arriba). */
export const faltaDelRenglon = (r, aj, confirmado) => {
    if (aj?.servicio) return { sin_producto: false, a_confirmar: false, sin_lote: false, sin_vencimiento: false };
    return {
        sin_producto: !r.producto_id && !confirmado,
        a_confirmar: !!r.producto_id && !r.seguro && !confirmado,
        sin_lote: !aj?.lote,
        sin_vencimiento: !/^\d{4}-\d{2}$/.test(aj?.vence ?? ''),
    };
};

/**
 * El costo que trae ESTA factura contra el que tiene Bodega, y el margen con el
 * precio de venta. Sale de una fila de la revisión (`linea.compra` ya lleva el
 * descuento y el reparto de regalos). Null si la fila no es un producto.
 */
export function costoDeLaRevision(x) {
    if (!x?.linea || x.linea.bandera !== 'PRODUCTO') return null;
    const nuevo = Number(x.linea.compra), antes = x.costo_anterior, venta = Number(x.linea.venta);
    const cambio = antes ? (nuevo - antes) / antes * 100 : null;
    const margen = calcMargin(venta, nuevo);
    const ventaAntes = x.venta_anterior ?? null;
    // Si el costo sube y la viñeta no se movió: la que mantendría el margen que
    // tenía antes, para preguntar si la caja trae precio nuevo.
    const mAntes = ventaAntes > 0 && antes > 0 ? (ventaAntes - antes) / ventaAntes : null;
    const sugerida = cambio != null && cambio >= 0.5 && mAntes > 0 && mAntes < 0.9
        && Math.abs(venta - ventaAntes) < 0.005 ? subirA5(nuevo / (1 - mAntes)) : null;
    return {
        nuevo, antes, venta, cambio, margen, alerta: marginLabel(margen), ventaAntes,
        margenAntes: mAntes != null ? mAntes * 100 : null,
        sugerida: sugerida > ventaAntes ? sugerida : null,
    };
}

// Si el costo nuevo es un múltiplo entero (×2 o más) del de antes, lo más
// probable es que la caja del proveedor traiga otra cantidad de unidades:
// 50 «CAJA X 10» cargadas como 50 unidades dejan cada una 10 veces más cara.
export function cantidadSospechosa(sim, costo) {
    const antes = Number(costo?.antes), nuevo = Number(costo?.nuevo);
    if (!(antes > 0 && nuevo > 0)) return null;
    const sube = nuevo > antes;
    const razon = sube ? nuevo / antes : antes / nuevo;
    const veces = Math.round(razon);
    if (veces < 2 || Math.abs(razon - veces) / veces > 0.12) return null;
    const unidades = sube ? sim.existencias * veces : sim.existencias / veces;
    return Number.isInteger(unidades) && unidades > 0 ? { veces, sube, unidades } : null;
}

// Una nota de crédito del proveedor por el mismo total que la factura.
export const pareceAnulada = (f, pista) => !!pista?.nota_credito
    && Math.abs(Number(pista.nota_credito.total) - Number(f.monto_total)) <= 0.02;

/** El doc que abre la carga, armado desde la fila de una factura en papel. */
export const docDePapel = (m) => ({
    manual_id: m.id, emisor_nombre: m.proveedor_nombre, emisor_nit: m.proveedor_nit,
    fecha_emision: m.fecha_emision, monto_total: m.total,
});

/** La suma de una factura en papel, para compararla con el total del papel. En
 *  crédito fiscal el importe va sin IVA: se le suma el 13 % a lo gravado. */
export function sumaDeFacturaEnPapel(f) {
    const suma = (f.renglones ?? []).reduce((a, r) => {
        const m = Number(r.importe) || 0;
        return { gravado: a.gravado + (r.exento ? 0 : m), exento: a.exento + (r.exento ? m : 0) };
    }, { gravado: 0, exento: 0 });
    const estimado = Math.round(((f.tipo_doc === 'CCF' ? suma.gravado * 1.13 : suma.gravado) + suma.exento) * 100) / 100;
    const total = Number(f.total) || 0;
    return { estimado, total, descuadre: total > 0 && estimado > 0 && Math.abs(estimado - total) > 0.05 };
}
