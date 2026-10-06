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

// ── Crear, editar y eliminar un cargo: las reglas ───────────────────────────
// Vivían en `RolesView` (portal). La app nativa crea, edita y elimina cargos
// con las MISMAS reglas, así que viven acá y el portal las importa.

/** Los ámbitos de un cargo, con su rótulo. */
export const AMBITOS_DE_CARGO = [
    { value: 'BRANCH', label: 'Por sucursal' },
    { value: 'GLOBAL', label: 'Global' },
];

/**
 * Qué impide guardar el cargo, en palabras; `null` si se puede. Los ids se
 * comparan como texto: el formulario los trae como cadena y la tabla como número.
 */
export function errorDeCargo({ nombre, parentId, secundarioId, maxLimit, editandoId = null }, roles) {
    if (!String(nombre || '').trim()) return 'El cargo necesita un nombre.';
    const hayRaiz = (roles || []).some((r) => !r.parent_role_id && String(r.id) !== String(editandoId ?? ''));
    if (hayRaiz && !parentId) return 'Ya hay un cargo en Nivel Raíz. Asígnale un superior a este cargo.';
    if (parentId && String(parentId) === String(secundarioId || '')) return 'El reporte principal y matricial no pueden ser la misma persona.';
    if (!(Number(maxLimit) >= 1)) return 'El límite de plazas debe ser al menos 1.';
    return null;
}

/**
 * Por qué un cargo NO se puede eliminar ({ titulo, mensaje }), o `null` si se
 * puede: con gente asignada, o con cargos que dependen de él en el organigrama.
 */
export function bloqueoParaEliminarCargo(rol, roles, empleados) {
    const gente = ocupantesDelCargo(empleados, rol.id);
    if (gente.length > 0) {
        return { titulo: 'Operación prohibida', mensaje: `No puedes eliminar el cargo "${rol.name}" porque tiene ${gente.length} empleado(es) asignado(s). Reasígnalos primero.` };
    }
    if ((roles || []).some((r) => r.parent_role_id === rol.id || r.secondary_parent_role_id === rol.id)) {
        return { titulo: 'Operación bloqueada', mensaje: `El cargo "${rol.name}" tiene otros puestos que dependen de él en el organigrama. Mueve los cargos dependientes antes de eliminarlo.` };
    }
    return null;
}

/**
 * El organigrama como dibujo: cada cargo con su caja (x, y en unidades de
 * casilla) y las líneas a su superior —principal y matricial—. Árbol clásico:
 * las hojas se reparten de izquierda a derecha y cada padre se centra sobre sus
 * hijos. Un ciclo o un superior que no existe se trata como raíz (no se pierde
 * ningún cargo del dibujo).
 */
export function disposicionDelOrganigrama(roles) {
    const lista = roles || [];
    const ids = new Set(lista.map((r) => r.id));
    const hijos = {};
    const raices = [];
    for (const r of lista) {
        if (r.parent_role_id && ids.has(r.parent_role_id) && r.parent_role_id !== r.id) (hijos[r.parent_role_id] ||= []).push(r);
        else raices.push(r);
    }
    const porNombre = (a, b) => String(a.name).localeCompare(String(b.name), 'es');
    Object.values(hijos).forEach((h) => h.sort(porNombre));
    raices.sort(porNombre);
    const nodos = [];
    const visto = new Set();
    let siguienteHoja = 0;
    const colocar = (r, nivel) => {
        visto.add(r.id);
        const propios = (hijos[r.id] || []).filter((h) => !visto.has(h.id));
        let x;
        if (!propios.length) x = siguienteHoja++;
        else {
            const xs = propios.map((h) => colocar(h, nivel + 1));
            x = (xs[0] + xs[xs.length - 1]) / 2;
        }
        nodos.push({ id: r.id, name: r.name, scope: r.scope, x, y: nivel });
        return x;
    };
    raices.forEach((r) => colocar(r, 0));
    // Lo que un ciclo dejó afuera entra como raíz suelta.
    for (const r of lista) if (!visto.has(r.id)) colocar(r, 0);
    const pos = Object.fromEntries(nodos.map((n) => [n.id, n]));
    const lineas = [];
    for (const r of lista) {
        if (r.parent_role_id && pos[r.parent_role_id] && r.parent_role_id !== r.id) lineas.push({ desde: r.parent_role_id, hasta: r.id, tipo: 'principal' });
        if (r.secondary_parent_role_id && pos[r.secondary_parent_role_id]) lineas.push({ desde: r.secondary_parent_role_id, hasta: r.id, tipo: 'matricial' });
    }
    return {
        nodos, lineas,
        ancho: Math.max(1, siguienteHoja),
        alto: nodos.reduce((m, n) => Math.max(m, n.y + 1), 1),
    };
}
