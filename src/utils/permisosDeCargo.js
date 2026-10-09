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

// ── Cambiar UN permiso de un cargo: qué más se mueve con él ─────────────────
//
// Vivía dentro de `PermissionsView.handleToggle` (portal). La app nativa cambia
// permisos con la MISMA cascada, y una cascada escrita dos veces es la clase de
// cosa que se separa en silencio: apagar «Ver» en una dejaría las pestañas
// encendidas en la base (la auditoría del 2026-08-03 encontró 38 filas así).
//
// Tres arrastres, todos calculados sobre el estado que VA A QUEDAR (el permiso
// que se está apagando todavía figura encendido en `permisos`):
//   · apagar «Ver» apaga «Gestionar», «Aprobar» y TODOS sus sub-permisos;
//   · los widgets del tablero (`dash_*`) y «Inicio» (`overview`) van juntos:
//     encender un widget enciende Inicio; apagar el último lo apaga;
//   · «Solicitudes → Aprobar» es el maestro de las familias de decidir: el
//     maestro enciende/apaga a todas, y una familia arrastra al maestro.

/** Las familias que gobierna «Solicitudes de sucursal → Aprobar». */
export const HIJOS_DE_APROBAR = ['requests_facturacion', 'requests_inventario',
    'requests_minmax', 'requests_caja', 'traslados'];

/** módulo → sus sub-permisos (pestañas y capacidades). */
export const subsDeModulos = (moduleGroups) => Object.fromEntries(
    (moduleGroups || []).flatMap(g => g.modules.map(m => [m.key, (m.sub || []).map(s => s.key)])),
);

/**
 * El plan de un cambio. `permisos` es el mapa `"<rol>:<módulo>" → permiso`
 * (como lo arma `mapaDePermisos`). Devuelve:
 *   · `estado`   — el mapa como queda (para pintarlo antes de que conteste el servidor);
 *   · `principal` — la fila del módulo tocado (se guarda con su bitácora);
 *   · `cascada`  — filas de las familias / el maestro (sólo si la principal entró);
 *   · `apagadas` — filas de los sub-permisos que se apagan;
 *   · `inicio`   — la fila de «Inicio» si cambia, o null;
 *   · `arrastra`, `inicioPasaA` — para la bitácora.
 */
export function planDeCambioDePermiso({ permisos, roleId, moduleKey, permType, value, moduleGroups, ahora = new Date().toISOString() }) {
    const p = permisos || {};
    const k = `${roleId}:${moduleKey}`;
    const subs = subsDeModulos(moduleGroups);
    // Módulos Y sub-permisos: hay widgets `dash_` que son pestañas de otro módulo.
    const todos = (moduleGroups || []).flatMap(g => g.modules.flatMap(m => [m.key, ...(m.sub || []).map(sb => sb.key)]));

    const arrastra = permType === 'can_view' && !value ? (subs[moduleKey] || []) : [];

    const esWidget = moduleKey.startsWith('dash_');
    const kInicio = `${roleId}:overview`;
    let inicioPasaA = null;
    if (esWidget && permType === 'can_view') {
        if (value) {
            if (!p[kInicio]?.can_view) inicioPasaA = true;
        } else {
            const quedaAlguno = todos.some(m => m.startsWith('dash_') && m !== moduleKey && p[`${roleId}:${m}`]?.can_view);
            if (!quedaAlguno && p[kInicio]?.can_view) inicioPasaA = false;
        }
    }

    const kMaestro = `${roleId}:requests`;
    const esMaestro = moduleKey === 'requests' && permType === 'can_approve';
    const esFamilia = HIJOS_DE_APROBAR.includes(moduleKey) && permType === 'can_approve';
    const familiasPasanA = esMaestro ? value : null;
    let maestroPasaA = null;
    if (esFamilia) {
        if (value) {
            if (!p[kMaestro]?.can_approve) maestroPasaA = true;
        } else {
            const quedaAlguna = HIJOS_DE_APROBAR.some(h => h !== moduleKey && p[`${roleId}:${h}`]?.can_approve);
            if (!quedaAlguna && p[kMaestro]?.can_approve) maestroPasaA = false;
        }
    }

    // ── El estado que queda ──
    const estado = { ...p };
    const cur = { ...p[k] };
    cur[permType] = value;
    if (permType === 'can_view' && !value) { cur.can_edit = false; cur.can_approve = false; }
    estado[k] = cur;
    for (const sk of arrastra) {
        estado[`${roleId}:${sk}`] = { ...(p[`${roleId}:${sk}`] || {}), can_view: false, can_edit: false, can_approve: false };
    }
    if (inicioPasaA !== null) {
        const ini = { ...(p[kInicio] || {}), can_view: inicioPasaA };
        if (!inicioPasaA) { ini.can_edit = false; ini.can_approve = false; }
        estado[kInicio] = ini;
    }
    if (familiasPasanA !== null) {
        for (const h of HIJOS_DE_APROBAR) {
            const kh = `${roleId}:${h}`;
            estado[kh] = { ...(p[kh] || { can_view: false, can_edit: false, scope: 'ALL' }), can_approve: familiasPasanA };
        }
    }
    if (maestroPasaA !== null) estado[kMaestro] = { ...(p[kMaestro] || {}), can_approve: maestroPasaA };

    // ── Las filas que se guardan ──
    const fila = (mk, pv, approve) => ({
        role_id: roleId, module_key: mk,
        can_view: pv.can_view ?? false, can_edit: pv.can_edit ?? false, can_approve: approve ?? pv.can_approve ?? false,
        scope: pv.scope || 'ALL', delega_en_ausencia: pv.delega_en_ausencia ?? false, updated_at: ahora,
    });
    const principal = fila(moduleKey, cur);
    const cascada = [];
    if (familiasPasanA !== null) for (const h of HIJOS_DE_APROBAR) cascada.push(fila(h, p[`${roleId}:${h}`] || {}, familiasPasanA));
    if (maestroPasaA !== null) cascada.push(fila('requests', p[kMaestro] || {}, maestroPasaA));
    const apagadas = arrastra.map(sk => ({
        role_id: roleId, module_key: sk, can_view: false, can_edit: false, can_approve: false,
        scope: p[`${roleId}:${sk}`]?.scope || 'ALL', updated_at: ahora,
    }));
    let inicio = null;
    if (inicioPasaA !== null) {
        const ip = p[kInicio] || {};
        inicio = {
            role_id: roleId, module_key: 'overview', can_view: inicioPasaA,
            can_edit: inicioPasaA ? (ip.can_edit ?? false) : false,
            can_approve: inicioPasaA ? (ip.can_approve ?? false) : false,
            scope: ip.scope || 'ALL', updated_at: ahora,
        };
    }
    return { estado, principal, cascada, apagadas, inicio, arrastra, inicioPasaA };
}

