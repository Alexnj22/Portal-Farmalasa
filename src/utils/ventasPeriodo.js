/**
 * La aritmética de la vista de Ventas: el período contra el que se compara, la
 * variación por día y los renglones de una venta. Vivía dentro de
 * `views/VentasView.jsx`; se mudó el 2026-10-02 para que la app del teléfono
 * compare y descuente con la MISMA regla que el portal.
 */
import { diasEntre, horaSV, hoySV } from './fecha';

const pad = (n) => String(n).padStart(2, '0');

/** Del primero del mes a HOY: así se compara «los mismos días» del mes anterior. */
export function mesEnCurso(hoy = hoySV()) {
    const [y, m] = hoy.split('-');
    return { fini: `${y}-${m}-01`, ffin: hoy, label: `${y}-${m}` };
}

/**
 * El período anterior equivalente: el mismo rango corrido hacia atrás TANTOS
 * MESES COMO ABARCA la selección (bug del 2026-07-17: «Últimos 3 meses» se
 * comparaba contra un mes atrás, casi solapado). Un día que no existe en el mes
 * de destino cae en su último día.
 *   5–9 may → 5–9 abr · may–jul → feb–abr · ene–dic 2026 → ene–dic 2025
 */
export function periodoAnterior(fini, ffin) {
    const [sy, sm] = fini.split('-').map(Number);
    const [ey, em] = ffin.split('-').map(Number);
    const meses = Math.max(1, (ey * 12 + em) - (sy * 12 + sm) + 1);
    const atras = (dia) => {
        const [y, m, d] = dia.split('-').map(Number);
        const idx = y * 12 + (m - 1) - meses;
        const py = Math.floor(idx / 12);
        const pm = ((idx % 12) + 12) % 12 + 1;
        const ultimo = new Date(Date.UTC(py, pm, 0)).getUTCDate();
        return `${py}-${pad(pm)}-${pad(Math.min(d, ultimo))}`;
    };
    return { prevFini: atras(fini), prevFfin: atras(ffin) };
}

/** Días del rango, los dos extremos incluidos. */
export const diasDelRango = (fini, ffin) => diasEntre(fini, ffin) + 1;

/** Variación en % del PROMEDIO POR DÍA: meses de distinto largo se comparan parejo. */
export function variacionPorDia(actual, diasActual, previo, diasPrevio) {
    if (!previo || !diasPrevio || !diasActual) return null;
    const a = actual / diasActual;
    const p = previo / diasPrevio;
    return ((a - p) / p) * 100;
}

/** «HH:MM:00» si el rango termina hoy (el anterior se corta a la misma hora); si no, null. */
export function horaDeCorte(ffin, hoy = hoySV(), hora = horaSV()) {
    if (ffin !== hoy) return null;
    return hora.replace(/:\d\d$/, ':00');
}

/** El producto que se lee como descuento (canje de puntos) en los renglones. */
export const PRODUCTO_DESCUENTO = -999;

/**
 * Los renglones de una venta listos para mostrar: sin duplicados (la
 * sincronización puede traer el mismo renglón dos veces), los productos y el
 * descuento por puntos. Si no viene el renglón de descuento pero la suma de los
 * productos pasa al total por más de un centavo, esa diferencia ES el descuento.
 */
export function renglonesDeLaVenta(items, total) {
    const vistos = new Set();
    const unicos = (items || []).filter((it) => {
        const firma = `${it.erp_product_id ?? it.descripcion}|${it.presentacion ?? ''}|${it.precio_unitario}|${it.total_linea}|${it.lote ?? ''}`;
        if (vistos.has(firma)) return false;
        vistos.add(firma);
        return true;
    });
    const descuentos = unicos.filter((it) => it.erp_product_id === PRODUCTO_DESCUENTO);
    const productos = unicos.filter((it) => it.erp_product_id !== PRODUCTO_DESCUENTO && it.descripcion);
    const porRenglon = descuentos.reduce((s, it) => s + Math.abs(parseFloat(it.total_linea || 0)), 0);
    const suma = productos.reduce((s, it) => s + parseFloat(it.total_linea || 0), 0);
    const porDiferencia = suma - parseFloat(total || 0);
    const descuento = descuentos.length ? porRenglon : (porDiferencia > 0.01 ? porDiferencia : 0);
    return { productos, descuento };
}
