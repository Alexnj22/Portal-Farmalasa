/**
 * Auditoría de tiempos — qué pasó en UN día de una persona: su turno, sus
 * marcas, cuáles faltan (las esperadas que ya debieron ocurrir), si llegó
 * tarde, si el sistema cerró el día solo, si quedó pendiente de Talento
 * Humano, si se editó y si marcó en otra sala (apoyo). Era el cuerpo de
 * `DayCard` en `AttendanceAuditView`; se mudó el 2026-10-05 para que la app
 * audite con la misma regla.
 */
import { buildCSTDate, getCSTDateStr, minutosDeTardanza } from '../data/attendanceAudit';
import { isAutoPunch, isEditedPunch, isPendingPunch } from './quincena';
import { MINUTOS_DE_PAUSA, resolverTurnoDelDia } from './turnoDelDia';
import { lunesDe } from './fecha';

export const ROTULO_MARCA = {
    IN: 'Entrada', IN_EARLY: 'Entrada Anticipada', IN_AFTER_SHIFT: 'Entrada Fuera de Turno',
    IN_EXTRA: 'Entrada Extra', IN_RETURN: 'Regreso de Permiso',
    IN_LUNCH: 'Regreso almuerzo', IN_LACTATION: 'Regreso lactancia',
    OUT: 'Salida', OUT_LATE: 'Salida con Overtime', OUT_EARLY: 'Salida anticipada',
    OUT_LUNCH: 'Salida almuerzo', OUT_LACTATION: 'Salida lactancia',
    OUT_BUSINESS: 'Gestión externa', OUT_EXTRA: 'Salida Extra',
};
export const TIPOS_DE_ENTRADA = new Set(['IN', 'IN_EARLY', 'IN_AFTER_SHIFT', 'IN_EXTRA', 'IN_RETURN', 'PUNCH_IN']);
export const TIPOS_DE_SALIDA = new Set(['OUT', 'OUT_LATE', 'OUT_EARLY', 'OUT_EXTRA', 'OUT_BUSINESS', 'PUNCH_OUT']);

/** Las marcas que el turno espera ese día, con su hora. */
export function marcasEsperadas(dateStr, shift, dayConfig) {
    if (!shift) return [];
    const shiftStart = buildCSTDate(dateStr, shift.start_time?.substring(0, 5) || shift.start);
    const shiftEnd = buildCSTDate(dateStr, shift.end_time?.substring(0, 5) || shift.end);
    const lunchStart = dayConfig?.lunchStart ? buildCSTDate(dateStr, dayConfig.lunchStart) : null;
    // La duración de la pausa es la del HORARIO del día (4 h en la jornada
    // partida), no una hora fija (2026-11-23).
    const minutos = Number(dayConfig?.lunchMinutes ?? shift?.lunch_minutes) || MINUTOS_DE_PAUSA;
    const lunchEnd = lunchStart ? new Date(lunchStart.getTime() + minutos * 60000) : null;
    const partida = minutos > MINUTOS_DE_PAUSA;
    const result = [{ type: 'IN', label: 'Entrada', expected: shiftStart }];
    if (lunchStart) {
        result.push({ type: 'OUT_LUNCH', label: partida ? 'Salida a la pausa' : 'Salida almuerzo', expected: lunchStart });
        result.push({ type: 'IN_LUNCH', label: partida ? 'Regreso de la pausa' : 'Regreso almuerzo', expected: lunchEnd });
    }
    result.push({ type: 'OUT', label: 'Salida', expected: shiftEnd });
    return result;
}

/**
 * El horario de cada persona POR SEMANA, desde las filas publicadas de
 * `employee_rosters` (`employee_id`, `week_start_date`, `schedule_data`).
 *
 * Existe porque la auditoría juzgaba toda la quincena con el horario de la
 * semana EN CURSO (`emp.weeklySchedule`): el martes de la semana pasada se leía
 * con el martes de ésta. Cada día se juzga con el horario de SU semana.
 */
export function indexarHorarios(filas = []) {
    const indice = new Map();
    for (const f of filas || []) indice.set(`${f.employee_id}|${String(f.week_start_date).slice(0, 10)}`, f.schedule_data ?? null);
    return indice;
}

