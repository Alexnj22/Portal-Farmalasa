// Bloque 6.A — capa de datos, entidad "attendanceAudit" (auditoría de
// tiempos: timesheets, excepciones de turno). Extraído de
// AttendanceAuditView.jsx: 8 llamadas supabase.from(). 3 de los 8 sitios
// reutilizan funciones ya definidas en data/employees.js y data/requests.js
// (mismo query exacto): updateAttendancePunch, updateEmployee,
// updateApprovalRequest.
import { supabase } from '../supabaseClient';
import { fetchAllRows } from '../utils/supabaseUtils';

// El llamador se queda con las de la quincena filtrando por `metadata.date`,
// que es jsonb y no se puede filtrar en la base — o sea que el recorte pasa
// DESPUÉS. Sin paginar, un corte en 1000 se llevaría filas al azar y la
// quincena saldría incompleta sin una sola señal. Devuelve el ARRAY, o `null`
// si falló la primera página.
export function fetchPendingShiftExceptions() {
    return fetchAllRows(() => supabase.from('approval_requests')
        .select('id, employee_id, status, note, metadata, created_at')
        .eq('type', 'SHIFT_EXCEPTION')
        .eq('status', 'PENDING')
        .order('id', { ascending: true }));
}

export function fetchQuincenaTimesheets(startDate, endDate) {
    return supabase.from('timesheets')
        .select('id, employee_id, work_date, regular_hours, overtime_hours, late_minutes, is_absent, status, nocturnal_hours, nocturnal_overtime_hours, absence_type')
        .gte('work_date', startDate).lte('work_date', endDate);
}

export function approveTimesheetsBulk(ids, approverId) {
    return supabase.from('timesheets')
        .update({ status: 'APPROVED', approver_id: approverId, updated_at: new Date().toISOString() })
        .in('id', ids);
}

export function closeQuincenaTimesheets(ids) {
    return supabase.from('timesheets').update({ status: 'APPROVED' }).in('id', ids);
}

export function fetchEmployeeExceptions(employeeId) {
    return supabase.from('employees').select('id, exceptions').eq('id', employeeId).single();
}
