/**
 * Lo que «Mi perfil» calcula sobre la ficha de la persona: cuánto lleva en la
 * empresa, su historial con el ingreso incluido, su horario de esta semana, sus
 * próximas vacaciones y si su cumpleaños está cerca. Vivía dentro de
 * `views/employee/EmployeeProfileView.jsx`; se mudó el 2026-10-02 para que la
 * app del teléfono muestre el mismo perfil.
 */
import { tokenMatch } from './searchUtils';
import { diasEntre, hoySV, sumarDias } from './fecha';
import { resolverTurnoDelDia } from './turnoDelDia';

/**
 * «2 años 3 meses», «5 meses», «12 días», «Primer día» o «—».
 *
 * Cuenta meses CUMPLIDOS: el mes sólo suma cuando llega el día del ingreso.
 * Antes restaba meses de calendario sin mirar el día, y quien entró el 4-sep
 * figuraba con «2 meses» el 3-nov, cuando lleva 1 mes y 30 días (reporte del
 * usuario, 2026-11-03). Bajo el mes se dice en días: «Nuevo» no decía nada.
 */
export function tiempoEnLaEmpresa(hireDate, hoy = hoySV()) {
    if (!hireDate) return '—';
    const ingreso = String(hireDate).slice(0, 10);
    if (ingreso > hoy) return '—';
    const [hy, hm, hd] = ingreso.split('-').map(Number);
    const [ty, tm, td] = hoy.split('-').map(Number);
    let meses = (ty - hy) * 12 + (tm - hm) - (td < hd ? 1 : 0);
    if (meses <= 0) {
        const dias = diasEntre(ingreso, hoy);
        if (dias === 0) return 'Primer día';
        return `${dias} día${dias > 1 ? 's' : ''}`;
    }
    const y = Math.floor(meses / 12);
    const m = meses % 12;
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
 * su horario publicado (`weeklySchedule`) y la fecha de esta semana.
 *   → [{ id, short, fecha: 'YYYY-MM-DD', turno | null, minutos }]
 *
 * Cada día se resuelve con `resolverTurnoDelDia`, el canónico (ver la regla
 * «un día de horario se resuelve en UN solo sitio»). Antes miraba sólo
 * `shiftId`: un día con horas propias y sin turno del catálogo —que el editor
 * deja guardar y pinta «Manual»— salía «Libre» en el perfil. Y las horas
 * propias de un cambio de turno aprobado no pisaban las del catálogo.
 *
 * `turno` conserva su forma `{ name, start, end }` porque la app del teléfono
 * la lee igual; `minutos` son los pagados (sin la pausa alimenticia).
 */
export function semanaDelPerfil(weeklySchedule, turnos = [], hoy = hoySV()) {
    if (!weeklySchedule) return [];
    const dow = new Date(`${hoy}T12:00:00Z`).getUTCDay();
    const lunes = sumarDias(hoy, dow === 0 ? -6 : 1 - dow);
    return DIAS.map((d) => {
        const raw = weeklySchedule[d.id] ?? weeklySchedule[String(d.id)];
        const id = raw && typeof raw === 'object' ? raw.shiftId : raw;
        let turno = id && id !== 'LIBRE' ? turnos.find((s) => String(s.id) === String(id)) || null : null;
        const resuelto = resolverTurnoDelDia(
            raw && typeof raw === 'object' ? raw : (id ? { shiftId: id } : null), turnos);
        if (resuelto.trabaja) {
            turno = { ...(turno || {}), id: turno?.id ?? null, name: resuelto.nombre,
                start: resuelto.inicio, end: resuelto.fin, manual: resuelto.esManual };
        } else if (raw && typeof raw === 'object') {
            // El canónico dijo «no trabaja» (isOff, sin horas, entrada = salida).
            turno = null;
        }
        return { ...d, fecha: sumarDias(lunes, d.id === 0 ? 6 : d.id - 1), turno,
            minutos: resuelto.trabaja ? resuelto.minutosPagados : 0 };
    });
}

/** ¿Hay horario publicado esta semana? Sin él, «Libre» sería mentir: no es que
 *  no trabaje, es que todavía no se sabe. */
export const tieneHorarioPublicado = (weeklySchedule) =>
    !!weeklySchedule && typeof weeklySchedule === 'object' && Object.keys(weeklySchedule).length > 0;

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

/**
 * «MM-DD» del cumpleaños de una persona, venga de donde venga. La fecha
 * completa (`birthDate`/`birth_date`) sólo llega para uno mismo o con permiso
 * de Personal; para los demás `employees_safe` manda `cumple_mes_dia` —día y
 * mes, sin el año—, que es lo único que hace falta para saber si es hoy.
 */
export function cumpleMesDia(persona) {
    const completa = persona?.birthDate || persona?.birth_date;
    if (completa) return String(completa).slice(5, 10);
    return persona?.cumpleMesDia || persona?.cumple_mes_dia || null;
}

/** ¿Hoy cumple años? (hora de El Salvador). */
export function esCumpleHoy(persona, hoy = hoySV()) {
    const md = cumpleMesDia(persona);
    return !!md && md === hoy.slice(5, 10);
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

/** Los estados de un plan de vacaciones, con el mismo rótulo en el portal y la
 *  app. `variante` es la palabra con que cada pantalla elige su color. */
export const ESTADO_DE_PLAN = {
    PLANNED:   { label: 'Planificado', variante: 'chart-1' },
    CONFIRMED: { label: 'Confirmado',  variante: 'success' },
    TAKEN:     { label: 'Completado',  variante: 'neutral' },
};
export const estadoDePlan = (status) => ESTADO_DE_PLAN[status] ?? ESTADO_DE_PLAN.PLANNED;