/**
 * El horario de la semana de `dateStr` para una persona. `undefined` si todavía
 * no hay índice (se cae al de la semana en curso); `null` si esa semana no
 * tiene horario publicado.
 */
export function horarioDeLaSemana(indice, empId, dateStr) {
    if (!indice) return undefined;
    return indice.get(`${empId}|${lunesDe(dateStr)}`) ?? null;
}

export function auditarDia({ dateStr, emp, shiftById, timesheets = [], homeBranchId, branchNameById = new Map(), reviewedPunchIds = null, now = new Date(), horario }) {
    const dayD = new Date(dateStr + 'T12:00:00Z');
    const dow = dayD.getUTCDay();
    const isFuture = new Date(`${dateStr}T23:59:59-06:00`) > now;
    const isToday = getCSTDateStr(now) === dateStr;
    // El horario de la semana de ESE día (`horarioDeLaSemana`); sin índice, el
    // de la semana en curso. Domingo es "0", igual que en la tabla (`claveDeDia`).
    const semana = horario !== undefined ? horario : emp.weeklySchedule;
    const dayConfig = semana?.[String(dow)] || semana?.[dow] || null;
    // Si trabaja o no lo decide `resolverTurnoDelDia`, el mismo juez del kiosco
    // y de la planilla: seis formas de «no trabaja», y un día con horas propias
    // y sin turno del catálogo SÍ trabaja.
    const turnos = shiftById ? [...shiftById.values()] : [];
    const turno = resolverTurnoDelDia(dayConfig, turnos);
    const isNoSchedule = !dayConfig;
    const isExplicitOff = !isNoSchedule && !turno.trabaja;
    const shiftId = turno.turnoId && String(turno.turnoId).toUpperCase() !== 'LIBRE' ? String(turno.turnoId) : null;
    const shift = turno.trabaja && shiftId ? (shiftById?.get(shiftId) || null) : null;
    const shiftStart = turno.trabaja ? turno.inicio : null;
    const shiftEnd = turno.trabaja ? turno.fin : null;

    const dayPunches = (emp.attendance || [])
        .filter((p) => getCSTDateStr(p.timestamp) === dateStr)
        .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    const entryPunch = dayPunches.find((p) => TIPOS_DE_ENTRADA.has(p.type));
    const exitPunch = [...dayPunches].reverse().find((p) => TIPOS_DE_SALIDA.has(p.type));
    const lunchOut = dayPunches.find((p) => p.type === 'OUT_LUNCH');
    const lunchIn = dayPunches.find((p) => p.type === 'IN_LUNCH');
    const ts = timesheets.find((t) => String(t.employee_id) === String(emp.id) && t.work_date === dateStr);

    // Sin horario (o libre) pero con marcas o con planilla: NO es un día libre.
    // Antes se pintaba «Día libre» y se escondían las marcas y el «Corregir»,
    // justo en el día que más había que mirar (2026-11-24).
    const trabajoSinHorario = !turno.trabaja && (dayPunches.length > 0 || (!!ts && !ts.is_absent));
    const isOff = !turno.trabaja && !trabajoSinHorario;

    let inconsistencies = [];
    if (turno.trabaja && !isFuture) {
        const punched = new Set(dayPunches.map((p) => p.type));
        const esperado = { start: shiftStart, end: shiftEnd, lunch_minutes: turno.pausa?.minutos ?? shift?.lunch_minutes };
        inconsistencies = marcasEsperadas(dateStr, esperado, dayConfig).filter((ep) => {
            if (ep.type === 'IN') return !dayPunches.some((p) => TIPOS_DE_ENTRADA.has(p.type));
            if (ep.type === 'OUT') return !dayPunches.some((p) => TIPOS_DE_SALIDA.has(p.type));
            return !punched.has(ep.type);
        }).filter((ep) => ep.expected && ep.expected < now);
    }

    const isAutoDay = !!exitPunch && isAutoPunch(exitPunch);
    const isPendDay = dayPunches.some((p) => isPendingPunch(p) && !reviewedPunchIds?.has(p.id));
    const isEditedDay = dayPunches.some((p) => isEditedPunch(p));
    const editedInfo = dayPunches.find((p) => isEditedPunch(p));
    // El kiosco escribe la sala dentro de `details.audit_info`; el modo demo, en `branch_id`.
    const crossBranchPunch = dayPunches.find((p) => {
        const bid = p.details?.audit_info?.branchId ?? p.branch_id;
        return bid && String(bid) !== String(homeBranchId);
    });
    const crossBranchName = crossBranchPunch
        ? (branchNameById.get(String(crossBranchPunch.details?.audit_info?.branchId ?? crossBranchPunch.branch_id)) || 'otra sucursal')
        : null;
    // `??` y no `||` (2026-10-28): el número guardado es el que se paga, y un 0
    // guardado —puntual, o una tardanza que Talento Humano corrigió a cero— es
    // un dato, no un hueco. Con `||` la pantalla lo recalculaba y mostraba una
    // tardanza que la planilla no iba a descontar. Sólo se calcula cuando el
    // día todavía no tiene fila; y la fórmula es la misma del cron.
    const lateMin = ts?.late_minutes ?? minutosDeTardanza(entryPunch?.timestamp, shiftStart ? buildCSTDate(dateStr, shiftStart) : null);

    return {
        dayD, dow, isFuture, isToday, dayConfig, isNoSchedule, isExplicitOff, isOff, trabajoSinHorario, turno, shift, shiftStart, shiftEnd,
        dayPunches, entryPunch, exitPunch, lunchOut, lunchIn, ts, inconsistencies,
        isAutoDay, isPendDay, isEditedDay, editedInfo, crossBranchName, lateMin,
    };
}

