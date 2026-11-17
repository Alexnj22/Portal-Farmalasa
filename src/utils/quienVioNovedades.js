/**
 * «Quién las vio» (Novedades), la cuenta por persona — una sola vez para el
 * portal (`NovedadesView`) y la app (`apps/mobile/app/novedades.js`).
 *
 * Cuántas de las novedades que LE TOCAN revisó cada persona activa. Qué le
 * toca sale de `novedadesVisibles` con los permisos de su cargo, la misma
 * regla que arma su pantalla. Sólo cuenta a quien puede abrir Novedades.
 */
import { novedadesVisibles } from '../constants/novedades';

// «Revisada» por persona, en la base. El id de la tanda va en la clave de
// cada novedad, así una tanda nueva arranca en cero.
export const claveDeNovedad = (n) => `${n.tanda}:${n.id}`;

export const ESTADOS_QUIEN = [
    { value: 'todos', label: 'Todos' },
    { value: 'sin', label: 'Sin ver' },
    { value: 'medias', label: 'A medias' },
    { value: 'completas', label: 'Todas vistas' },
];

export function estadoDeAvance(f) {
    if (f.hechas === 0) return 'sin';
    return f.hechas >= f.total ? 'completas' : 'medias';
}

/** De `fetchQuienVioNovedades()` a una fila por persona con lo suyo. */
export function filasDeQuienVio(datos) {
    if (!datos) return [];
    const cargos = new Map(datos.cargos.map((c) => [c.id, c]));
    const porPersona = new Map();
    for (const v of datos.vistas) {
        if (!porPersona.has(v.employee_id)) porPersona.set(v.employee_id, new Map());
        porPersona.get(v.employee_id).set(v.clave, v.visto_at);
    }
    const cache = new Map();
    const deCargo = (roleId) => {
        if (!cache.has(roleId)) {
            const su = !!cargos.get(roleId)?.is_su;
            const perms = datos.permisos[roleId] ?? {};
            const puede = (m, nivel = 'can_view') => su || !!perms[m]?.[nivel];
            const lista = puede('novedades')
                ? novedadesVisibles({ roleId, puede }).flatMap((t) => t.novedades.map((n) => ({ ...n, tanda: t.id })))
                    .filter((n) => n.especial !== 'app-personal')
                : null;
            cache.set(roleId, lista);
        }
        return cache.get(roleId);
    };
    return datos.empleados.map((e) => {
        const lista = deCargo(e.role_id);
        if (!lista) return null;
        const suyas = porPersona.get(e.id) ?? new Map();
        const vistas = lista.filter((n) => suyas.has(claveDeNovedad(n)));
        const ultima = [...suyas.values()].sort().at(-1) ?? null;
        return {
            ...e, lista, suyas, hechas: vistas.length, total: lista.length, ultima,
            cargo: cargos.get(e.role_id)?.name ?? '—',
        };
    }).filter(Boolean);
}

/** Lo que va primero: quien menos lleva, y después por nombre. */
export const ordenDeAvance = (a, b) => (a.hechas / (a.total || 1)) - (b.hechas / (b.total || 1)) || a.name.localeCompare(b.name);
