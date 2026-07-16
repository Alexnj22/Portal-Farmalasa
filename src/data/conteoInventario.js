// Bloque 6.A — capa de datos, entidad "conteoInventario". Extraído de
// conteoInventarioSlice.js: 3 llamadas supabase.from() (el resto del
// slice son RPCs, ya server-side y fuera de alcance de 6.A).
import { supabase } from '../supabaseClient';

export function fetchConteosInventario() {
    return supabase.from('conteos_inventario').select('*, branches(name)').order('created_at', { ascending: false });
}

export function fetchConteoDetalle(conteoId) {
    return supabase.from('conteos_inventario').select('*, branches(name)').eq('id', conteoId).single();
}

export function insertConteoItemManual(payload) {
    return supabase.from('conteo_inventario_items').insert([payload]).select().single();
}

// ── ConteoDetailView.jsx / AddManualItemForm (5 sitios) ─────────────────────

export function searchActiveProductsForConteo(term) {
    return supabase.from('products')
        .select('id, nombre, laboratorios(nombre)')
        .eq('activo', true)
        .ilike('nombre', `%${term}%`)
        .order('nombre')
        .limit(30);
}

export function fetchProductPresentacionesForConteo(productId) {
    return supabase.from('product_precios')
        .select('id_presentacion, presentaciones(tipo)')
        .eq('product_id', productId)
        .eq('activo', true);
}

export function fetchErpSucursalIdsForBranch(branchId) {
    return supabase.from('erp_sucursal_map').select('erp_sucursal_id').eq('branch_id', branchId);
}

export function fetchInventoryLotesForProduct(productId, erpSucursalIds) {
    return supabase.from('inventory')
        .select('lote, fecha_vencimiento')
        .eq('erp_product_id', productId)
        .in('erp_sucursal_id', erpSucursalIds)
        .not('lote', 'is', null);
}

export function fetchProductCostoActivo(productId) {
    return supabase.from('product_precios')
        .select('costo')
        .eq('product_id', productId)
        .eq('activo', true)
        .order('id')
        .limit(1)
        .maybeSingle();
}
