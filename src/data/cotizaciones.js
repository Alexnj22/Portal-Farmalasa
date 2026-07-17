// Bloque 6.A — capa de datos, entidad "cotizaciones". Extraído de
// CotizacionesView.jsx: 15 llamadas supabase.from() (una compartida con
// data/system.js: fetchBranchesBasic, mismo query exacto).
import { supabase } from '../supabaseClient';
import { fetchAllRows } from '../utils/supabaseUtils';
import { likePattern } from '../utils/searchUtils';

// Paginado con fetchAllRows — antes era un while-loop manual con el mismo
// patrón 1000-en-1000 ya presente en otros archivos de este bloque.
export function fetchAllProductPreciosForCotizaciones() {
    return fetchAllRows(() =>
        supabase
            .from('product_precios')
            .select('product_id, id_presentacion, descripcion, vineta, descuento_1, vip, clinica, mayoreo, premium, precio_7, presentaciones(tipo)')
            .eq('activo', true)
            .order('product_id', { ascending: true })
            .order('id_presentacion', { ascending: true })
    );
}

export function searchProductsActive(term) {
    return supabase.from('products')
        .select('id, nombre')
        .eq('activo', true)
        .ilike('nombre_norm', likePattern(term))
        .order('nombre')
        .limit(20);
}

export function searchCustomersByName(term) {
    return supabase.from('customers')
        .select('id, name, nit')
        .ilike('name', `%${term}%`)
        .order('name')
        .limit(60);
}

export function fetchCotizacionesList(scopeBranchId) {
    let q = supabase
        .from('cotizaciones')
        .select('id, numero, fecha, customer_name, document_type, payment_type, total, status, created_by_name, created_by_photo, branch_id')
        .order('created_at', { ascending: false })
        .limit(300);
    if (scopeBranchId) q = q.eq('branch_id', scopeBranchId);
    return q;
}

export function insertCotizacion(payload) {
    return supabase.from('cotizaciones').insert(payload).select().single();
}

export function updateCotizacion(cotId, patch, returning = false) {
    const q = supabase.from('cotizaciones').update(patch).eq('id', cotId);
    return returning ? q.select().single() : q;
}

export function insertCotizacionItems(rows) {
    return supabase.from('cotizacion_items').insert(rows);
}

export function fetchCotizacionItems(cotizacionId) {
    return supabase.from('cotizacion_items').select('*').eq('cotizacion_id', cotizacionId).order('sort_order');
}

export function deleteCotizacionItems(cotizacionId) {
    return supabase.from('cotizacion_items').delete().eq('cotizacion_id', cotizacionId);
}
