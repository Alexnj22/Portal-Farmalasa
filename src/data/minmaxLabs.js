// Bloque 6.A — capa de datos, entidad "minmaxLabs" (visibilidad de
// laboratorios en el cálculo de MinMax). Extraído de LabsPanel.jsx
// (tabminmax): 5 llamadas supabase.from().
import { supabase } from '../supabaseClient';

export function fetchLaboratoriosMinMaxVisibility() {
    return supabase.from('laboratorios').select('id, nombre, ocultar_en_minmax').order('nombre');
}

export function fetchActiveProductLabIds() {
    return supabase.from('products').select('laboratorio_id').eq('activo', true);
}

export function updateLaboratorioMinMaxVisibility(labId, ocultar) {
    return supabase.from('laboratorios').update({ ocultar_en_minmax: ocultar }).eq('id', labId);
}

export function fetchProductIdsByLaboratorio(labId) {
    return supabase.from('products').select('id').eq('laboratorio_id', labId);
}

export function unhideStockParamsForProducts(erpProductIds) {
    return supabase.from('product_stock_params')
        .update({ is_hidden: false, updated_at: new Date().toISOString() })
        .in('erp_product_id', erpProductIds);
}
