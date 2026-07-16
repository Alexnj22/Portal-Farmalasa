// Bloque 6.A — capa de datos, entidad "minmaxRequests". Extraído de
// WidgetMinMaxRequest.jsx: 5 llamadas supabase.from(). Las 2 últimas
// (fetchActiveProductsCount + fetchActiveProductsChunk) preservan el
// patrón de paginación en paralelo (count + N chunks de 1000 vía
// .range()) que ya usaba el caller — Patrón B de CLAUDE.md, no es un
// bug, solo se extrae el query builder.
import { supabase } from '../supabaseClient';

export function fetchProductPreciosForMinMax(productId) {
    return supabase.from('product_precios')
        .select('factor, descripcion, presentaciones(tipo)')
        .eq('product_id', productId)
        .eq('activo', true);
}

export function fetchCurrentStockParams(erpProductId, erpSucursalId) {
    return supabase.from('product_stock_params')
        .select('manual_min, manual_max, min_units, max_units, units_sold_6m')
        .eq('erp_product_id', erpProductId)
        .eq('erp_sucursal_id', Number(erpSucursalId))
        .maybeSingle();
}

export function insertMinMaxChangeRequest(payload) {
    return supabase.from('minmax_change_requests').insert(payload);
}

export function fetchActiveProductsCount() {
    return supabase.from('products').select('*', { count: 'exact', head: true }).eq('activo', true);
}

export function fetchActiveProductsChunk(rangeFrom, rangeTo) {
    return supabase.from('products')
        .select('id, nombre, laboratorio_id, foto_url, principio_activo, laboratorios(nombre)')
        .eq('activo', true)
        .order('nombre')
        .range(rangeFrom, rangeTo);
}
