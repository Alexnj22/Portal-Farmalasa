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
    const lunchEnd = lunchStart ? new Date(lunchStart.getTime() + 3600000) : null;
    const result = [{ type: 'IN', label: 'Entrada', expected: shiftStart }];
    if (lunchStart) {
        result.push({ type: 'OUT_LUNCH', label: 'Salida almuerzo', expected: lunchStart });
        result.push({ type: 'IN_LUNCH', label: 'Regreso almuerzo', expected: lunchEnd });
    }
    result.push({ type: 'OUT', label: 'Salida', expected: shiftEnd });
    return result;
}

export function auditarDia({ dateStr, emp, shiftById, timesheets = [], homeBranchId, branchNameById = new Map(), reviewedPunchIds = null, now = new Date() }) {
    const dayD = new Date(dateStr + 'T12:00:00Z');
    const dow = dayD.getUTCDay();
    const isFuture = new Date(`${dateStr}T23:59:59-06:00`) > now;
    const isToday = getCSTDateStr(now) === dateStr;
    // Domingo es "0", igual que en la tabla (ver `claveDeDia`).
    const dayConfig = emp.weeklySchedule?.[String(dow)] || emp.weeklySchedule?.[dow];
    const isNoSchedule = !dayConfig;
    const isExplicitOff = !isNoSchedule && (dayConfig.isOff || dayConfig.isOffDay || dayConfig.shiftId === 'LIBRE');
    const isOff = isNoSchedule || isExplicitOff;
    const shiftId = dayConfig?.shiftId && dayConfig.shiftId !== 'LIBRE' ? String(dayConfig.shiftId) : null;
    const shift = shiftId ? shiftById.get(shiftId) : null;
    const shiftStart = dayConfig?.customStart || shift?.start_time?.substring(0, 5) || shift?.start;
    const shiftEnd = dayConfig?.customEnd || shift?.end_time?.substring(0, 5) || shift?.end;

    const dayPunches = (emp.attendance || [])
        .filter((p) => getCSTDateStr(p.timestamp) === dateStr)
        .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    const entryPunch = dayPunches.find((p) => TIPOS_DE_ENTRADA.has(p.type));
    const exitPunch = [...dayPunches].reverse().find((p) => TIPOS_DE_SALIDA.has(p.type));
    const lunchOut = dayPunches.find((p) => p.type === 'OUT_LUNCH');
    const lunchIn = dayPunches.find((p) => p.type === 'IN_LUNCH');
    const ts = timesheets.find((t) => String(t.employee_id) === String(emp.id) && t.work_date === dateStr);

    let inconsistencies = [];
    if (!(isOff || isFuture || !shift)) {
        const punched = new Set(dayPunches.map((p) => p.type));
        inconsistencies = marcasEsperadas(dateStr, shift, dayConfig).filter((ep) => {
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
    // El `||` y no `??` es deliberado (ver la auditoría del 2026-08-23): con
    // `late_minutes` en 0 se recalcula, y las dos fórmulas dan lo mismo.
    const lateMin = ts?.late_minutes || minutosDeTardanza(entryPunch?.timestamp, shiftStart ? buildCSTDate(dateStr, shiftStart) : null);

    return {
        dayD, dow, isFuture, isToday, dayConfig, isNoSchedule, isExplicitOff, isOff, shift, shiftStart, shiftEnd,
        dayPunches, entryPunch, exitPunch, lunchOut, lunchIn, ts, inconsistencies,
        isAutoDay, isPendDay, isEditedDay, editedInfo, crossBranchName, lateMin,
    };
}
