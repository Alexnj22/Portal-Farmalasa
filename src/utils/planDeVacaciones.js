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

/**
 * Si una persona puede tomar vacaciones hoy y en qué ventana — lo que pinta el
 * aviso de elegibilidad al asignar un plan (portal y app). Un año cumplido
 * da derecho (Art. 177 CT); la ventana válida va del último aniversario a
 * tres meses después; a partir de los 9 meses se puede asignar por
 * adelantado. Fechas como 'AAAA-MM-DD'; `hoy` en hora de El Salvador.
 *
 * `tono`: 'ok' (dentro de ventana), 'cuidado' (fuera de ventana),
 * 'adelanto' (asignación anticipada) o 'no' (no elegible).
 */
export function elegibilidadDeVacaciones(fechaIngreso, hoy) {
    if (!fechaIngreso || !hoy) return null;
    const aFecha = (s) => { const [a, m, d] = String(s).slice(0, 10).split('-').map(Number); return new Date(Date.UTC(a, m - 1, d)); };
    const aTexto = (d) => d.toISOString().slice(0, 10);
    const ingreso = aFecha(fechaIngreso), ahora = aFecha(hoy);
    const ms = ahora - ingreso;
    const anios = ms / (1000 * 60 * 60 * 24 * 365.25);
    const meses = Math.floor(ms / (1000 * 60 * 60 * 24 * 30.44));
    const elegible = anios >= 1;
    const cerca = !elegible && meses >= 9;
    const proximo = new Date(Date.UTC(ahora.getUTCFullYear(), ingreso.getUTCMonth(), ingreso.getUTCDate()));
    if (proximo < ahora) proximo.setUTCFullYear(ahora.getUTCFullYear() + 1);
    const ultimo = new Date(proximo); ultimo.setUTCFullYear(ultimo.getUTCFullYear() - 1);
    const finVentana = new Date(ultimo); finVentana.setUTCMonth(finVentana.getUTCMonth() + 3);
    const enVentana = elegible && ahora >= ultimo && ahora <= finVentana;
    const tono = elegible ? (enVentana ? 'ok' : 'cuidado') : (cerca ? 'adelanto' : 'no');
    const ROTULO = { ok: 'Dentro de ventana válida', cuidado: 'Fuera de ventana óptima', adelanto: 'Asignación anticipada', no: 'No elegible' };
    return {
        isEligible: elegible, isNearEligible: cerca, inWindow: enVentana,
        yearsWorked: Math.floor(anios * 10) / 10, monthsWorked: meses,
        nextAnniversary: aTexto(proximo), lastAnniversary: aTexto(ultimo), windowEnd: aTexto(finVentana),
        tono, rotulo: ROTULO[tono],
    };
}
