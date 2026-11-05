/**
 * El lote que se copia de la caja cuando lo que sale de un traslado no tiene
 * lote asignado (2026-11-05). Se apoya en lo que ya hacen las inyecciones
 * (`cobroDeAplicacion.js`): una lista de lotes ya registrados del producto, y
 * un freno cuando lo escrito se parece a uno de ellos.
 *
 * Dos diferencias con las inyecciones, las dos por lo mismo —acá el lote se
 * ESCRIBE en el inventario, no se anota al margen—:
 *   1. Un lote ya registrado con OTRO vencimiento no se puede «confirmar como
 *      otro»: el sistema crearía un segundo lote con el mismo número. Sólo se
 *      puede usar el registrado.
 *   2. El vencimiento viaja con su DÍA. El sistema identifica un lote por
 *      número + fecha exacta; el 99.3% de las fechas son día 1 (medido el
 *      2026-11-05), pero si el registrado dice otro día, se usa ése.
 */
import { loteParecido, venceNormal } from './cobroDeAplicacion';
import { esLoteGenerico } from './unidadesInventario';
import { hoySV } from './fecha';

export const LOTE_DE_CAJA_VACIO = { lote: '', vence: '' };

/**
 * Filas de `inventory` (lote, fecha_vencimiento, erp_sucursal_id) → los lotes
 * conocidos, uno por número + fecha, con en cuántas salas aparece.
 * `vence` es 'AAAA-MM' (lo que muestra y compara la lista); `fecha`, la exacta.
 * @returns {{ lote: string, vence: string, fecha: string, veces: number }[]}
 */
export function lotesConocidosDeInventario(filas, hoy = hoySV()) {
    const vistos = new Map();
    (filas || []).forEach((f) => {
        const lote = String(f?.lote || '').trim().toUpperCase();
        const fecha = String(f?.fecha_vencimiento || '').slice(0, 10);
        if (!lote || esLoteGenerico(lote) || !/^\d{4}-\d{2}-\d{2}$/.test(fecha) || fecha <= hoy) return;
        const clave = `${lote}|${fecha}`;
        const c = vistos.get(clave) ?? { lote, vence: fecha.slice(0, 7), fecha, salas: new Set() };
        c.salas.add(f?.erp_sucursal_id);
        vistos.set(clave, c);
    });
    return [...vistos.values()]
        .map(({ salas, ...c }) => ({ ...c, veces: salas.size }))
        .sort((a, b) => a.fecha.localeCompare(b.fecha) || a.lote.localeCompare(b.lote));
}

/**
 * ¿Lo escrito choca con un lote ya registrado? Devuelve el registrado, o null.
 * `mismoNumero: true` = el número existe con otro vencimiento (sin salida:
 * se usa ése); si no, es uno que se le parece por un error de tecleo.
 */
export function choqueDeLote(valor, conocidos = []) {
    if (valor?.nuevo) {
        // «Es otro lote» sólo vale para un parecido, nunca para el mismo número.
        const l = String(valor?.lote || '').trim().toUpperCase();
        const mismo = conocidos.find((c) => c.lote === l);
        if (!mismo) return null;
    }
    const p = loteParecido({ lote: valor?.lote, vence: valor?.vence }, conocidos);
    if (!p) return null;
    return { ...p, mismoNumero: p.lote === String(valor?.lote || '').trim().toUpperCase() };
}

/** Por qué todavía no se puede despachar con lo escrito, o null si está bien. */
export function motivoDeLoteDeCaja(valor, conocidos = [], hoy = hoySV()) {
    const l = String(valor?.lote || '').trim().toUpperCase();
    if (!l || esLoteGenerico(l)) return 'Falta el lote que trae la caja.';
    if (l.length < 2 || l.length > 30) return 'Ese lote no parece un lote.';
    const v = venceNormal(valor?.vence);
    const m = /^(\d{4})-(\d{2})$/.exec(v);
    if (!v) return 'Falta el vencimiento de la caja.';
    if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) return 'Escribe el vencimiento como MM/AAAA.';
    if (fechaDeLoteDeCaja(valor, conocidos) <= hoy) return 'Esa caja ya venció: no puede salir.';
    const choque = choqueDeLote(valor, conocidos);
    if (choque?.mismoNumero) return `El lote ${choque.lote} ya está registrado con otro vencimiento.`;
    if (choque) return `¿Es el lote ${choque.lote}? Confírmalo antes de enviar.`;
    return null;
}

/** La fecha exacta que viaja al servidor: la del lote registrado si es ése, si no el día 1 del mes. */
export function fechaDeLoteDeCaja(valor, conocidos = []) {
    const l = String(valor?.lote || '').trim().toUpperCase();
    const v = venceNormal(valor?.vence);
    const registrado = conocidos.find((c) => c.lote === l && c.vence === v);
    return registrado?.fecha ?? `${v}-01`;
}

/** { lote, vence: 'AAAA-MM-DD' } listo para mandar. Sólo llamar si `motivoDeLoteDeCaja` dio null. */
export function loteDeCajaParaEnviar(valor, conocidos = []) {
    return { lote: String(valor?.lote || '').trim().toUpperCase(), vence: fechaDeLoteDeCaja(valor, conocidos) };
}
