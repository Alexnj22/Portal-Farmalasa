import { Palmtree, HeartPulse, FileText, CalendarOff, Building2 } from 'lucide-react';

/* La semana se mudó a `utils/semana.js` (2026-08-21) para que Solicitudes y
 * Traslados puedan pedirla sin arrastrar este archivo entero —que trae íconos y
 * la matemática de la planilla— a su cierre estático. Se re-exporta acá porque
 * es donde la vista de Horarios ya la buscaba: una sola definición, dos
 * puertas. */
export { getLocalMonday, formatWeekRange, shiftWeek, enLaSemanaDe, rangoDeSemana } from './semana';

// `claveDeDia` y la resolución del día viven en `utils/turnoDelDia.js` desde el
// 2026-08-27: hasta ese día la pregunta «¿qué turno tiene hoy esta persona?»
// estaba respondida cuatro veces con cuatro reglas distintas. Se re-exportan
// acá porque es donde media pantalla las venía a buscar.
import {
    resolverTurnoDelDia, tramosDeLaJornada, aMinutos,
} from './turnoDelDia';
export {
    claveDeDia, resolverTurnoDelDia, tramosDeLaJornada, reparosDelDia,
    descansoInsuficiente, aMinutos, aHora,
    HORAS_SEMANA_DIURNA, HORAS_SEMANA_NOCTURNA,
    HORAS_JORNADA_DIURNA, HORAS_JORNADA_NOCTURNA,
    DESCANSOS_POR_SEMANA, HORAS_ENTRE_JORNADAS, MINUTOS_DE_PAUSA,
} from './turnoDelDia';

// `timeToMins` es el nombre viejo de `aMinutos`. Sigue exportado porque lo
// importan diez archivos; el nuevo se llama en español como el resto del módulo.
export const timeToMins = aMinutos;

export const formatDateLocal = (dateStr) => {
    if (!dateStr) return '';
    const [y, m, d] = dateStr.split('-');
    return `${d}/${m}/${y}`;
};

export const minsToTimeStr = (mins) => {
    let h = Math.floor(mins / 60);
    const m = mins % 60;
    let ampm = h >= 12 ? 'pm' : 'am';
    h = h % 12 || 12;
    return `${h}:${String(m).padStart(2, '0')} ${ampm}`;
};

export const formatTime12h = (time24) => {
    if (!time24) return '';
    let [h, m] = time24.split(':').map(Number);
    const ampm = h >= 12 ? 'pm' : 'am';
    h = h % 12 || 12;
    return `${h}:${String(m).padStart(2, '0')} ${ampm}`;
};

export const formatHourAMPM = (hour) => {
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const h = hour % 12 || 12;
    return `${h}:00 ${ampm}`;
};

export const DAY_NAMES = { 1: 'Lun', 2: 'Mar', 3: 'Mié', 4: 'Jue', 5: 'Vie', 6: 'Sáb', 0: 'Dom' };

// Los tramos de una jornada los parte `tramosDeLaJornada`. Esta firma se queda
// porque la llaman las celdas del calendario con los valores sueltos.
export const getTimeBlocks = (startStr, endStr, hasLunch, lunchStart, hasLactation, lactationStart) => {
    const resuelto = resolverTurnoDelDia(
        { customStart: startStr, customEnd: endStr, hasLunch, lunchStart, hasLactation, lactationStart },
        [],
    );
    return tramosDeLaJornada(resuelto).map(t => ({
        type: t.tipo === 'pausa' ? 'lunch' : t.tipo === 'lactancia' ? 'lactation' : 'work',
        start: t.inicio, end: t.fin, label: t.etiqueta,
    }));
};

const parseMeta = (ev) =>
    typeof ev.metadata === 'string'
        ? (() => { try { return JSON.parse(ev.metadata); } catch { return {}; } })()
        : (ev.metadata || {});

const isConflictOnDate = (ev, dateStr) => {
    const meta = parseMeta(ev);
    if (ev.type === 'PERMIT') {
        const pDates = meta.permissionDates;
        if (Array.isArray(pDates) && pDates.length > 0) return pDates.includes(dateStr);
        return ev.date === dateStr;
    }
    if (ev.type === 'SUPPORT') {
        const ranges = meta.supportRanges;
        if (Array.isArray(ranges) && ranges.length > 0) {
            return ranges.some(r => dateStr >= r.start && dateStr <= r.end);
        }
        return ev.date <= dateStr && (!meta.endDate || meta.endDate >= dateStr);
    }
    return ev.date <= dateStr && (!meta.endDate || meta.endDate >= dateStr);
};

