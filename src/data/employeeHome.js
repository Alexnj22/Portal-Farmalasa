// Bloque 6.A — capa de datos para EmployeeHomeView.jsx (self-service:
// solicitudes propias, tardanzas, eventos, horario semanal). 8 llamadas
// supabase.from() — 2 de los 8 reutilizan fetchEmployeeRosterSchedule
// (data/employees.js) y fetchRostersForWeekByEmployees (data/requests.js),
// mismo query exacto, no se duplican.
import { supabase } from '../supabaseClient';

export function fetchMyPendingRequestsCount(employeeId) {
    return supabase.from('approval_requests')
        .select('id', { count: 'exact', head: true })
        .eq('employee_id', employeeId).eq('status', 'PENDING');
}

export function fetchMyLateAttendance(employeeId, firstDay, lastDay) {
    return supabase.from('attendance')
        .select('id, late_minutes')
        .eq('employee_id', employeeId).eq('late', true)
        .gte('date', firstDay).lte('date', lastDay);
}

export function fetchMyActiveEvents(employeeId) {
    return supabase.from('employee_events')
        .select('id, type, date, metadata')
        .eq('employee_id', employeeId)
        .in('type', ['VACATION', 'DISABILITY', 'PERMIT']);
}

export function fetchMyUpcomingEvents(employeeId, todayStr) {
    return supabase.from('employee_events')
        .select('id, type, date, metadata')
        .eq('employee_id', employeeId)
        .in('type', ['VACATION', 'DISABILITY', 'PERMIT', 'BIRTHDAY'])
        .gte('date', todayStr).order('date', { ascending: true }).limit(5);
}

export function fetchMyWeekEvents(employeeId, weekEndIso) {
    return supabase.from('employee_events')
        .select('type, date, metadata')
        .eq('employee_id', employeeId)
        .in('type', ['VACATION', 'DISABILITY', 'PERMIT'])
        .lte('date', weekEndIso);
}

export function fetchMyVacationPlans(employeeId) {
    return supabase.from('vacation_plans')
        .select('id, year, start_date, end_date, days, status')
        .eq('employee_id', employeeId)
        .neq('status', 'CANCELLED')
        .order('start_date', { ascending: true });
}
