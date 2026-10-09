// «¿A quién se le cobró la aplicación?» — las cuentas de la pestaña Por cobrar
// de Inyecciones, escritas UNA vez para el portal (`TabPorCobrar`) y la app.
// La base cruza venta y cobro (`get_inyecciones_aplicadas`); acá sólo se
// resume, se filtra y se arma el CSV.
import { hoySV } from './fecha';
import { shortEmployeeName } from './nameUtils';
import { hora12 } from './hora';
import { smartFilter } from './searchUtils';

// Desde este día la aplicación se anota en el portal, con hora y persona. Antes
// se escribía directo en la caja y no hay con qué emparejarla.
export const DESDE_EL_PORTAL = '2026-09-03';

export const ESTADOS_DE_COBRO = [
    { value: 'todas', label: 'Todas' },
    { value: 'con', label: 'Con cobro' },
    { value: 'sin', label: 'Sin cobro' },
];

/* El período por defecto arranca el día en que la aplicación empezó a anotarse
 * en el portal, y no el 1.º del mes: antes de eso toda venta sale «sin cobro»
 * y el resumen mentiría. Cuando esa fecha quede a más de tres meses —el tope
 * de la función— se vuelve al mes en curso. Devuelve `desde|hasta`. */
export function rangoPorDefecto(hoy = hoySV()) {
    const [y, m] = hoy.split('-').map(Number);
    const limite = new Date(Date.UTC(y, m - 1, Number(hoy.slice(8)) - 90)).toISOString().slice(0, 10);
    const desde = DESDE_EL_PORTAL >= limite ? DESDE_EL_PORTAL : `${hoy.slice(0, 7)}-01`;
    return `${desde}|${hoy}`;
}

export const nombreDeCobro = (n) => (n ? shortEmployeeName(n) : '—');
export const productosTexto = (v) => (v.productos || []).map((p) => p.descripcion).join(' · ');

/** Las cuatro cifras de arriba. */
export function resumenPorCobrar(datos) {
    const ventas = datos?.ventas || [];
    const sueltos = datos?.cobros_sin_venta || [];
    const con = ventas.filter((v) => v.cobro).length;
    return {
        ventas: ventas.length,
        con,
        sin: ventas.length - con,
        pct: ventas.length ? (con / ventas.length) * 100 : 0,
        sueltos: sueltos.length,
        montoSueltos: sueltos.reduce((s, c) => s + Number(c.monto || 0), 0),
    };
}

/** Por vendedor: quién vende inyecciones y a cuántas les cobra la aplicación. */
export function porVendedorDeInyecciones(ventas) {
    const m = new Map();
    for (const v of ventas || []) {
        const k = v.cod_vendedor || '—';
        const a = m.get(k) || { cod: k, id: v.vendedor_id, nombre: v.vendedor_nombre, ventas: 0, con: 0 };
        a.ventas += 1;
        if (v.cobro) a.con += 1;
        m.set(k, a);
    }
    return [...m.values()].sort((a, b) => b.ventas - a.ventas);
}

/** La lista con el filtro de cobro y la búsqueda (cliente, factura, vendedor, inyección). */
export function filtrarVentasDeInyeccion(ventas, estado, buscar) {
    let r = ventas || [];
    if (estado === 'con') r = r.filter((v) => v.cobro);
    if (estado === 'sin') r = r.filter((v) => !v.cobro);
    if (buscar?.trim()) {
        r = smartFilter(buscar, r, (v) => [v.correlativo, v.cliente, v.vendedor_nombre, productosTexto(v)]).results;
    }
    return r;
}

export const CABECERA_CSV_POR_COBRAR = ['FECHA', 'HORA', 'SUCURSAL', 'FACTURA', 'CLIENTE', 'PRODUCTOS', 'UNIDADES', 'TOTAL',
    'VENDEDOR', 'APLICACION COBRADA', 'HORA DEL COBRO', 'MONTO DEL COBRO', 'COBRO REGISTRADO POR'];

export function filasCsvPorCobrar(ventas, nombreSala) {
    return (ventas || []).map((v) => [
        v.fecha, hora12(v.hora), nombreSala(v.branch_id), v.correlativo, v.cliente, productosTexto(v),
        v.unidades, v.total, nombreDeCobro(v.vendedor_nombre),
        v.cobro ? 'SI' : 'NO', hora12(v.cobro?.hora), v.cobro?.monto ?? '',
        v.cobro ? nombreDeCobro(v.cobro.registrado_nombre) : '',
    ]);
}

/** Para asignar un cobro suelto: las ventas del día del cobro primero (es casi siempre ahí). */
export function ordenarParaVincular(ventas, fechaDelCobro) {
    return [...(ventas || [])].sort((a, b) => Number(b.fecha === fechaDelCobro) - Number(a.fecha === fechaDelCobro));
}
