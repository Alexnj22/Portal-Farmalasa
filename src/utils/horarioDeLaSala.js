/**
 * Quién sale en el horario de una sala y en qué orden. Vivía dentro de
 * `views/SchedulesView.jsx`; se mudó el 2026-10-02 para que la app del teléfono
 * muestre la misma gente en el mismo orden.
 *
 * Un horario se le publica a una PERSONA: una cuenta técnica o un servicio
 * externo no tienen turno que cubrir (ver `tipoDeFicha.js`).
 */
import { soloPersonalEnPlanilla } from './tipoDeFicha';

/** El peso de un cargo en la lista: jefatura, subjefatura, regencia, dependientes, el resto. */
export function pesoDeCargo(cargo) {
    const r = (cargo || '').toUpperCase();
    if (r.includes('GERENTE') || (r.includes('JEFE') && !r.includes('SUB'))) return 1;
    if (r.includes('SUBJEFE')) return 2;
    if (r.includes('REGENTE')) return 3;
    if (r.includes('DEPENDIENTE')) return 4;
    return 5;
}

/** La gente de planilla de la sala, activa, por cargo y después por nombre. */
export function personasDelHorario(empleados, salaId) {
    return soloPersonalEnPlanilla(empleados || [])
        .filter((e) => String(e.branchId || e.branch_id) === String(salaId) && (e.status || '').toUpperCase() !== 'INACTIVO')
        .sort((a, b) => (pesoDeCargo(a.role) - pesoDeCargo(b.role)) || (a.name || 'Sin Nombre').localeCompare(b.name || 'Sin Nombre'));
}

/** Quién puede venir a cubrir a una sala: la gente de planilla, activa, de las OTRAS salas, por nombre. */
export function personasParaCubrir(empleados, salaId) {
    return soloPersonalEnPlanilla(empleados || [])
        .filter((e) => String(e.branchId || e.branch_id) !== String(salaId) && (e.status || '').toUpperCase() !== 'INACTIVO')
        .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
}
