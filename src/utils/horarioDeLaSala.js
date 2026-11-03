/**
 * Quién sale en el horario de una sala y en qué orden. Vivía dentro de
 * `views/SchedulesView.jsx`; se mudó el 2026-10-02 para que la app del teléfono
 * muestre la misma gente en el mismo orden.
 *
 * Un horario se le publica a una PERSONA: una cuenta técnica o un servicio
 * externo no tienen turno que cubrir (ver `tipoDeFicha.js`).
 */
import { soloPersonalEnPlanilla } from './tipoDeFicha';
import { horasPorSemanaDePractica } from './practicanteFormulario';

const esFichaDePracticante = (e) => (e?.tipo_ficha ?? e?.tipoFicha) === 'practicante';

/** El peso de un cargo en la lista: jefatura, subjefatura, regencia, dependientes, el resto. */
export function pesoDeCargo(cargo) {
    const r = (cargo || '').toUpperCase();
    if (r.includes('GERENTE') || (r.includes('JEFE') && !r.includes('SUB'))) return 1;
    if (r.includes('SUBJEFE')) return 2;
    if (r.includes('REGENTE')) return 3;
    if (r.includes('DEPENDIENTE')) return 4;
    return 5;
}

/**
 * La gente de planilla de la sala, activa, por cargo y después por nombre — y
 * al final sus PRACTICANTES (2026-11-03: «habilítalo en horarios y turnos»).
 *
 * El practicante no es planilla, así que no se mide contra las 44 h: cada uno
 * trae `metaSemanalDePractica`, las horas de su patrón, y `esPracticante`. Se
 * le pasa la lista de `practicantes` para leer ese patrón; sin ella sale con
 * meta `null` y la tarjeta no le inventa un faltante.
 */
export function personasDelHorario(empleados, salaId, practicantes = []) {
    const deLaSala = (e) => String(e.branchId || e.branch_id) === String(salaId) && (e.status || '').toUpperCase() !== 'INACTIVO';
    const porNombre = (a, b) => (a.name || 'Sin Nombre').localeCompare(b.name || 'Sin Nombre');
    const planilla = soloPersonalEnPlanilla(empleados || []).filter(deLaSala)
        .sort((a, b) => (pesoDeCargo(a.role) - pesoDeCargo(b.role)) || porNombre(a, b));
    const practica = (empleados || []).filter((e) => esFichaDePracticante(e) && deLaSala(e)).sort(porNombre)
        .map((e) => {
            const p = (practicantes || []).find((x) => x.employee_id && String(x.employee_id) === String(e.id));
            const meta = p?.horario ? horasPorSemanaDePractica(p.horario) : 0;
            return { ...e, esPracticante: true, metaSemanalDePractica: meta || null };
        });
    return [...planilla, ...practica];
}

/** Quién puede venir a cubrir a una sala: la gente de planilla, activa, de las OTRAS salas, por nombre. */
export function personasParaCubrir(empleados, salaId) {
    return soloPersonalEnPlanilla(empleados || [])
        .filter((e) => String(e.branchId || e.branch_id) !== String(salaId) && (e.status || '').toUpperCase() !== 'INACTIVO')
        .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
}
