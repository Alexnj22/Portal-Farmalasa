// Bloque 6.A — capa de datos, entidad "requests" (solicitudes de
// empleado + resolución de aprobador). Extraído de requestsSlice.js: 36
// llamadas supabase.from(). Este archivo enruta aprobaciones subiendo
// recursivamente por la jerarquía de roles — cada función de lookup de
// empleados se dejó separada aun cuando se parecen, porque difieren en
// qué filtros son condicionales vs. fijos (cambiar eso sería alterar el
// comportamiento de enrutamiento, no solo mover el query). employee_rosters
// (lectura puntual + upsert) reutiliza fetchEmployeeRosterSchedule/
// upsertWeeklyRoster ya definidos en data/employees.js y data/system.js.
import { supabase } from '../supabaseClient';

export const REQUEST_SIMPLE_SELECT = 'id, type, status, note, metadata, approver_note, created_at, updated_at, employee_id, approver_id, current_level, approvals';

// ── Disponibilidad del empleado (vacaciones/incapacidad vigentes) ──────────

export function fetchEmployeeAvailabilityEvents(employeeId) {
    return supabase.from('employee_events')
        .select('date, metadata')
        .eq('employee_id', employeeId)
        .in('type', ['VACATION', 'DISABILITY'])
        .lte('date', new Date().toISOString().split('T')[0]);
}

// ── Roles / candidatos a aprobador ──────────────────────────────────────────

export function fetchAllRolesHierarchy() {
    return supabase.from('roles').select('id, name, parent_role_id, secondary_parent_role_id');
}

export function fetchRolesByNamePattern(namePattern) {
    return supabase.from('roles').select('id').ilike('name', `%${namePattern}%`);
}

// Filtros fijos (branch_id siempre aplica) — usado por resolveApprover subiendo la jerarquía.
export function fetchActiveEmployeesInRoleAndBranch(roleId, branchId, excludeId) {
    return supabase.from('employees').select('id')
        .eq('role_id', roleId).eq('branch_id', branchId).eq('status', 'ACTIVO').neq('id', excludeId);
}

export function fetchBranchAdmins(branchId, excludeId) {
    return supabase.from('employees').select('id')
        .eq('branch_id', branchId).eq('is_admin', true).eq('status', 'ACTIVO').neq('id', excludeId);
}

export function fetchGlobalAdmins(excludeId) {
    return supabase.from('employees').select('id')
        .eq('is_admin', true).eq('status', 'ACTIVO').neq('id', excludeId).limit(1);
}

export function fetchAnyActiveAdmin() {
    return supabase.from('employees').select('id').eq('is_admin', true).eq('status', 'ACTIVO').limit(1);
}

export function fetchApprovalRolePermissions() {
    return supabase.from('role_permissions').select('role_id').eq('module_key', 'requests').eq('can_approve', true);
}

export function fetchActiveEmployeesInRoles(roleIds, excludeId) {
    return supabase.from('employees').select('id').in('role_id', roleIds).eq('status', 'ACTIVO').neq('id', excludeId).limit(1);
}

// Filtros condicionales (branch_id/excludeId solo si aplican) — usado por
// resolveNextApprover, donde sameBranch/excludeId varían según el nivel.
export function fetchActiveEmployeesBySystemRoleConditional(systemRole, branchId, excludeId, sameBranch) {
    let q = supabase.from('employees').select('id').eq('system_role', systemRole).eq('status', 'ACTIVO');
    if (sameBranch && branchId) q = q.eq('branch_id', branchId);
    if (excludeId) q = q.neq('id', excludeId);
    return q;
}

export function fetchActiveEmployeesByRoleIdConditional(roleId, branchId, excludeId, sameBranch) {
    let q = supabase.from('employees').select('id').eq('role_id', roleId).eq('status', 'ACTIVO');
    if (sameBranch && branchId) q = q.eq('branch_id', branchId);
    if (excludeId) q = q.neq('id', excludeId);
    return q;
}

// ── Cobertura de sucursal (empleados/rosters) ───────────────────────────────

export function fetchActiveBranchEmployeesExcluding(branchId, excludeId) {
    return supabase.from('employees').select('id').eq('branch_id', branchId).eq('status', 'ACTIVO').neq('id', excludeId);
}

export function fetchRostersForWeekByEmployees(weekStart, employeeIds) {
    return supabase.from('employee_rosters').select('employee_id, schedule_data').eq('week_start_date', weekStart).in('employee_id', employeeIds);
}

// ── fetchRequests ────────────────────────────────────────────────────────────

export function fetchBranchActiveEmployeeIds(branchId) {
    return supabase.from('employees').select('id').eq('branch_id', branchId).eq('status', 'ACTIVO');
}

export function fetchApprovalRequestsList({ employeeId, branchEmpIds, approverId }) {
    let q = supabase.from('approval_requests').select(REQUEST_SIMPLE_SELECT).order('created_at', { ascending: false });
    if (employeeId) q = q.eq('employee_id', employeeId);
    if (branchEmpIds && branchEmpIds.length > 0) q = q.in('employee_id', branchEmpIds);
    if (approverId) q = q.or(`approver_id.eq.${approverId},approver_id.is.null`);
    return q;
}

export function fetchEmployeesByIds(ids, columns) {
    return supabase.from('employees').select(columns).in('id', ids);
}

// ── createRequest ────────────────────────────────────────────────────────────

export function fetchEmployeeApprovalInfo(employeeId) {
    return supabase.from('employees').select('role_id, branch_id').eq('id', employeeId).single();
}

export function fetchEmployeeName(employeeId) {
    return supabase.from('employees').select('name').eq('id', employeeId).single();
}

export function insertApprovalRequest(payload) {
    return supabase.from('approval_requests').insert([payload]).select(REQUEST_SIMPLE_SELECT).single();
}

// ── approve/reject/cancel ────────────────────────────────────────────────────

export function updateApprovalRequest(requestId, patch) {
    return supabase.from('approval_requests').update(patch).eq('id', requestId);
}

export function fetchApprovalRequestById(requestId) {
    return supabase.from('approval_requests').select(REQUEST_SIMPLE_SELECT).eq('id', requestId).single();
}

export function fetchEmployeeSystemRole(employeeId) {
    return supabase.from('employees').select('system_role').eq('id', employeeId).maybeSingle();
}

// ── SHIFT_CHANGE: patch de rosters publicados en la aprobación final ───────

export function fetchShiftsBasic() {
    return supabase.from('shifts').select('id, start_time, end_time');
}

export function fetchPublishedRostersForSwap(employeeIds, weekStart) {
    return supabase.from('employee_rosters')
        .select('id, employee_id, schedule_data')
        .in('employee_id', employeeIds)
        .eq('week_start_date', weekStart)
        .eq('status', 'PUBLISHED');
}

export function updateEmployeeRosterById(rosterId, patch) {
    return supabase.from('employee_rosters').update(patch).eq('id', rosterId);
}
