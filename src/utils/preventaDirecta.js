// ═══════════════════════════════════════════════════════════════════════════
// La vista Preventa (2026-11-16): lo que la pantalla calcula sin preguntarle a
// nadie. El precio NO se calcula acá: lo decide la base (`preventa_cotizar`)
// según el cliente, y la base lo vuelve a calcular antes de mandar a caja.
// ═══════════════════════════════════════════════════════════════════════════

import { ETIQUETA_CAMPO, esContribuyente } from './clienteValidacion.js';

/** El nombre de cada lista de precio (las claves son columnas de `product_precios`). */
export const NOMBRE_DE_LISTA = {
    vineta: 'Regular',
    descuento_1: 'Público',
    vip: 'Preferente',
    clinica: 'Mayoreo',
    mayoreo: 'Mayoreo Plus',
};

/** Las listas, de la más alta a la más baja (el orden en que se ofrecen). */
export const ORDEN_DE_LISTAS = ['vineta', 'descuento_1', 'vip', 'clinica', 'mayoreo'];

/** Cómo paga el cliente. El crédito exige un cliente con datos. */
export const PAGOS = [
    { value: 'contado', label: 'Efectivo' },
    { value: 'tarjeta', label: 'Tarjeta' },
    { value: 'transferencia', label: 'Transfer.' },
    { value: 'credito', label: 'Crédito' },
    { value: 'cheque', label: 'Cheque' },
];

/** Lo que le falta a un cliente para emitirle crédito fiscal, como rótulos. */
export const CAMPOS_CCF = ['nit', 'nrc', 'giro', 'direccion'];
export function faltanParaCcf(cliente) {
    if (!cliente) return ['Cliente'];
    const faltan = CAMPOS_CCF.filter((c) => !String(cliente[c] ?? '').trim()).map((c) => ETIQUETA_CAMPO[c] ?? c);
    if (!esContribuyente(cliente.categoria)) faltan.unshift('Categoría contribuyente');
    return faltan;
}

/** Las listas con precio de una presentación, para elegir viendo el monto. */
export function opcionesDePrecio(precios) {
    return ORDEN_DE_LISTAS
        .filter((k) => Number(precios?.[k]) > 0)
        .map((k) => ({ lista: k, nombre: NOMBRE_DE_LISTA[k], precio: Number(precios[k]) }));
}

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
export function faltaParaEnviar({ lineas, cotizacion, cotizando, documento, pago }) {
    if (!(lineas ?? []).length) return { texto: 'Agrega al menos un producto.', campo: 'buscarProducto' };
    if (cotizando || !cotizacion) return { texto: 'Revisando precios y existencia…', campo: null };
    const mala = (cotizacion.lineas ?? []).find((l) => l.error);
    if (mala) return { texto: `${mala.nombre ?? 'Un producto'}: ${mala.error}`, campo: `linea-${mala.producto_id}-${mala.factor}` };
    if (documento === 'credito_fiscal') {
        const f = faltanParaCcf(cotizacion.cliente);
        if (f.length) return { texto: `Para crédito fiscal le falta al cliente: ${f.join(', ')}.`, campo: 'cliente' };
    }
    if (pago === 'credito' && (cotizacion.generico || !cotizacion.cliente))
        return { texto: 'El crédito necesita un cliente con sus datos.', campo: 'cliente' };
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