// Las horas que se le pagan a alguien en una semana. Un día con vacaciones,
// incapacidad, permiso, asueto o apoyo en otra sala no suma acá.
//
// Desde el 2026-08-27 el día lo resuelve `resolverTurnoDelDia` y no una copia
// local: la copia exigía `shiftId || customStart` y descontaba una hora fija de
// almuerzo, así que no veía la pausa que hoy declara el turno del catálogo.
export const calculateEmployeeWeeklyHoursLocal = (schedule, shifts, history, calendarDates) => {
    if (!schedule || !shifts) return 0;
    let totalMins = 0;
    [1, 2, 3, 4, 5, 6, 0].forEach((dayId, idx) => {
        const dateStr = calendarDates[idx];
        const hasConflict = (history || []).some(ev =>
            ['VACATION', 'DISABILITY', 'PERMIT', 'HOLIDAY', 'SUPPORT'].includes(ev.type) && isConflictOnDate(ev, dateStr)
        );
        if (hasConflict) return;
        totalMins += resolverTurnoDelDia(schedule[dayId], shifts).minutosPagados;
    });
    return Number((totalMins / 60).toFixed(1));
};

// Bucket B (DESIGN.md §6) — categórico por jerarquía de rol, sin severidad.
// `variante` es el nombre de la variante de `Badge`; `bg`/`text`/`border` son
// la MISMA paleta escrita a mano y siguen ahí para los sitios que aún pintan
// una superficie (no un chip). Agregado el 2026-07-28 (D3.5).
export const getRoleTheme = (roleName) => {
    const role = (roleName || '').toUpperCase();
    if (role.includes('GERENTE') || (role.includes('JEFE') && !role.includes('SUB'))) return { bg: 'bg-chart-1/10', text: 'text-chart-1-text', border: 'border-chart-1/30', variante: 'chart-1' };
    if (role.includes('SUBJEFE')) return { bg: 'bg-chart-3/10', text: 'text-chart-3-text', border: 'border-chart-3/30', variante: 'chart-3' };
    if (role.includes('REGENTE')) return { bg: 'bg-chart-9/10', text: 'text-chart-9-text', border: 'border-chart-9/30', variante: 'chart-9' };
    if (role.includes('SUPERVISOR')) return { bg: 'bg-chart-6/10', text: 'text-chart-6-text', border: 'border-chart-6/30', variante: 'chart-6' };
    if (role.includes('ADMINISTRADOR')) return { bg: 'bg-success/10', text: 'text-success-text', border: 'border-success/30', variante: 'success' };
    return { bg: 'bg-surface-card-hover', text: 'text-content-2', border: 'border-divider', variante: 'neutral' };
};

export const getDayConflictLocal = (dateStr, history) => {
    // Eventos principales (mayor prioridad)
    const event = (history || []).find(ev =>
        ['VACATION', 'DISABILITY', 'PERMIT', 'HOLIDAY'].includes(ev.type) && isConflictOnDate(ev, dateStr)
    );
    if (event) {
        const config = {
            VACATION:    { label: 'Vacaciones', icon: Palmtree,   bg: 'bg-warning/10', text: 'text-warning-text', border: 'border-warning/30' },
            DISABILITY:  { label: 'Incapacidad', icon: HeartPulse, bg: 'bg-chart-6/10', text: 'text-chart-6-text', border: 'border-chart-6/30' },
            PERMIT:      { label: 'Permiso',     icon: FileText,   bg: 'bg-chart-3/10', text: 'text-chart-3-text', border: 'border-chart-3/30' },
            HOLIDAY:     { label: 'Asueto',      icon: CalendarOff,bg: 'bg-chart-1/10', text: 'text-chart-1-text', border: 'border-chart-1/30' }
        };
        return config[event.type] || config.PERMIT;
    }
    // Apoyo Temporal (menor prioridad — informativo)
    const supportEvent = (history || []).find(ev =>
        ev.type === 'SUPPORT' && isConflictOnDate(ev, dateStr)
    );
    if (supportEvent) {
        const meta = parseMeta(supportEvent);
        const targetBranch = meta.targetBranchName || meta.targetBranchId || 'otra sucursal';
        return {
            type: 'SUPPORT',
            label: `Apoyo en ${targetBranch}`,
            icon: Building2,
            bg: 'bg-chart-4/10',
            text: 'text-chart-4-text',
            border: 'border-chart-4/30',
            targetBranchId: meta.targetBranchId || null
        };
    }
    return null;
};