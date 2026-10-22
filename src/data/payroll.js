// Bloque 6.A — capa de datos, entidad "payroll" (planilla, banco de
// horas extra). Extraído de payrollSlice.js: 14 llamadas supabase.from().
import { supabase } from '../supabaseClient';
import { fetchAllRows } from '../utils/supabaseUtils';
import { sumarDias } from '../utils/fecha';

// ── Períodos ─────────────────────────────────────────────────────────────────

export function fetchPayrollPeriods() {
    return supabase.from('payroll_periods').select('*').order('start_date', { ascending: false });
}

export function insertPayrollPeriod(payload) {
    return supabase.from('payroll_periods').insert([payload]).select().single();
}

export function updatePayrollPeriod(periodId, patch) {
    return supabase.from('payroll_periods').update(patch).eq('id', periodId);
}

// ── Entradas de planilla ─────────────────────────────────────────────────────

export function fetchPayrollEntriesByPeriod(periodId) {
    return supabase.from('payroll_entries').select('*').eq('period_id', periodId).order('created_at', { ascending: true });
}

// Con `employeeIds` borra sólo los renglones de esas personas. Generar la
// planilla filtrada por sucursal borraba los PENDING de TODA la red y
// reinsertaba sólo los de esa sucursal (auditoría 2026-10-21).
export function deletePendingPayrollEntries(periodId, employeeIds = null) {
    let q = supabase.from('payroll_entries').delete().eq('period_id', periodId).eq('status', 'PENDING');
    if (employeeIds) q = q.in('employee_id', employeeIds);
    return q;
}

// Quiénes ya tienen un renglón que NO se regenera (EDITED u otro estado): el
// insert de la regeneración los saltea, o choca con UNIQUE (period_id,
// employee_id) y falla entero. Un renglón por persona: muy por debajo de 1000.
export function fetchPayrollEntriesNoRegenerables(periodId) {
    return supabase.from('payroll_entries')
        .select('employee_id')
        .eq('period_id', periodId)
        .neq('status', 'PENDING')
        .order('employee_id')
        .range(0, 1999);
}

export function insertPayrollEntries(rows) {
    return supabase.from('payroll_entries').insert(rows);
}

export function updatePayrollEntry(entryId, patch) {
    return supabase.from('payroll_entries').update(patch).eq('id', entryId);
}

// ── Insumos para generar planilla (timesheets, anticipos, vacaciones) ──────

// Paginadas (auditoría 2026-10-21): una quincena de la red son ~50 personas ×
// 16 días = ~800 timesheets, al borde del techo de 1000 que corta en silencio.
// Con `completo: true` una página que falla da error, no una planilla a medias.
async function todasOError(armar) {
    const filas = await fetchAllRows(armar, { completo: true });
    return filas ? { data: filas, error: null } : { data: null, error: new Error('la lectura quedó incompleta') };
}

export function fetchTimesheetsForPeriod(startDate, endDate) {
    return todasOError(() => supabase.from('timesheets')
        .select('id, employee_id, is_absent, absence_type, work_date, nocturnal_hours, nocturnal_overtime_hours, overtime_hours')
        .gte('work_date', startDate)
        .lte('work_date', endDate)
        .order('work_date').order('id'));
}

// Los CANDIDATOS a descontarse en la quincena: el día exacto de aprobación se
// decide en `anticiposDeLaQuincena` (núcleo), que lo lee de `approvals`. Acá
// sólo se acota sin perder ninguno: la aprobación pasa después de pedirlo
// (`created_at` ≤ fin) y `updated_at` nunca queda antes de la aprobación
// (`updated_at` ≥ inicio, ver abajo). Bordes con el huso de El Salvador: sin huso se leen
// en UTC (auditoría 2026-10-21, H5).
//
// Con los REZAGADOS (aprobados en una quincena ya cerrada sin descontarse) la
// ventana mira 90 días hacia atrás; `anticiposDeLaQuincena` decide cuáles pasan.
export function fetchApprovedAdvances(startDate, endDate) {
    return todasOError(() => supabase.from('approval_requests')
        .select('id, employee_id, status, metadata, approvals, updated_at')
        .eq('type', 'ADVANCE')
        .eq('status', 'APPROVED')
        .lte('created_at', `${endDate}T23:59:59.999-06:00`)
        .gte('updated_at', `${sumarDias(startDate, -90)}T00:00:00-06:00`)
        .order('created_at').order('id'));
}

// ── Incapacidades y bajas que tocan la quincena (2026-10-22) ────────────────
// La incapacidad más larga es la de maternidad (112 días, Art. 309): 200 días
// hacia atrás alcanzan para ver una que empezó antes y sigue en la quincena.
// Paginadas: `type` se repite, acotar por tipo no acota la respuesta.

