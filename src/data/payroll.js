// Bloque 6.A — capa de datos, entidad "payroll" (planilla, banco de
// horas extra). Extraído de payrollSlice.js: 14 llamadas supabase.from().
import { supabase } from '../supabaseClient';
import { fetchAllRows } from '../utils/supabaseUtils';

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
        .select('id, employee_id, is_absent, work_date, nocturnal_hours, nocturnal_overtime_hours, overtime_hours')
        .gte('work_date', startDate)
        .lte('work_date', endDate)
        .order('work_date').order('id'));
}

// Los bordes van con el huso de El Salvador: `'2026-10-15T23:59:59'` sin huso
// se lee en UTC, y un anticipo pedido el 15 a las 19:00 de la sala caía en la
// quincena siguiente (auditoría 2026-10-21).
export function fetchApprovedAdvances(startDate, endDate) {
    return todasOError(() => supabase.from('approval_requests')
        .select('id, employee_id, metadata')
        .eq('type', 'ADVANCE')
        .eq('status', 'APPROVED')
        .gte('created_at', `${startDate}T00:00:00-06:00`)
        .lte('created_at', `${endDate}T23:59:59.999-06:00`)
        .order('created_at').order('id'));
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
