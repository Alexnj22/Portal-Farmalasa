// Bloque 6.A — capa de datos para TabInventario.jsx (vista de
// inventario por sucursal en Productos). 7 llamadas supabase.from()
// (una reutiliza fetchLaboratoriosBasic de data/laboratorios.js, mismo
// query exacto).
import { supabase } from '../supabaseClient';
import { fetchAllRows } from '../utils/supabaseUtils';

export function fetchInventorySyncLog() {
    return supabase.from('inventory_sync_log')
        .select('erp_sucursal_id, is_vencidos, synced_at, success, items_count')
        .order('synced_at', { ascending: false })
        .limit(30);
}

export function fetchProductCategories() {
    return supabase.from('product_categories').select('nombre').order('nombre');
}

// Paginado con fetchAllRows — el conteo de inventario vencido por
// sucursal puede superar 1000 filas.
export function fetchAllVencidosInventory(erpId) {
    return fetchAllRows(() => {
        let q = supabase
            .from('inventory')
            .select('erp_sucursal_id, erp_product_id, cantidad, detalle')
            .eq('is_vencidos', true);
        if (erpId !== null) q = q.eq('erp_sucursal_id', erpId);
        return q;
    });
}

export function fetchExpiredInventoryCount(erpId, todayStr) {
    let q = supabase.from('inventory')
        .select('*', { count: 'exact', head: true })
        .eq('is_vencidos', false).lt('fecha_vencimiento', todayStr);
    if (erpId !== null) q = q.eq('erp_sucursal_id', erpId);
    return q;
}

export function fetchInventoryDetail(erpId, productId, isVencidos) {
    return supabase.from('inventory')
        .select('presentacion, detalle, lote, fecha_vencimiento, cantidad')
        .eq('erp_sucursal_id', erpId)
        .eq('erp_product_id', productId)
        .eq('is_vencidos', isVencidos)
        .gt('cantidad', 0)
        .order('presentacion').order('lote');
}