/**
 * La quincena de cada persona sumada desde sus timesheets: horas regulares,
 * extra, nocturnas (y extra nocturnas), minutos de tardanza, ausencias y
 * cuántos días están aprobados de cuántos. Era el `quincenaByEmployee` de
 * `AttendanceAuditView`; vive acá para que la app sume con la misma regla.
 * Devuelve un `Map` por `employee_id` (texto) y el total de todas las filas.
 */
export const RESUMEN_VACIO = Object.freeze({ regular: 0, overtime: 0, nocturnal: 0, nocturnalOT: 0, late: 0, absent: 0, approved: 0, total: 0 });
export function resumenDeQuincena(timesheets = []) {
    const porPersona = new Map();
    const total = { ...RESUMEN_VACIO };
    for (const ts of timesheets) {
        const eid = String(ts.employee_id);
        if (!porPersona.has(eid)) porPersona.set(eid, { ...RESUMEN_VACIO });
        for (const acc of [porPersona.get(eid), total]) {
            acc.regular += ts.regular_hours || 0;
            acc.overtime += ts.overtime_hours || 0;
            acc.nocturnal += ts.nocturnal_hours || 0;
            acc.nocturnalOT += ts.nocturnal_overtime_hours || 0;
            acc.late += ts.late_minutes || 0;
            if (ts.is_absent) acc.absent += 1;
            if (ts.status === 'APPROVED') acc.approved += 1;
            acc.total += 1;
        }
    }
    return { porPersona, total };
}

/**
 * Las marcas que se pueden agregar al corregir un día: entrada, salida, salida
 * anticipada y gestión externa siempre; las del almuerzo sólo si el día tiene
 * pausa, y las de lactancia sólo si tiene lactancia. Es la lista del modal del
 * portal (`DayCorrectionModal`) y de la app.
 */
export function tiposDeMarcaParaCorregir(dayConfig) {
    const base = [
        { value: 'IN', label: 'Entrada' },
        { value: 'OUT', label: 'Salida' },
        { value: 'OUT_EARLY', label: 'Salida anticipada' },
        { value: 'OUT_BUSINESS', label: 'Gestión externa' },
    ];
    if (dayConfig?.hasLunch || dayConfig?.lunchStart) {
        base.splice(2, 0,
            { value: 'OUT_LUNCH', label: 'Salida almuerzo' },
            { value: 'IN_LUNCH', label: 'Regreso almuerzo' });
    }
    if (dayConfig?.hasLactation || dayConfig?.lactationStart) {
        base.push(
            { value: 'OUT_LACTATION', label: 'Salida lactancia' },
            { value: 'IN_LACTATION', label: 'Regreso lactancia' });
    }
    return base;
}
