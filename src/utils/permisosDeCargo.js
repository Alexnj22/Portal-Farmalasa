/**
 * Permisos por cargo — el mapa `cargo:módulo` que pinta la pantalla de
 * Permisos. Vivía en `PermissionsView`; se mudó el 2026-10-05 para que la app
 * los muestre igual.
 *
 * Toda combinación cargo × módulo existe en el mapa: la que no tiene fila en
 * `role_permissions` va apagada y con alcance «Todos», que es lo que la base
 * entiende cuando no hay fila.
 */
export const PERMISO_APAGADO = Object.freeze({ can_view: false, can_edit: false, can_approve: false, scope: 'ALL', delega_en_ausencia: false });

export const ROTULO_ALCANCE = { ALL: 'Todos', BRANCH: 'Mi sucursal', MINE: 'Sólo míos' };

export function mapaDePermisos(filas, roles, claves) {
    const map = {};
    for (const p of filas || []) {
        map[`${p.role_id}:${p.module_key}`] = {
            can_view: p.can_view, can_edit: p.can_edit, can_approve: p.can_approve,
            scope: p.scope || 'ALL', delega_en_ausencia: !!p.delega_en_ausencia,
        };
    }
    for (const r of roles || []) for (const k of claves || []) {
        const id = `${r.id}:${k}`;
        if (!map[id]) map[id] = { ...PERMISO_APAGADO };
    }
    return map;
}

/** Lo que un cargo puede hacer en un módulo, en palabras: «Ver · Gestionar · Mi sucursal». */
export function permisoEnPalabras(p, { conAlcance = false } = {}) {
    if (!p?.can_view) return null;
    const partes = ['Ver'];
    if (p.can_edit) partes.push('Gestionar');
    if (p.can_approve) partes.push('Aprobar');
    if (conAlcance) partes.push(ROTULO_ALCANCE[p.scope] ?? p.scope);
    return partes.join(' · ');
}
