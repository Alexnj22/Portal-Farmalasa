// Bloque 6.A — capa de datos, entidad "permissions" (roles y
// role_permissions). Extraído de PermissionsView.jsx: 10 llamadas
// supabase.from().
import { supabase } from '../supabaseClient';
import { fetchAllRows } from '../utils/supabaseUtils';
import { anotar, conBitacora } from './audit';

export function fetchRolesForPermissions() {
    return supabase.from('roles').select('id, name, parent_role_id, max_price_level, is_su, idle_limit_min').order('id');
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
        .select('role_id, module_key, can_view, can_edit, can_approve, scope, delega_en_ausencia')
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

// Minutos sin usar el portal antes de cerrar la sesión. La base lo acota entre
// 5 y 1440: por debajo de 5 el portal se vuelve inusable y quien lo configure se
// deja afuera a sí mismo.
export function updateRoleIdleLimit(roleId, minutos) {
    return supabase.from('roles').update({ idle_limit_min: minutos }).eq('id', roleId);
}

// ── Cambios de acceso que se anotan solos (D3, 2026-09-28) ─────────────────
// Quién le dio acceso a quién es justo lo que más importa poder rastrear
// (hallazgo P0 de la auditoría del 2026-08-03), así que la entrada la escribe
// la función que guarda y no la pantalla: la app del teléfono la hereda al
// llamar a la misma función. La pantalla sólo aporta lo que la base no sabe
// decir en palabras (`contexto`: el nombre del cargo, de qué cargo se copió).
//
// Las que ya se anotaban aunque la escritura fallara lo siguen haciendo, con
// `error` en el detalle: el INTENTO de cambiar un permiso también es un dato.
async function anotarIntento(escritura, accion, targetId, detalles) {
    const res = await escritura;
    const error = res?.error;
    anotar(accion, targetId, {
        ...detalles,
        error: error ? (error.message || 'error al guardar') : undefined,
    });
    return res;
}

/** Un permiso de un módulo para un cargo → `PERMISOS_CAMBIO`. */
export function guardarPermisoDeCargo(row, contexto = {}) {
    return anotarIntento(upsertRolePermission(row), 'PERMISOS_CAMBIO', String(row.role_id),
        { modulo: row.module_key, ...contexto });
}

/** Tope de nivel de precio del cargo → `PERMISOS_NIVEL_PRECIO`. */
export function cambiarNivelDePrecioDeCargo(roleId, level, contexto = {}) {
    return anotarIntento(updateRoleMaxPriceLevel(roleId, level), 'PERMISOS_NIVEL_PRECIO', String(roleId),
        { ...contexto, nivel: level || 'sin límite' });
}

/** Super Usuario del cargo → `PERMISOS_SUPER_USUARIO`. */
export function cambiarSuperUsuarioDeCargo(roleId, value, contexto = {}) {
    return anotarIntento(updateRoleIsSU(roleId, value), 'PERMISOS_SUPER_USUARIO', String(roleId),
        { ...contexto, valor: value });
}

/** Minutos de inactividad del cargo → `PERMISOS_TIEMPO_INACTIVIDAD` (sólo si entró). */
export function cambiarTiempoDeInactividadDeCargo(roleId, minutos, contexto = {}) {
    return conBitacora(updateRoleIdleLimit(roleId, minutos), 'PERMISOS_TIEMPO_INACTIVIDAD', String(roleId),
        { ...contexto, minutos });
}

/** Delegar (o no) las decisiones en ausencia → `PERMISOS_DELEGAR_AUSENCIA` (sólo si entró). */
export function delegarDecisionesDeCargo(roleId, rows, value, contexto = {}) {
    return conBitacora(upsertRolePermissionsBulk(rows), 'PERMISOS_DELEGAR_AUSENCIA', String(roleId),
        { ...contexto, valor: value });
}

/** Encender todo (como Super Usuario) y quitar el tope de precio → `PERMISOS_ACTIVAR_TODO`. */
export async function activarTodoParaCargo(roleId, rows, contexto = {}) {
    const [perm, nivel] = await Promise.all([
        upsertRolePermissionsBulk(rows),
        updateRoleMaxPriceLevel(roleId, null),
    ]);
    const error = perm?.error || nivel?.error || null;
    return anotarIntento({ error }, 'PERMISOS_ACTIVAR_TODO', String(roleId),
        { ...contexto, modulos: rows.length });
}

/** Copiar los permisos y el tope de precio de otro cargo → `PERMISOS_COPIAR_DESDE`. */
export async function copiarPermisosDeCargo(roleId, rows, nivel, contexto = {}) {
    const [perm, niv] = await Promise.all([
        upsertRolePermissionsBulk(rows),
        updateRoleMaxPriceLevel(roleId, nivel),
    ]);
    const error = perm?.error || niv?.error || null;
    return anotarIntento({ error }, 'PERMISOS_COPIAR_DESDE', String(roleId), contexto);
}

/** Encender o apagar una sección entera → `PERMISOS_ACTIVAR_SECCION` / `PERMISOS_APAGAR_SECCION`. */
export function cambiarSeccionDeCargo(roleId, rows, activar, contexto = {}) {
    return anotarIntento(upsertRolePermissionsBulk(rows),
        activar ? 'PERMISOS_ACTIVAR_SECCION' : 'PERMISOS_APAGAR_SECCION', String(roleId),
        { ...contexto, modulos: rows.length });
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

/* Lo que se hereda HOY por la ausencia de un cargo que depende del mío.
 *
 * No sale de `role_permissions` como los otros dos: depende de quién esté de
 * vacaciones en este momento, así que sólo lo sabe el servidor. La base ya lo
 * respeta —`auth_has_module_permission` incluye la herencia—, pero sin esta
 * llamada el navegador no se entera y le esconde al suplente lo que la base sí
 * le permitiría: los botones no se dibujan y las rutas se bloquean antes de
 * llegar a consultar nada.
 *
 * El merge lo hace el caller, con el mismo criterio que el cargo secundario. */
export function fetchPermisosHeredados() {
    return supabase.rpc('mis_permisos_heredados');
}

// ── NoAccessView.jsx / AccessDeniedView.jsx (nombre de cargo a mostrar) ─────

export function fetchRoleName(roleId) {
    return supabase.from('roles').select('name').eq('id', roleId).single();
}
