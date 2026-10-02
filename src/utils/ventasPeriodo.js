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

// ── Vendedores ──────────────────────────────────────────────────────────────

/** Códigos de vendedor que no son personas: se muestran con su rótulo. */
export const CODIGOS_ESPECIALES = { '1000': 'Administración', '125': 'Domicilio' };

/**
 * El ranking del período a partir de las filas por sala y vendedor
 * (`get_vendedores_resumen`). Un vendedor que vendió en varias salas se suma en
 * UNA fila; un código que no es de nadie (ni ficha ni especial) no se pierde:
 * va aparte, por sala, porque esa plata existe aunque nadie la firme.
 *   → { conocidos: [{cod_vendedor, total, count, branchIds, emp, especial}], sinFicha: [{branch_id, total, count}], total, facturas }
 */
export function rankingDeVendedores(filas, porCodigo) {
    const conocidos = new Map();
    const sinFicha = new Map();
    for (const r of (filas || [])) {
        const total = parseFloat(r.total_ventas ?? r.total ?? 0);
        const count = parseInt(r.total_facturas ?? r.count ?? 0, 10);
        const emp = porCodigo.get(r.cod_vendedor) || null;
        const especial = CODIGOS_ESPECIALES[r.cod_vendedor] || null;
        if (emp || especial) {
            const v = conocidos.get(r.cod_vendedor) || { cod_vendedor: r.cod_vendedor, total: 0, count: 0, branchIds: [], emp, especial };
            v.total += total;
            v.count += count;
            if (!v.branchIds.includes(r.branch_id)) v.branchIds.push(r.branch_id);
            conocidos.set(r.cod_vendedor, v);
        } else {
            const u = sinFicha.get(r.branch_id) || { branch_id: r.branch_id, total: 0, count: 0 };
            u.total += total;
            u.count += count;
            sinFicha.set(r.branch_id, u);
        }
    }
    const lista = [...conocidos.values()].sort((a, b) => b.total - a.total);
    const sueltos = [...sinFicha.values()];
    const suma = (xs, k) => xs.reduce((s, x) => s + x[k], 0);
    return { conocidos: lista, sinFicha: sueltos, total: suma(lista, 'total') + suma(sueltos, 'total'), facturas: suma(lista, 'count') + suma(sueltos, 'count') };
}

/** El primer día del mes anterior al de `fini` («2026-10-15» → «2026-09-01»). */
export function mesAnteriorDe(fini) {
    const [y, m] = fini.split('-').map(Number);
    const idx = y * 12 + (m - 1) - 1;
    return `${Math.floor(idx / 12)}-${pad((idx % 12) + 1)}-01`;
}

/** El puesto de cada vendedor el mes anterior (sin los códigos especiales): Map cod → 1, 2, … */
export function puestosDelMesAnterior(filas) {
    const porVendedor = new Map();
    for (const r of (filas || [])) {
        if (CODIGOS_ESPECIALES[r.cod_vendedor]) continue;
        porVendedor.set(r.cod_vendedor, (porVendedor.get(r.cod_vendedor) || 0) + parseFloat(r.total_sum || 0));
    }
    const puestos = new Map();
    [...porVendedor.entries()].sort((a, b) => b[1] - a[1]).forEach(([cod], i) => puestos.set(cod, i + 1));
    return puestos;
}

/** Las ventas de un vendedor por día, con el reparto por sala (`get_vendedor_diario`). */
export function ventasDiariasDelVendedor(filas) {
    const porDia = new Map();
    for (const d of (filas || [])) {
        const v = porDia.get(d.fecha) || { fecha: d.fecha, total: 0, count: 0, branches: [] };
        v.total += parseFloat(d.total_ventas || 0);
        v.count += parseInt(d.total_facturas || 0, 10);
        v.branches.push({ branch_id: d.branch_id, total: parseFloat(d.total_ventas || 0) });
        porDia.set(d.fecha, v);
    }
    return [...porDia.values()];
}
