// Bloque 6.A — capa de datos, entidad "employeeSelfService" (vistas de
// autoservicio del empleado: Mis Solicitudes + Mi Horario). Extraído de
// EmployeeRequestsView.jsx (6 llamadas) y EmployeeScheduleView.jsx
// (6 llamadas). 2 sitios de cada archivo reutilizan updateApprovalRequest/
// insertApprovalRequest (data/requests.js) y updateVacationPlan
// (data/vacationPlans.js) ya existentes.
import { supabase } from '../supabaseClient';
import { fetchAllRows } from '../utils/supabaseUtils';

// ── Solicitudes propias ──────────────────────────────────────────────────────
//
// Acá vivían cuatro consultas más —las propias, los cambios de turno donde uno
// es el compañero, los Min/Max propios y los nombres de quienes piden—, todas
// de `EmployeeRequestsView`. Esa vista se fusionó con «Solicitudes Personales»
// el 2026-08-11 y las cuatro se fueron con ella: la vista unificada usa
// `fetchApprovalRequestsList` con el criterio `soloMiasId`, que hace las dos
// primeras en UNA consulta, y `fetchAllMinMaxChangeRequests` para la tercera.
// Los nombres ya los trae el enriquecido de `fetchRequests`.
//
// `fetchOwnApprovalRequests` se queda: la usa «Mis Documentos», que no tiene
// nada que ver con esto.

// El historial propio, que sólo crece: paginado y con orden total. El llamador
// se queda después con las que tienen archivo adjunto, así que un corte en 1000
// escondería documentos sin decir nada. Devuelve el ARRAY, o `null` si falló la
// primera página.
export function fetchOwnApprovalRequests(employeeId) {
    return fetchAllRows(() => supabase.from('approval_requests')
        .select('id, type, status, note, approver_note, created_at, current_level, metadata')
        .eq('employee_id', employeeId)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false }));
}

export function fetchEmployeeEventsByTypes(employeeId) {
    return supabase.from('employee_events')
        .select('type, date, metadata')
        .eq('employee_id', employeeId)
        .in('type', ['DISABILITY', 'PERMIT', 'VACATION']);
}

// ── EmployeeScheduleView.jsx ─────────────────────────────────────────────────





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
