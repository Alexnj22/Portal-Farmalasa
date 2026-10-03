/**
 * El plan de vacaciones del año: cuántos días cuenta un período, cuántos lleva
 * usados cada persona y la lista de planes filtrada y en orden. Vivía dentro de
 * `views/VacationPlanView.jsx`; se mudó el 2026-10-02 para que la app del
 * teléfono cuente con la MISMA regla.
 */
import { smartFilter } from './searchUtils';
import { diasEntre } from './fecha';

/**
 * Los días de vacación de un período. Un extremo con HORA no es un día de
 * vacación: si el día de inicio tiene hora, esa mañana se trabajó y no cuenta;
 * lo mismo el de fin. Del 5 al 21 con las dos horas puestas son 15, no 17.
 */
export function diasDeVacacion(inicio, fin, horaInicio, horaFin) {
    if (!inicio || !fin || fin < inicio) return 0;
    return Math.max(0, diasEntre(inicio, fin) + 1 - (horaInicio ? 1 : 0) - (horaFin ? 1 : 0));
}

/** Rótulo de cada estado de un plan. */
export const ESTADO_PLAN = {
    DRAFT: 'Borrador', PRE_APPROVED: 'Pre-aprobado', CHANGE_REQUESTED: 'Cambio sol.', APPROVED: 'Aprobado',
    PLANNED: 'Planificado', CONFIRMED: 'Confirmado', TAKEN: 'Tomado', CANCELLED: 'Cancelado',
};

/** Los días usados por persona en el año: sólo lo aprobado, confirmado o tomado. */
export function diasUsadosPorPersona(planes, anio) {
    const m = new Map();
    for (const p of planes || []) {
        if (p.year !== anio || !['APPROVED', 'CONFIRMED', 'TAKEN'].includes(p.status)) continue;
        const k = String(p.employee_id);
        m.set(k, (m.get(k) || 0) + (p.days || 0));
    }
    return m;
}

/** Los planes por estado y búsqueda, ordenados por sala, cargo y fecha de inicio. */
export function planesVisibles(planes, { estado = 'ALL', busqueda = '' } = {}) {
    const porEstado = (planes || []).filter((p) => estado === 'ALL' || p.status === estado);
    const orden = (a, b) => (a.branch?.name || '').localeCompare(b.branch?.name || '')
        || (a.employee?.role || a.employee?.position || '').localeCompare(b.employee?.role || b.employee?.position || '')
        || String(a.start_date).localeCompare(String(b.start_date));
    if (!String(busqueda).trim()) return { planes: porEstado.slice().sort(orden), aproximado: false };
    const { results, isFuzzy } = smartFilter(busqueda, porEstado, (p) => [p.employee?.name, p.branch?.name]);
    return { planes: results.slice().sort(orden), aproximado: isFuzzy };
}