/** Novedades DISABILITY, SUSPENSION y TERMINATION del legajo que pueden caer en la quincena. */
export function fetchNovedadesParaPlanilla(startDate, endDate) {
    return todasOError(() => supabase.from('employee_events')
        .select('id, employee_id, type, date, metadata')
        .in('type', ['DISABILITY', 'SUSPENSION', 'TERMINATION'])
        .gte('date', sumarDias(startDate, -200))
        .lte('date', endDate)
        .order('date').order('id'));
}

/** Solicitudes de incapacidad aprobadas o todavía sin decisión. */
export function fetchSolicitudesDeIncapacidad(startDate, endDate) {
    return todasOError(() => supabase.from('approval_requests')
        .select('id, employee_id, type, status, metadata')
        .eq('type', 'DISABILITY')
        .or('status.eq.APPROVED,status.eq.PENDING')   // paginada: ver todasOError
        .gte('created_at', `${sumarDias(startDate, -200)}T00:00:00-06:00`)
        .lte('created_at', `${endDate}T23:59:59.999-06:00`)
        .order('created_at').order('id'));
}

/**
 * Renglones del período con días que esperan a Talento Humano (incapacidad sin
 * validar o suspensión sin decidir el descuento). Aprobar la planilla se frena
 * mientras haya alguno. Un renglón por persona: muy por debajo de 1000.
 */
export function fetchRenglonesPendientesDeTH(periodId) {
    return supabase.from('payroll_entries')
        .select('employee_id, incapacidad_pendiente_dias, suspension_pendiente_dias')
        .eq('period_id', periodId)
        .or('incapacidad_pendiente_dias.gt.0,suspension_pendiente_dias.gt.0')
        .order('employee_id')
        .range(0, 1999);
}

/** Refresca sólo las marcas de «pendiente de Talento Humano» de un renglón editado. */
export function updatePendientesDeTH(periodId, employeeId, { incapacidad, suspension }) {
    return supabase.from('payroll_entries')
        .update({ incapacidad_pendiente_dias: incapacidad, suspension_pendiente_dias: suspension })
        .eq('period_id', periodId).eq('employee_id', employeeId);
}

// ── Anticipos ya descontados (una sola vez por anticipo) ────────────────────
// `anticipos_en_planilla` guarda en qué período entró cada anticipo; su UNIQUE
// sobre `request_id` es el freno real contra descontarlo dos veces.

/** En qué período se descontó cada una de estas solicitudes. */
export async function fetchAnticiposYaDescontados(requestIds) {
    const ids = [...new Set((requestIds || []).map(String))];
    if (!ids.length) return { data: [], error: null };
    const tandas = [];
    for (let i = 0; i < ids.length; i += 200) tandas.push(ids.slice(i, i + 200));
    // request_id es UNIQUE: cada id trae a lo sumo una fila, la tanda acota la respuesta.
    const res = await Promise.all(tandas.map(t => supabase.from('anticipos_en_planilla')
        .select('request_id, period_id').in('request_id', t)));
    const err = res.find(r => r.error)?.error;
    if (err) return { data: null, error: err };
    return { data: res.flatMap(r => r.data || []), error: null };
}

/** Suelta los anticipos que este período ligó a estas personas (al regenerar sus renglones). */
export function deleteAnticiposDelPeriodo(periodId, employeeIds) {
    return supabase.from('anticipos_en_planilla').delete()
        .eq('period_id', periodId).in('employee_id', employeeIds);
}

export function insertAnticiposEnPlanilla(rows) {
    return supabase.from('anticipos_en_planilla').insert(rows);
}

export function fetchVacationPlansOverlapping(periodEndDate, periodStartDate) {
    return supabase.from('vacation_plans')
        .select('employee_id, start_date, end_date')
        .in('status', ['CONFIRMED', 'APPROVED', 'TAKEN'])
        .lte('start_date', periodEndDate)
        .gte('end_date', periodStartDate);
}

// ── Banco de horas extra ─────────────────────────────────────────────────────

// select incluye subtype (usado por FormEditPayrollEntry.jsx para separar
// diurno/nocturno) — payrollSlice.js solo lee hours/type, columna extra inerte.
export function fetchOvertimeBankRows(employeeId) {
    return supabase.from('overtime_bank').select('hours, type, subtype').eq('employee_id', employeeId);
}

// ── PayrollView.jsx (aviso de timesheets sin aprobar en el período activo) ──

export function fetchUnapprovedTimesheetsCount(startDate, endDate) {
    return supabase.from('timesheets')
        .select('id', { count: 'exact', head: true })
        .gte('work_date', startDate)
        .lte('work_date', endDate)
        .neq('status', 'APPROVED');
}

// Con `employeeIds`, sólo el banco de esas personas (ver deletePendingPayrollEntries).
export function deleteEarnedOvertimeBank(periodId, employeeIds = null) {
    let q = supabase.from('overtime_bank').delete().eq('period_id', periodId).eq('type', 'EARNED');
    if (employeeIds) q = q.in('employee_id', employeeIds);
    return q;
}

export function insertOvertimeBank(rowOrRows) {
    return supabase.from('overtime_bank').insert(rowOrRows);
}
