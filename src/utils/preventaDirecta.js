// ═══════════════════════════════════════════════════════════════════════════
// La vista Preventa (2026-11-16): lo que la pantalla calcula sin preguntarle a
// nadie. El precio NO se calcula acá: lo decide la base (`preventa_cotizar`)
// según el cliente, y la base lo vuelve a calcular antes de mandar a caja.
// ═══════════════════════════════════════════════════════════════════════════

/** El nombre de cada lista de precio (las claves son columnas de `product_precios`). */
export const NOMBRE_DE_LISTA = {
    vineta: 'Regular',
    descuento_1: 'Público',
    vip: 'Preferente',
    clinica: 'Mayoreo',
    mayoreo: 'Mayoreo Plus',
};

/** Las listas que se pueden autorizar a mano, de la más alta a la más baja. */
export const LISTAS_AUTORIZABLES = ['descuento_1', 'vip', 'clinica', 'mayoreo']
    .map((key) => ({ value: key, label: NOMBRE_DE_LISTA[key] }));

export const nombreDeLista = (k) => NOMBRE_DE_LISTA[k] ?? 'Regular';

/** Por qué le toca esa lista al cliente, en una frase corta. */
export function porQueEsaLista(lista, generico) {
    if (generico) return 'Cliente frecuente o sin datos: precio Público.';
    if (lista === 'mayoreo') return 'Mayoreo Plus: mayorista Plus o empleado.';
    if (lista === 'clinica') return 'Cliente mayorista: precio Mayoreo.';
    return 'Cliente con datos: precio Preferente.';
}

export const MAX_PRODUCTOS = 30;

/** Un producto nuevo en la venta: 1 de la presentación más chica, salvo que se diga otra. */
export function lineaNueva(producto, factor = 1) {
    return { producto_id: Number(producto.id), nombre: producto.nombre ?? '', factor: Number(factor) || 1, cantidad: 1, lista: null };
}

/** Lo que viaja a la base: sólo producto, presentación, cantidad y la lista autorizada. */
export const lineasParaCotizar = (lineas) => (lineas ?? []).map((l) => ({
    producto_id: l.producto_id, factor: l.factor, cantidad: Number(l.cantidad) || 0,
    ...(l.lista ? { lista: l.lista } : {}),
}));

/** Agrega un producto; si ya está en esa presentación, le suma 1. */
export function agregarLinea(lineas, producto, factor = 1) {
    const i = lineas.findIndex((l) => l.producto_id === Number(producto.id) && l.factor === (Number(factor) || 1));
    if (i >= 0) return lineas.map((l, j) => (j === i ? { ...l, cantidad: Math.min(999, (Number(l.cantidad) || 0) + 1) } : l));
    if (lineas.length >= MAX_PRODUCTOS) return lineas;
    return [...lineas, lineaNueva(producto, factor)];
}

const centavos = (v) => Math.round(Number(v || 0) * 100) / 100;

/** Los totales de una cotización: lo que cobra, lo que costaría a precio Regular y lo que se ahorra. */
export function totalesDe(cotizacion) {
    const filas = cotizacion?.lineas ?? [];
    const total = centavos(filas.reduce((t, l) => t + Number(l.subtotal || 0), 0));
    const regular = centavos(filas.reduce((t, l) => t + Number(l.precio_regular || 0) * Number(l.cantidad || 0), 0));
    return {
        total, regular, ahorro: centavos(Math.max(0, regular - total)),
        productos: filas.length,
        unidades: filas.reduce((t, l) => t + Number(l.cantidad || 0) * Number(l.factor || 1), 0),
        conError: filas.filter((l) => l.error).length,
    };
}

/**
 * Lo que falta para poder mandar, UNO y en orden, con el campo donde se
 * arregla. null = se puede mandar. La base lo vuelve a revisar todo.
 */
export function faltaParaEnviar({ lineas, cotizacion, cotizando, documento, motivoPrecio }) {
    if (!(lineas ?? []).length) return { texto: 'Agrega al menos un producto.', campo: 'buscarProducto' };
    if (cotizando || !cotizacion) return { texto: 'Revisando precios y existencia…', campo: null };
    const mala = (cotizacion.lineas ?? []).find((l) => l.error);
    if (mala) return { texto: `${mala.nombre ?? 'Un producto'}: ${mala.error}`, campo: `linea-${mala.producto_id}-${mala.factor}` };
    if (documento === 'credito_fiscal' && !cotizacion.cliente?.nrc)
        return { texto: 'El crédito fiscal necesita un cliente con NRC.', campo: 'cliente' };
    if (lineas.some((l) => l.lista) && String(motivoPrecio ?? '').trim().length < 4)
        return { texto: 'Escribe por qué va otro precio.', campo: 'motivoPrecio' };
    return null;
}

/** El estado de una preventa en la lista, como se lee en la sucursal. */
export function estadoDePreventa(p) {
    switch (p?.estado) {
        case 'viva': return { texto: 'En caja', tono: 'info' };
        case 'facturada': return { texto: 'Facturada', tono: 'success' };
        case 'enviando': return { texto: 'Enviando…', tono: 'neutral' };
        case 'fallida': return { texto: 'No llegó a caja', tono: 'danger' };
        case 'sin_enlace': return { texto: 'En caja sin número', tono: 'warning' };
        case 'descartada': return { texto: 'Anulada', tono: 'neutral' };
        default: return { texto: p?.estado ?? '—', tono: 'neutral' };
    }
}

/** ¿Se puede corregir o anular? Sólo mientras está en caja sin facturar (o si no llegó). */
export const sePuedeCorregir = (p) => p?.estado === 'viva';
export const sePuedeAnular = (p) => ['viva', 'fallida', 'sin_enlace'].includes(p?.estado);

/** De una preventa guardada a las líneas del editor, para corregirla o repetirla. */
export function lineasDeVenta(venta) {
    return (venta?.renglones ?? []).map((r) => ({
        producto_id: Number(r.producto_id), nombre: String(r.nombre ?? ''),
        factor: Number(r.factor) || 1, cantidad: Number(r.cantidad) || 1, lista: null,
    }));
}
