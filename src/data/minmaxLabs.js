// Bloque 6.A — capa de datos, entidad "minmaxLabs" (visibilidad de
// laboratorios en el cálculo de MinMax). Extraído de LabsPanel.jsx
// (tabminmax): 5 llamadas supabase.from().
import { supabase } from '../supabaseClient';

const CHUNK = 1000; // cap de PostgREST — Patrón B/A del CLAUDE.md

export function fetchLaboratoriosMinMaxVisibility() {
    return supabase.from('laboratorios').select('id, nombre, ocultar_en_minmax').order('nombre');
}

// Patrón B: count + chunks en paralelo — >1000 productos activos hacía que
// los conteos por laboratorio en LabsPanel quedaran truncados (M-3).
export async function fetchActiveProductLabIds() {
    const { count, error } = await supabase
        .from('products').select('*', { count: 'exact', head: true }).eq('activo', true);
    if (error) return { data: null, error };
    const numChunks = Math.max(1, Math.ceil((count || 0) / CHUNK));
    const results = await Promise.all(
        Array.from({ length: numChunks }, (_, i) =>
            supabase.from('products').select('laboratorio_id').eq('activo', true)
                .range(i * CHUNK, (i + 1) * CHUNK - 1)
        )
    );
    return { data: results.flatMap(r => r.data || []), error: results.find(r => r.error)?.error ?? null };
}

export function updateLaboratorioMinMaxVisibility(labId, ocultar) {
    return supabase.from('laboratorios').update({ ocultar_en_minmax: ocultar }).eq('id', labId);
}

// Patrón B — un laboratorio grande podía des-ocultarse solo parcialmente (M-3).
export async function fetchProductIdsByLaboratorio(labId) {
    const { count, error } = await supabase
        .from('products').select('*', { count: 'exact', head: true }).eq('laboratorio_id', labId);
    if (error) return { data: null, error };
    const numChunks = Math.max(1, Math.ceil((count || 0) / CHUNK));
    const results = await Promise.all(
        Array.from({ length: numChunks }, (_, i) =>
            supabase.from('products').select('id').eq('laboratorio_id', labId)
                .range(i * CHUNK, (i + 1) * CHUNK - 1)
        )
    );
    return { data: results.flatMap(r => r.data || []), error: results.find(r => r.error)?.error ?? null };
}

// Patrón A — chunkea el input: un laboratorio con >1000 productos no debe
// armar un solo .in() gigante.
export function unhideStockParamsForProducts(erpProductIds) {
    const chunks = [];
    for (let i = 0; i < erpProductIds.length; i += CHUNK) chunks.push(erpProductIds.slice(i, i + CHUNK));
    return Promise.all(
        chunks.map(c => supabase.from('product_stock_params')
            .update({ is_hidden: false, updated_at: new Date().toISOString() })
            .in('erp_product_id', c))
    );
}
