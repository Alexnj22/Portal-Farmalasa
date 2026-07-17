// Bloque 6.A — capa de datos, entidad "permissions" (roles y
// role_permissions). Extraído de PermissionsView.jsx: 10 llamadas
// supabase.from().
import { supabase } from '../supabaseClient';

export function fetchRolesForPermissions() {
    return supabase.from('roles').select('id, name, parent_role_id, max_price_level, is_su').order('id');
}

export function fetchRolePermissions() {
    return supabase.from('role_permissions')
        .select('role_id, module_key, can_view, can_edit, can_approve, scope')
        .not('role_id', 'is', null);
}

export function upsertRolePermission(row) {
    return supabase.from('role_permissions').upsert(row, { onConflict: 'role_id,module_key', ignoreDuplicates: false });
}

export function upsertRolePermissionsBulk(rows) {
    return supabase.from('role_permissions').upsert(rows, { onConflict: 'role_id,module_key', ignoreDuplicates: false });
}

export function updateRoleMaxPriceLevel(roleId, level) {
    return supabase.from('roles').update({ max_price_level: level }).eq('id', roleId);
}

export function updateRoleIsSU(roleId, value) {
    return supabase.from('roles').update({ is_su: value }).eq('id', roleId);
}

// ── AuthContext.jsx (2 de sus 3 sitios — refreshPermissions) ────────────────

export function fetchRolePermissionsForRole(roleId) {
    return supabase.from('role_permissions')
        .select('module_key, can_view, can_edit, can_approve, scope')
        .eq('role_id', roleId);
}

// Bloque 8 — cargo secundario suma permisos (modelo de unión). Trae las filas
// de role_permissions de varios role_id a la vez (primario + secundario);
// el merge por module_key (OR de acciones, scope más permisivo) lo hace el caller.
export function fetchRolePermissionsForRoles(roleIds) {
    return supabase.from('role_permissions')
        .select('role_id, module_key, can_view, can_edit, can_approve, scope')
        .in('role_id', roleIds);
}

export function fetchRolePriceLevelAndSU(roleId) {
    return supabase.from('roles').select('max_price_level, is_su').eq('id', roleId).single();
}

// ── NoAccessView.jsx / AccessDeniedView.jsx (nombre de cargo a mostrar) ─────

export function fetchRoleName(roleId) {
    return supabase.from('roles').select('name').eq('id', roleId).single();
}
