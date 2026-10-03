/**
 * Lo que «Mi perfil» calcula sobre la ficha de la persona: cuánto lleva en la
 * empresa, su historial con el ingreso incluido, su horario de esta semana, sus
 * próximas vacaciones y si su cumpleaños está cerca. Vivía dentro de
 * `views/employee/EmployeeProfileView.jsx`; se mudó el 2026-10-02 para que la
 * app del teléfono muestre el mismo perfil.
 */
import { tokenMatch } from './searchUtils';
import { diasEntre, hoySV, sumarDias } from './fecha';

/** «2 años 3 meses», «5 meses», «Nuevo» o «—». */
export function tiempoEnLaEmpresa(hireDate, hoy = hoySV()) {
    if (!hireDate) return '—';
    const [hy, hm] = String(hireDate).slice(0, 10).split('-').map(Number);
    const [ty, tm] = hoy.split('-').map(Number);
    let y = ty - hy;
    let m = tm - hm;
    // Por mes calendario, sin mirar el día: así lo contó siempre el portal.
    if (m < 0) { y -= 1; m += 12; }
    if (y === 0 && m === 0) return 'Nuevo';
    return `${y > 0 ? `${y} año${y > 1 ? 's' : ''} ` : ''}${m > 0 ? `${m} mes${m > 1 ? 'es' : ''}` : ''}`.trim();
}

/** El historial, el más reciente primero, con el ingreso como primer evento. */
export function historialDePerfil(eventos = [], hireDate, nombreSala) {
    const ingreso = hireDate ? [{
        id: 'hiring-event', type: 'HIRING', date: hireDate, isSystem: true,
        note: `Inicio de labores. Sucursal: ${nombreSala || 'N/A'}`, metadata: {},
    }] : [];
    return [...eventos, ...ingreso].sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

/** El historial filtrado por fechas, tipo y búsqueda (en la nota y el rótulo del tipo). */
export function filtrarHistorial(historial, { desde = '', hasta = '', tipo = '', busqueda = '', rotulos = {} } = {}) {
    let lista = historial;
    if (desde) lista = lista.filter((ev) => ev.date >= desde);
    if (hasta) lista = lista.filter((ev) => ev.date <= hasta);
    if (tipo) lista = lista.filter((ev) => ev.type === tipo);
    if (String(busqueda).trim()) lista = lista.filter((ev) => tokenMatch(busqueda, ev.note, rotulos[ev.type]?.label, ev.type));
    return lista;
}

const DIAS = [
    { id: 1, short: 'Lu' }, { id: 2, short: 'Ma' }, { id: 3, short: 'Mi' },
    { id: 4, short: 'Ju' }, { id: 5, short: 'Vi' }, { id: 6, short: 'Sá' }, { id: 0, short: 'Do' },
];

/**
 * La semana de la persona, de lunes a domingo, con el turno de cada día según
 * su horario habitual (`weeklySchedule`) y la fecha de esta semana.
 *   → [{ id, short, fecha: 'YYYY-MM-DD', turno | null }]
 */
export function semanaDelPerfil(weeklySchedule, turnos = [], hoy = hoySV()) {
    if (!weeklySchedule) return [];
    const dow = new Date(`${hoy}T12:00:00Z`).getUTCDay();
    const lunes = sumarDias(hoy, dow === 0 ? -6 : 1 - dow);
    return DIAS.map((d) => {
        const raw = weeklySchedule[d.id] ?? weeklySchedule[String(d.id)];
        const id = typeof raw === 'object' ? raw?.shiftId : raw;
        const turno = id && id !== 'LIBRE' ? turnos.find((s) => String(s.id) === String(id)) || null : null;
        return { ...d, fecha: sumarDias(lunes, d.id === 0 ? 6 : d.id - 1), turno };
    });
}

/** La ausencia (vacación, incapacidad o permiso) que cubre ese día, si hay. */
export function ausenciaDelDia(eventos, dia) {
    return (eventos || []).find((ev) => {
        if (!['VACATION', 'DISABILITY', 'PERMIT'].includes(ev.type)) return false;
        const meta = ev.metadata && typeof ev.metadata === 'object' ? ev.metadata : {};
        return dia >= (meta.startDate || ev.date) && dia <= (meta.endDate || ev.date);
    }) || null;
}

/** Las próximas vacaciones planificadas o confirmadas que todavía no terminan. */
export function proximasVacaciones(planes = [], hoy = hoySV()) {
    return planes.find((vp) => vp.end_date >= hoy && (vp.status === 'PLANNED' || vp.status === 'CONFIRMED')) || null;
}

/** «¡Hoy! 🎉», «Mañana», «en N días» (hasta 30) o null. */
export function cumpleEn(birthDate, hoy = hoySV()) {
    if (!birthDate) return null;
    const [, m, d] = String(birthDate).slice(0, 10).split('-');
    const anio = Number(hoy.slice(0, 4));
    let proximo = `${anio}-${m}-${d}`;
    if (proximo < hoy) proximo = `${anio + 1}-${m}-${d}`;
    const faltan = diasEntre(hoy, proximo);
    if (faltan === 0) return '¡Hoy! 🎉';
    if (faltan === 1) return 'Mañana';
    if (faltan <= 30) return `en ${faltan} días`;
    return null;
}
