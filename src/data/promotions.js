// Bloque 6.A — capa de datos, entidad "promotions". Extraído de
// PromoModal.jsx: 6 llamadas supabase.from().
import { supabase } from '../supabaseClient';

export function searchActiveProductsByName(term) {
    return supabase.from('products')
        .select('id, nombre, foto_url, laboratorios(nombre)')
        .eq('activo', true)
        .ilike('nombre', `%${term}%`)
        .order('nombre')
        .limit(50);
}

export function fetchProductPreciosForPromo(productId) {
    return supabase.from('product_precios')
        .select('id_presentacion, descripcion, factor, presentaciones(id, tipo)')
        .eq('product_id', productId);
}

export function fetchSalesBranches(branchIds) {
    return supabase.from('branches').select('id, name').in('id', branchIds).order('name');
}

export function insertPromotion(payload) {
    return supabase.from('promotions').insert(payload).select().single();
}

export function insertPromotionBranches(rows) {
    return supabase.from('promotion_branches').insert(rows);
}

export function insertPromotionProducts(rows) {
    return supabase.from('promotion_products').insert(rows);
}
