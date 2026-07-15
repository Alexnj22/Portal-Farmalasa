// Bloque 6.A — capa de datos, entidad "payroll" (planilla, banco de
// horas extra). Extraído de payrollSlice.js: 14 llamadas supabase.from().
import { supabase } from '../supabaseClient';

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

export function deletePendingPayrollEntries(periodId) {
    return supabase.from('payroll_entries').delete().eq('period_id', periodId).eq('status', 'PENDING');
}

export function insertPayrollEntries(rows) {
    return supabase.from('payroll_entries').insert(rows);
}

export function updatePayrollEntry(entryId, patch) {
    return supabase.from('payroll_entries').update(patch).eq('id', entryId);
}

// ── Insumos para generar planilla (timesheets, anticipos, vacaciones) ──────

export function fetchTimesheetsForPeriod(startDate, endDate) {
    return supabase.from('timesheets')
        .select('employee_id, is_absent, work_date, nocturnal_hours, nocturnal_overtime_hours, overtime_hours')
        .gte('work_date', startDate)
        .lte('work_date', endDate);
}

export function fetchApprovedAdvances(startDate, endDateIso) {
    return supabase.from('approval_requests')
        .select('employee_id, metadata')
        .eq('type', 'ADVANCE')
        .eq('status', 'APPROVED')
        .gte('created_at', startDate)
        .lte('created_at', endDateIso);
}

export function fetchVacationPlansOverlapping(periodEndDate, periodStartDate) {
    return supabase.from('vacation_plans')
        .select('employee_id, start_date, end_date')
        .in('status', ['CONFIRMED', 'APPROVED', 'TAKEN'])
        .lte('start_date', periodEndDate)
        .gte('end_date', periodStartDate);
}

// ── Banco de horas extra ─────────────────────────────────────────────────────

export function fetchOvertimeBankRows(employeeId) {
    return supabase.from('overtime_bank').select('hours, type').eq('employee_id', employeeId);
}

export function deleteEarnedOvertimeBank(periodId) {
    return supabase.from('overtime_bank').delete().eq('period_id', periodId).eq('type', 'EARNED');
}

export function insertOvertimeBank(rowOrRows) {
    return supabase.from('overtime_bank').insert(rowOrRows);
}
