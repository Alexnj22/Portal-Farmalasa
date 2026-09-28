// Bloque 6.A — capa de datos, entidad "minmaxLabs" (visibilidad de
// laboratorios en el cálculo de MinMax). Extraído de LabsPanel.jsx
// (tabminmax): 5 llamadas supabase.from().
import { supabase } from '../supabaseClient';
import { anotar } from './audit';

const CHUNK = 1000; // cap de PostgREST — Patrón B/A del CLAUDE.md

// Patrón B genérico: count + chunks en paralelo. countQuery ya debe traer
// .select('*', {count:'exact', head:true}) con los filtros aplicados;
// chunkFn(from, to) arma el select real de cada tramo. Único punto de verdad
// para fetchActiveProductLabIds/fetchProductIdsByLaboratorio (antes duplicaban
// este boilerplate entre sí — hallazgo de /code-review post-auditoría).
async function fetchPaginated(countQuery, chunkFn) {
    const { count, error } = await countQuery;
    if (error) return { data: null, error };
    const numChunks = Math.max(1, Math.ceil((count || 0) / CHUNK));
    const results = await Promise.all(
        Array.from({ length: numChunks }, (_, i) => chunkFn(i * CHUNK, (i + 1) * CHUNK - 1))
    );
    return { data: results.flatMap(r => r.data || []), error: results.find(r => r.error)?.error ?? null };
}

export function fetchLaboratoriosMinMaxVisibility() {
    return supabase.from('laboratorios').select('id, nombre, ocultar_en_minmax').order('nombre');
}

// RPC server-side con GROUP BY — antes descargaba laboratorio_id de TODOS
// los productos activos (miles de filas en varios chunks) solo para
// reducirlos a un conteo por laboratorio en un .forEach() de JS (deuda de
// rendimiento documentada en el /code-review post-auditoría, aplicada
// después a pedido explícito). Devuelve ~20-30 filas en vez de miles.
export function fetchActiveProductLabCounts() {
    return supabase.rpc('get_active_product_lab_counts');
}

export function updateLaboratorioMinMaxVisibility(labId, ocultar) {
    return supabase.from('laboratorios').update({ ocultar_en_minmax: ocultar }).eq('id', labId);
}

/**
 * Oculta o muestra un laboratorio en Mín·Máx. Al desocultarlo limpia además el
 * `is_hidden` individual de sus productos, para que reaparezcan sin quedar
 * marcados como ocultos a nivel de producto. Anota la entrada en la bitácora
 * sólo si todo salió bien (D3, 2026-09-28).
 *
 * Devuelve `{ error }` si falló el cambio del laboratorio, o
 * `{ errorDesocultar }` si el laboratorio cambió pero algún tramo de
 * productos no se pudo desocultar.
 */
export async function cambiarVisibilidadLaboratorioMinMax(labId, ocultar, contexto = {}) {
    const { error } = await updateLaboratorioMinMaxVisibility(labId, ocultar);
    if (error) return { error };
    if (!ocultar) {
        const { data: prods } = await fetchProductIdsByLaboratorio(labId);
        if (prods?.length) {
            // Devuelve un array de resultados (uno por tramo de 1000): un tramo
            // fallido antes quedaba en silencio.
            const results = await unhideStockParamsForProducts(prods.map(p => p.id));
            const failed = results.find(r => r.error);
            if (failed) return { error: null, errorDesocultar: failed.error };
        }
    }
    anotar('MINMAX_LAB_VISIBILITY', labId, { ocultar, ...contexto });
    return { error: null };
}

// Un laboratorio grande podía des-ocultarse solo parcialmente (M-3).
export function fetchProductIdsByLaboratorio(labId) {
    return fetchPaginated(
        supabase.from('products').select('*', { count: 'exact', head: true }).eq('laboratorio_id', labId),
        (from, to) => supabase.from('products').select('id').eq('laboratorio_id', labId).range(from, to)
    );
}

// Patrón A — chunkea el input: un laboratorio con >1000 productos no debe
// armar un solo .in() gigante. .eq('is_hidden', true) — write-churn guard
// (regla del proyecto: nunca escribir incondicional): antes del fix de
// paginación M-3 el cap silencioso de 1000 filas disimulaba esto, ahora que
// un laboratorio grande sí llega a todos sus productos hay que evitar
// reescribir ~7 filas de product_stock_params por producto que ya estaban
// visibles (hallazgo de /code-review post-auditoría).
export function unhideStockParamsForProducts(erpProductIds) {
    const chunks = [];
    for (let i = 0; i < erpProductIds.length; i += CHUNK) chunks.push(erpProductIds.slice(i, i + CHUNK));
    return Promise.all(
        chunks.map(c => supabase.from('product_stock_params')
            .update({ is_hidden: false, updated_at: new Date().toISOString() })
            .in('erp_product_id', c)
            .eq('is_hidden', true))
    );
}