/**
 * «Copiar desde…»: las filas de TODOS los módulos y sub-permisos de un cargo,
 * escritas para otro (lo que no tiene el origen queda apagado). Portal y app.
 */
export function filasCopiadasDe(permisos, desdeId, haciaId, moduleGroups, ahora = new Date().toISOString()) {
    const claves = (moduleGroups || []).flatMap(g => g.modules.flatMap(m => [m.key, ...(m.sub || []).map(sb => sb.key)]));
    return claves.map(key => {
        const src = (permisos || {})[`${desdeId}:${key}`] || {};
        return {
            role_id: haciaId, module_key: key,
            can_view: src.can_view ?? false, can_edit: src.can_edit ?? false, can_approve: src.can_approve ?? false,
            scope: src.scope || 'ALL', delega_en_ausencia: src.delega_en_ausencia ?? false, updated_at: ahora,
        };
    });
}

/** Minutos sin uso antes de cerrar la sesión de un cargo: la base los acota. */
export const MIN_INACTIVIDAD = 5;
export const MAX_INACTIVIDAD = 1440;

// ── Las tres acciones en bloque (2026-10-09), para el portal y la app ───────

/** Los módulos de un grupo con sus sub-permisos, como filas a escribir (sub: sin «Aprobar»). */
export const modulosDelGrupo = (grupo) => (grupo?.modules || [])
    .flatMap(m => [m, ...(m.sub || []).map(t => ({ key: t.key, hasApprove: false, isTab: true }))]);

/** ¿Está encendida la sección entera? (todos sus módulos PRINCIPALES con «Ver»). */
export const seccionEncendida = (permisos, roleId, grupo) => (grupo?.modules || [])
    .every(m => (permisos || {})[`${roleId}:${m.key}`]?.can_view);

/**
 * Encender o apagar una sección entera: Ver y Gestionar, y Aprobar donde el
 * módulo lo tiene. El alcance que ya tenía se conserva.
 */
export function filasDeSeccion(permisos, roleId, modulos, activar, ahora = new Date().toISOString()) {
    return (modulos || []).map(m => ({
        role_id: roleId, module_key: m.key,
        can_view: activar, can_edit: activar, can_approve: activar && !!m.hasApprove,
        scope: (permisos || {})[`${roleId}:${m.key}`]?.scope || 'ALL', updated_at: ahora,
    }));
}

/** «Activar todo»: todo encendido —las pestañas y capacidades sin «Gestionar»—, con su alcance. */
export function filasParaActivarTodo(permisos, roleId, moduleGroups, ahora = new Date().toISOString()) {
    return (moduleGroups || []).flatMap(g => g.modules.flatMap(m => [m, ...(m.sub || []).map(s => ({ key: s.key, hasApprove: false, isTab: true }))]))
        .map(m => ({
            role_id: roleId, module_key: m.key,
            can_view: true, can_edit: !m.isTab, can_approve: !!m.hasApprove,
            scope: (permisos || {})[`${roleId}:${m.key}`]?.scope || 'ALL', updated_at: ahora,
        }));
}

/** Las familias que decide la bandeja de solicitudes más `requests`, que la abre. */
export const CLAVES_DE_DECIDIR = ['requests_facturacion', 'requests_inventario', 'requests_minmax', 'requests_caja', 'requests_cuentas_por_cobrar', 'traslados'];

/**
 * Delegar (o no) las decisiones en ausencia: las familias y `requests` en una
 * sola vez. Delegar decidir sin delegar ver dejaría al suplente con permiso
 * para resolver algo que no puede abrir.
 */
export function filasParaDelegar(permisos, roleId, valor, familias = CLAVES_DE_DECIDIR, ahora = new Date().toISOString()) {
    return [...familias, 'requests'].map(k => {
        const pv = (permisos || {})[`${roleId}:${k}`] || {};
        return {
            role_id: roleId, module_key: k,
            can_view: pv.can_view ?? false, can_edit: pv.can_edit ?? false, can_approve: pv.can_approve ?? false,
            scope: pv.scope || 'ALL', delega_en_ausencia: valor, updated_at: ahora,
        };
    });
}

/** ¿Delega hoy? */
export const delegaDecisiones = (permisos, roleId, familias = CLAVES_DE_DECIDIR) =>
    [...familias, 'requests'].some(k => (permisos || {})[`${roleId}:${k}`]?.delega_en_ausencia);
