// Los números del Inicio, sin pantalla: los usa el tablero del portal
// (`DashboardView`) y el Inicio nativo de la app (2026-09-30). Estaban
// escritos adentro de la vista de 4,000 líneas; la app los habría tenido que
// copiar, y dos «presentes hoy» con dos reglas es la clase de número que no
// cuadra sin que nadie sepa por qué.

const diaDe = (a) => a?.date || a?.timestamp?.split('T')[0];
const salaDe = (e) => String(e?.branchId ?? e?.branch_id ?? '');

/** Quienes siguen en planilla (ni inactivos ni liquidados). */
export const empleadosActivos = (empleados = []) =>
    empleados.filter((e) => e.status !== 'INACTIVO' && e.status !== 'LIQUIDADO');

/** Cuántas personas marcaron `fecha` (AAAA-MM-DD). `sala` acota a una sucursal. */
export function presentesEl(empleados = [], fecha, sala = '') {
    const ids = new Set();
    for (const e of empleados) {
        if (sala && salaDe(e) !== String(sala)) continue;
        for (const a of e.attendance || []) if (diaDe(a) === fecha) { ids.add(e.id); break; }
    }
    return ids.size;
}

/** El problema de una sucursal que merece alerta, o null. */
export function problemaDeSucursal(b) {
    if (!b?.address) return 'Sin dirección registrada';
    if (!b.phone && !b.cell) return 'Sin teléfono de contacto';
    if (b.propertyType === 'RENTED' && b.rent?.contract?.endDate) {
        const d = Math.ceil((new Date(b.rent.contract.endDate) - new Date()) / 86400000);
        if (d <= 60) return `Contrato vence en ${d} días`;
    }
    return null;
}

/**
 * Las ventas de un día por sala: total, transacciones y la curva por hora
 * (7 a. m. a 9 p. m.), a partir de las filas de `branch_hourly_sales`.
 * @returns {Array<{ branchId: string, total: number, tickets: number, porHora: number[] }>}
 */
export function ventasPorSala(filas = [], { desde = 7, hasta = 21 } = {}) {
    const por = new Map();
    for (const f of filas) {
        const k = String(f.branch_id);
        if (!por.has(k)) por.set(k, { branchId: k, total: 0, tickets: 0, porHora: Array(hasta - desde + 1).fill(0) });
        const s = por.get(k);
        const monto = Number(f.total_sales) || 0;
        s.total += monto;
        s.tickets += Number(f.transaction_count) || 0;
        const h = Number(f.sale_hour);
        if (h >= desde && h <= hasta) s.porHora[h - desde] += monto;
    }
    return [...por.values()].sort((a, b) => b.total - a.total);
}

/** «Buenos días / tardes / noches» según la hora. */
export function saludoDeLaHora(fecha = new Date()) {
    const h = fecha.getHours();
    if (h < 12) return 'Buenos días';
    if (h < 19) return 'Buenas tardes';
    return 'Buenas noches';
}
