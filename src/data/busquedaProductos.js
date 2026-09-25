import { supabase } from '../supabaseClient';

/**
 * La búsqueda de producto del portal, una sola: `buscar_productos_ids` aplica
 * en la base la misma regla que `utils/busqueda.js` en el navegador (gemelos
 * probados contra `tests/casos-busqueda.json` y contra 33,808 nombres reales).
 * Plan: docs/PLAN-BUSQUEDA-UNIFICADA-2026-09-25.md, F3.
 *
 * Devuelve los ids YA ordenados por relevancia. Cada pantalla trae con ellos
 * sus propias columnas y filtros y los vuelve a poner en ese orden con
 * `enElOrdenDe`. Antes cada buscador armaba su `.or()` de PostgREST con su
 * propia regla: el orden de las palabras importaba, «5» encontraba «500» y
 * nadie tenía búsqueda aproximada.
 *
 * «Se busca lo que se ve» (decisión del usuario, 2026-09-25): el principio
 * activo y el laboratorio entran sólo si la pantalla los muestra.
 *
 * `aproximado: true` significa que no hubo coincidencia exacta y lo que viene
 * es parecido. La pantalla lo tiene que decir.
 */
export async function buscarIdsDeProducto(texto, {
    limite = 60, conPrincipioActivo = false, conLaboratorio = false, soloActivos = true,
} = {}) {
    const q = String(texto ?? '').trim();
    if (!q) return { ids: [], aproximado: false, error: null };
    const { data, error } = await supabase.rpc('buscar_productos_ids', {
        p_q: q,
        p_limite: limite,
        p_con_pactivo: conPrincipioActivo,
        p_con_laboratorio: conLaboratorio,
        p_solo_activos: soloActivos,
    });
    if (error) return { ids: [], aproximado: false, error };
    return { ids: (data?.ids ?? []).map(Number), aproximado: !!data?.aproximado, error: null };
}

/** Reordena filas traídas con `.in(clave, ids)` en el orden de `ids`. */
export function enElOrdenDe(filas, ids, clave = 'id') {
    const pos = new Map(ids.map((id, i) => [Number(id), i]));
    return [...(filas ?? [])].sort(
        (a, b) => (pos.get(Number(a[clave])) ?? 1e9) - (pos.get(Number(b[clave])) ?? 1e9));
}

/**
 * Busca y trae: el caso de los selectores de producto. `armar` recibe la
 * consulta base de `products` ya filtrada por los ids y agrega lo suyo
 * (columnas, `.eq`, `.not`…). Devuelve `{ data, error, aproximado }`, la misma
 * forma que devolvía el `.or()` de antes más el aviso.
 */
export async function buscarProductos(texto, { select, armar, ...opciones }) {
    const { ids, aproximado, error } = await buscarIdsDeProducto(texto, opciones);
    if (error) return { data: null, error, aproximado: false };
    if (!ids.length) return { data: [], error: null, aproximado: false };
    let q = supabase.from('products').select(select).in('id', ids);
    if (armar) q = armar(q);
    const { data, error: e2 } = await q;
    if (e2) return { data: null, error: e2, aproximado: false };
    return { data: enElOrdenDe(data, ids), error: null, aproximado };
}
