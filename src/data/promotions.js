// Bloque 6.A — capa de datos, entidad "promotions". Extraído de
// PromoModal.jsx: 6 llamadas supabase.from().
import { supabase } from '../supabaseClient';
import { likePattern } from '../utils/searchUtils';

export function searchActiveProductsByName(term) {
    return supabase.from('products')
        .select('id, nombre, foto_url, laboratorios(nombre)')
        .eq('activo', true)
        .ilike('nombre_norm', likePattern(term))
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

// ── TabBonificaciones.jsx (3 sitios) ─────────────────────────────────────────

export function fetchPromotionBonifications() {
    return supabase.from('promotion_bonifications')
        .select(`
            id, role, units_credited, amount_earned, amount_paid, updated_at,
            employee_id,
            employees(id, name, photo_url),
            promotion_products(
                id, promotion_id, factor_descripcion,
                products(nombre),
                promotions(id, nombre, estado)
            )
        `)
        .gt('amount_earned', 0)
        .order('amount_earned', { ascending: false });
}

export function insertPromotionPayment(payload) {
    return supabase.from('promotion_payments').insert(payload);
}

export function updatePromotionBonificationPaid(id, amountPaid) {
    return supabase.from('promotion_bonifications').update({ amount_paid: amountPaid }).eq('id', id);
}

// ── TabPromos.jsx (3 sitios) ──────────────────────────────────────────────────

export function fetchPromotionsList(states) {
    return supabase.from('promotions')
        .select(`
            id, nombre, estado, fecha_inicio, fecha_fin, end_condition, notas,
            promotion_branches(branch_id, branches(name)),
            promotion_products(
                id, product_id, factor_descripcion, factor_denominador,
                stock_inicial, bono_vendedor, bono_admin_pool, bono_bodega_pool,
                presentacion_id, presentaciones(tipo),
                products(nombre, foto_url, laboratorio_id, laboratorios(nombre)),
                promotion_sales_cache(units_sold)
            )
        `)
        .in('estado', states)
        .order('created_at', { ascending: false });
}

export function updatePromotionEstado(promotionId, estado) {
    return supabase.from('promotions').update({ estado }).eq('id', promotionId);
}

export function deletePromotion(promotionId) {
    return supabase.from('promotions').delete().eq('id', promotionId);
}

// ── TabHistorial.jsx (promociones cerradas) ─────────────────────────────────

export function fetchClosedPromotions() {
    return supabase.from('promotions')
        .select(`
            id, nombre, estado, fecha_inicio, fecha_fin, end_condition, notas,
            laboratorios(nombre),
            promotion_branches(branch_id, branches(name)),
            promotion_products(
                id, product_id, factor_descripcion, stock_inicial,
                products(nombre, foto_url),
                promotion_sales_cache(units_sold)
            )
        `)
        .eq('estado', 'closed')
        .order('updated_at', { ascending: false });
}
