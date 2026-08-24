// Lo escrito sobre este módulo: `docs/RETOMAR-AJUSTE-INVENTARIO-2026-08-06.md`
// — el widget de ajuste, que es el cuarto de la familia que EJECUTA el cambio
// en el sistema de origen en vez de pedirlo. Leerlo antes de tocar el ajuste.
// Bloque 6.A — capa de datos para TabInventario.jsx (vista de
// inventario por sucursal en Productos). 7 llamadas supabase.from()
// (una reutiliza fetchLaboratoriosBasic de data/laboratorios.js, mismo
// query exacto).
import { supabase } from '../supabaseClient';
import { fetchAllRows } from '../utils/supabaseUtils';

// El selector de sucursal pone «N items» bajo cada sala, y ese número sale de
// la última sincronización buena de cada una. Pedía las últimas 30 filas SIN
// filtrar, y para un `ORDER BY synced_at` a secas no hay índice que sirva: el
// plan real era un **Parallel Seq Scan de 775,868 filas para devolver 30**.
// Medido el 2026-08-18 en producción: media 2,099 ms, pico 7,818 ms — cada vez
// que alguien abre Inventario. Y se llevaba los DOS workers paralelos de toda
// la instancia, así que mientras corría el resto de la base iba en un solo hilo.
//
// Nadie lo rompió: la tabla crece 10,080 filas por día (7 salas × cada minuto)
// y el 2026-08-18 tocó su techo de retención de 90 días. O sea que esto se
// encareció ~1% por día durante tres meses hasta cruzar la línea.
//
// Filtrar `is_vencidos` lo arregla SIN DDL sobre una tabla que recibe una
// escritura por minuto: `idx_inventory_sync_log_venc_synced (is_vencidos,
// synced_at DESC)` ya existía y recién ahora lo cubre. Medido: **0.147 ms**.
// Y de paso es más correcto — el único consumidor ya descartaba los vencidos en
// JS, así que la mitad de las 30 filas se tiraba; ahora las 30 sirven.
export function fetchInventorySyncLog() {
    return supabase.from('inventory_sync_log')
        .select('erp_sucursal_id, is_vencidos, synced_at, success, items_count')
        .eq('is_vencidos', false)
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
