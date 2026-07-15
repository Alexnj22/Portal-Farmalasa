// Bloque 6.A — capa de datos, entidad "recepcion" (recepción física de
// pedidos en sucursal). Extraído de RecepcionModal.jsx: 9 llamadas
// supabase.from(). El update de pedido_sucursal_status (cajas_recibidas,
// 3 sitios) reutiliza updatePedidoSucursalStatus ya definido en
// data/pedidos.js (Bloque 6.A) — mismo query exacto, no se duplica.
import { supabase } from '../supabaseClient';
import { fetchAllRows } from '../utils/supabaseUtils';

export function fetchProductPreciosOpts(productId) {
    return supabase.from('product_precios')
        .select('product_id, factor, descripcion, presentaciones!id_presentacion(tipo)')
        .eq('product_id', productId).eq('activo', true).order('factor');
}

// Paginado con fetchAllRows — antes era un while-loop manual con el mismo
// patrón 1000-en-1000 ya presente en otros archivos de este bloque.
export function fetchProductPreciosOptsForProducts(productIds) {
    return fetchAllRows(() =>
        supabase.from('product_precios')
            .select('product_id, factor, descripcion, presentaciones!id_presentacion(tipo)')
            .in('product_id', productIds).eq('activo', true).order('factor')
    );
}

export function fetchPedidoApoyoBasic(pedidoId, sucursalId) {
    return supabase.from('pedido_apoyo')
        .select('employee_id, employees(name, photo_url)')
        .eq('pedido_id', pedidoId).eq('erp_sucursal_id', sucursalId);
}

export function searchAvailableProducts(term, excludeIds) {
    let q = supabase.from('products').select('id, nombre')
        .eq('activo', true).ilike('nombre', `%${term}%`).order('nombre').limit(10);
    if (excludeIds.length > 0) q = q.not('id', 'in', `(${excludeIds.join(',')})`);
    return q;
}

export function fetchLastDispatchInfo(productId) {
    return supabase.from('pedido_items')
        .select('dispatch_factor, dispatch_tipo')
        .eq('erp_product_id', productId)
        .not('dispatch_tipo', 'is', null).not('dispatch_factor', 'is', null)
        .order('id', { ascending: false }).limit(1);
}

export function insertPedidoRecepcionExtras(rows) {
    return supabase.from('pedido_recepcion_extras').insert(rows);
}
