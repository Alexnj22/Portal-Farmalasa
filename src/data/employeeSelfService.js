// Bloque 6.A — capa de datos, entidad "employeeSelfService" (vistas de
// autoservicio del empleado: Mis Solicitudes + Mi Horario). Extraído de
// EmployeeRequestsView.jsx (6 llamadas) y EmployeeScheduleView.jsx
// (6 llamadas). 2 sitios de cada archivo reutilizan updateApprovalRequest/
// insertApprovalRequest (data/requests.js) y updateVacationPlan
// (data/vacationPlans.js) ya existentes.
import { supabase } from '../supabaseClient';

// ── EmployeeRequestsView.jsx ─────────────────────────────────────────────────

export function fetchOwnApprovalRequests(employeeId) {
    return supabase.from('approval_requests')
        .select('id, type, status, note, approver_note, created_at, current_level, metadata')
        .eq('employee_id', employeeId)
        .order('created_at', { ascending: false });
}

export function fetchPendingShiftChangeRequestsForApprover(approverId) {
    return supabase.from('approval_requests')
        .select('id, type, status, note, metadata, created_at, employee_id')
        .eq('approver_id', approverId)
        .eq('type', 'SHIFT_CHANGE')
        .eq('status', 'PENDING');
}

export function fetchOwnMinMaxChangeRequests(userId) {
    return supabase.from('minmax_change_requests')
        .select('*')
        .eq('requested_by_id', userId)
        .order('requested_at', { ascending: false })
        .limit(200);
}

export function fetchEmployeeNamesByIds(empIds) {
    return supabase.from('employees').select('id, name').in('id', empIds);
}

export function fetchEmployeeEventsByTypes(employeeId) {
    return supabase.from('employee_events')
        .select('type, date, metadata')
        .eq('employee_id', employeeId)
        .in('type', ['DISABILITY', 'PERMIT', 'VACATION']);
}

// ── EmployeeScheduleView.jsx ─────────────────────────────────────────────────

export function fetchPublishedRosterForWeek(employeeId, weekStartDate) {
    return supabase.from('employee_rosters')
        .select('schedule_data')
        .eq('employee_id', employeeId)
        .eq('week_start_date', weekStartDate)
        .eq('status', 'PUBLISHED')
        .maybeSingle();
}

export function fetchEmployeeEventsByTypesUntil(employeeId, untilDateIso) {
    return supabase.from('employee_events')
        .select('type, date, metadata')
        .eq('employee_id', employeeId)
        .in('type', ['VACATION', 'DISABILITY', 'PERMIT'])
        .lte('date', untilDateIso);
}

export function fetchMyVacationPlansMultiYear(employeeId, years) {
    return supabase.from('vacation_plans')
        .select('id, year, start_date, end_date, days, status, notes, change_requested_start, change_requested_end')
        .eq('employee_id', employeeId)
        .in('status', ['PRE_APPROVED', 'CHANGE_REQUESTED', 'APPROVED', 'CONFIRMED', 'PLANNED'])
        .in('year', years)
        .order('year', { ascending: true });
}

export function fetchPendingVacationChangeRequest(employeeId) {
    return supabase.from('approval_requests')
        .select('id, status, metadata, created_at')
        .eq('employee_id', employeeId)
        .eq('type', 'VACATION_CHANGE')
        .eq('status', 'PENDING')
        .maybeSingle();
}

// ── EmployeeProfileView.jsx ──────────────────────────────────────────────────

export function fetchOwnEventsFull(employeeId) {
    return supabase.from('employee_events')
        .select('id, type, date, note, metadata')
        .eq('employee_id', employeeId)
        .order('date', { ascending: false });
}

export function fetchOwnPendingRequestsCount(employeeId) {
    return supabase.from('approval_requests')
        .select('id', { count: 'exact', head: true })
        .eq('employee_id', employeeId)
        .eq('status', 'PENDING');
}

export function fetchOwnVacationPlansActive(employeeId) {
    return supabase.from('vacation_plans')
        .select('id, year, start_date, end_date, days, status')
        .eq('employee_id', employeeId)
        .neq('status', 'CANCELLED')
        .order('start_date', { ascending: false });
}
