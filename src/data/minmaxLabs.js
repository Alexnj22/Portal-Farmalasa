// Bloque 6.A — capa de datos, entidad "minmaxLabs" (visibilidad de
// laboratorios en el cálculo de MinMax). Extraído de LabsPanel.jsx
// (tabminmax): 5 llamadas supabase.from().
import { supabase } from '../supabaseClient';

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

// >1000 productos activos hacía que los conteos por laboratorio en LabsPanel
// quedaran truncados (M-3).
export function fetchActiveProductLabIds() {
    return fetchPaginated(
        supabase.from('products').select('*', { count: 'exact', head: true }).eq('activo', true),
        (from, to) => supabase.from('products').select('laboratorio_id').eq('activo', true).range(from, to)
    );
}

export function updateLaboratorioMinMaxVisibility(labId, ocultar) {
    return supabase.from('laboratorios').update({ ocultar_en_minmax: ocultar }).eq('id', labId);
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
