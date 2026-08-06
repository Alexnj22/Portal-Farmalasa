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

// EmployeeDetailView.jsx — tab Solicitudes (solo lectura, historial del empleado)
export function fetchEmployeeApprovalRequestsDetail(employeeId) {
    return supabase.from('approval_requests')
        .select('id, type, status, note, approver_note, created_at, updated_at')
        .eq('employee_id', employeeId)
        .order('created_at', { ascending: false });
}

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

// Quién es "admin" para el enrutador de aprobadores. Estas tres consultaban
// `employees.is_admin`, una columna que NO EXISTE en la base: un `.eq()` contra
// una columna inexistente devuelve error, el llamador lo trata como "no hay
// nadie" y la solicitud se queda SIN APROBADOR. Y son justamente los fallbacks
// del enrutador, o sea el último recurso cuando no hay jefe ni supervisor.
// El criterio correcto es `system_role`, que es el que ya usa el resto del
// código (`WidgetAnnulmentRequest.jsx`): ADMIN y SUPERADMIN.
const ADMIN_SYSTEM_ROLES = ['ADMIN', 'SUPERADMIN'];

export function fetchBranchAdmins(branchId, excludeId) {
    return supabase.from('employees').select('id')
        .eq('branch_id', branchId).in('system_role', ADMIN_SYSTEM_ROLES).eq('status', 'ACTIVO').neq('id', excludeId);
}

export function fetchGlobalAdmins(excludeId) {
    return supabase.from('employees').select('id')
        .in('system_role', ADMIN_SYSTEM_ROLES).eq('status', 'ACTIVO').neq('id', excludeId).limit(1);
}

export function fetchAnyActiveAdmin() {
    return supabase.from('employees').select('id').in('system_role', ADMIN_SYSTEM_ROLES).eq('status', 'ACTIVO').limit(1);
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

// Variante "silenciosa" (sin .select() de vuelta) — usada por
// WidgetAnnulmentRequest.jsx en sus 4 formularios (annul/pay_change/
// vendor_change/client_change): el caller solo chequea { error }, nunca
// lee la fila insertada, así que no se agrega un round-trip extra.
export function insertApprovalRequestSilent(payload) {
    return supabase.from('approval_requests').insert(payload);
}

/**
 * Aplica en el ERP una solicitud de facturación aprobada.
 *
 * El navegador NO habla con el ERP: sus credenciales viven en un secreto de
 * Supabase, y quien tiene esa sesión puede anular cualquier factura de
 * cualquier sucursal. Toda la operación —verificar el permiso, traducir el id
 * del portal al del ERP, escribir, releer para confirmar y recién entonces
 * marcar APPROVED— pasa en la Edge Function.
 *
 * Devuelve `{ ok, aplicado }` o `{ ok:false, error }`. Nunca lanza: el llamador
 * decide qué mostrar.
 */
export async function aplicarSolicitudEnErp(requestId, approverNote = '') {
    try {
        const { data, error } = await supabase.functions.invoke('aplicar-solicitud-facturacion', {
            body: { request_id: requestId, approver_note: approverNote },
        });
        if (!error) return data ?? { ok: false, error: 'El servidor no devolvió respuesta.' };

        // `functions.invoke` marca error para cualquier status >= 400, pero el
        // motivo real viaja en el cuerpo — sin leerlo, todo fallo se ve como
        // un "Edge Function returned a non-2xx status code" indistinguible.
        let detalle = '';
        try { detalle = (await error.context?.json())?.error ?? ''; } catch { /* sin cuerpo legible */ }
        return { ok: false, error: detalle || error.message };
    } catch (e) {
        return { ok: false, error: e?.message || String(e) };
    }
}

/**
 * Aplica una carga o un descarte de inventario aprobado.
 *
 * Mismo reparto que arriba: el navegador no habla con el sistema de origen. Y
 * acá pesa más todavía, porque la sucursal es estado de la sesión de ese
 * sistema — dos aplicaciones simultáneas que compartieran sesión podrían
 * terminar moviendo existencias de la sucursal equivocada. Cada aplicación abre
 * la suya dentro de la Edge Function.
 *
 * Devuelve `{ ok, aplicado }` o `{ ok:false, error }`. Nunca lanza.
 */
export async function aplicarMovimientoInventarioEnErp(requestId, approverNote = '') {
    try {
        const { data, error } = await supabase.functions.invoke('aplicar-movimiento-inventario', {
            body: { request_id: requestId, approver_note: approverNote },
        });
        if (!error) return data ?? { ok: false, error: 'El servidor no devolvió respuesta.' };

        // El motivo real viaja en el cuerpo; sin leerlo todo fallo se ve como
        // un "non-2xx status code" indistinguible.
        let detalle = '';
        try { detalle = (await error.context?.json())?.error ?? ''; } catch { /* sin cuerpo legible */ }
        return { ok: false, error: detalle || error.message };
    } catch (e) {
        return { ok: false, error: e?.message || String(e) };
    }
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
