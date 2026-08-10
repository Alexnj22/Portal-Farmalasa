// Bloque 6.A — capa de datos, entidad "permissions" (roles y
// role_permissions). Extraído de PermissionsView.jsx: 10 llamadas
// supabase.from().
import { supabase } from '../supabaseClient';
import { fetchAllRows } from '../utils/supabaseUtils';

export function fetchRolesForPermissions() {
    return supabase.from('roles').select('id, name, parent_role_id, max_price_level, is_su').order('id');
}

// TODAS las filas de TODOS los cargos: es la que alimenta la pantalla de
// Permisos, así que un corte silencioso ahí le apaga permisos a cargos enteros
// EN PANTALLA aunque en la base estén puestos.
//
// Pasó el 2026-08-10: la tabla cruzó las 1,000 filas (1,293) y «Regente de
// Enfermería» pasó a mostrar 7 de 74 módulos cuando en la base tenía 14. El
// usuario lo leyó como «copiar de no funciona» — y la copia funcionaba: lo que
// fallaba era la RELECTURA. Sin `order by`, PostgREST devuelve las primeras
// 1,000 en orden físico, así que ni siquiera se cae siempre el mismo cargo.
//
// Devuelve la misma forma `{ data, error }` que un `.select()` para no tocar a
// quien la llama.
export async function fetchRolePermissions() {
    const data = await fetchAllRows(() => supabase.from('role_permissions')
        .select('role_id, module_key, can_view, can_edit, can_approve, scope')
        .not('role_id', 'is', null)
        .order('role_id')
        .order('module_key'));
    return { data, error: data === null ? new Error('No se pudieron leer los permisos') : null };
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
