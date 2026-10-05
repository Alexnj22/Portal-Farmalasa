/**
 * Jerarquía de cargos — qué tan abajo está un cargo en el organigrama, quién
 * es su superior, quiénes lo ocupan y si es un cargo externo. Vivía en
 * `RolesView`; se mudó el 2026-10-05 para que la app muestre el mismo
 * organigrama.
 */

/** Cuántos niveles hay entre el cargo y la cima (0 = sin superior). */
export function profundidadDeCargo(roles, roleId) {
    let depth = 0;
    const visto = new Set();
    let current = (roles || []).find((r) => r.id === roleId);
    while (current && current.parent_role_id && !visto.has(current.id)) {
        visto.add(current.id);
        depth++;
        current = roles.find((r) => r.id === current.parent_role_id);
    }
    return depth;
}

/** Los cargos de la cima hacia abajo y, en el mismo nivel, por nombre. */
export function ordenarPorJerarquia(roles, lista = roles) {
    const prof = new Map((roles || []).map((r) => [r.id, profundidadDeCargo(roles, r.id)]));
    return [...(lista || [])].sort((a, b) => (prof.get(a.id) - prof.get(b.id)) || String(a.name).localeCompare(String(b.name)));
}

export const nombreDelSuperior = (roles, parentId) =>
    (!parentId ? 'Nivel Máximo' : (roles || []).find((r) => r.id === parentId)?.name || 'Desconocido');

/** Quiénes ocupan el cargo, como principal o como segundo cargo. */
export const ocupantesDelCargo = (empleados, roleId) =>
    (empleados || []).filter((e) => e.role_id === roleId || e.secondary_role_id === roleId);

/** Regentes, referentes, consultores y externos — salvo enfermería, que es de planta. */
export function esCargoExterno(nombre) {
    const n = String(nombre || '').toUpperCase();
    if (n.includes('ENFERMERÍA') || n.includes('ENFERMERIA')) return false;
    return n.includes('REGENTE') || n.includes('REFERENTE') || n.includes('EXTERNO') || n.includes('CONSULTOR');
}

/** Los cargos nivel a nivel (la cima, sus hijos, sus nietos…), como los lista Permisos. */
export function cargosNivelANivel(roles) {
    const byParent = {};
    for (const r of roles || []) (byParent[r.parent_role_id ?? 'root'] ||= []).push(r);
    const sorted = [];
    const queue = [...(byParent.root || [])];
    while (queue.length) {
        const r = queue.shift();
        sorted.push(r);
        queue.push(...(byParent[r.id] || []));
    }
    return sorted;
}
