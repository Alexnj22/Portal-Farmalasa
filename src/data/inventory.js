// Bloque 6.A — capa de datos, entidad "inventory". Primer módulo de
// src/data/ con lógica real de fetch (antes solo tenía catálogos
// estáticos). Empieza acá porque WidgetInventorySearch.jsx (el
// consumidor) ya había tenido un bug de datos y porque `inventory` es
// una de las tablas que CLAUDE.md marca como obligatoriamente paginada
// — dos de sus tres queries NO usaban fetchAllRows, un término de
// búsqueda amplio podía truncar resultados en silencio sobre el cap de
// 1000 filas de PostgREST.
import { supabase } from '../supabaseClient';
import { fetchAllRows } from '../utils/supabaseUtils';
import { likePattern } from '../utils/searchUtils';

// nombre (uppercase, trim) → foto_url, para enriquecer resultados de
// búsqueda con miniatura. Paginado: puede haber >1000 productos con foto.
export async function fetchProductPhotoMap() {
    const rows = await fetchAllRows(() =>
        supabase.from('products').select('nombre, foto_url').not('foto_url', 'is', null)
    );
    const map = {};
    for (const p of rows || []) map[p.nombre.toUpperCase().trim()] = p.foto_url;
    return map;
}

// Productos cuyo principio_activo matchea alguno de los términos dados —
// usado para ampliar la búsqueda de inventario más allá del nombre exacto
// (búsqueda principal: 1 término; alternativas por molécula: varios).
export async function fetchProductsByPrincipioActivo(terms) {
    const list = Array.isArray(terms) ? terms : [terms];
    if (list.length === 0) return [];
    const { data, error } = await supabase
        .from('products')
        .select('id, principio_activo')
        .or(list.map(t => `pactivo_norm.ilike.${likePattern(t)}`).join(','))
        .not('principio_activo', 'is', null);
    if (error) { console.error('fetchProductsByPrincipioActivo error:', error.message); return []; }
    return data || [];
}

// Inventario con stock (cantidad > 0) que matchea por descripción O por una
// lista de product IDs (vía principio_activo). Incluye vencidos — el
// consumidor los separa. Paginado con fetchAllRows.
export async function searchInventory({ term, productIds = [] }) {
    const { data: descRows, error: descError } = await supabase.rpc('search_inventory_descripcion_ids', { p_search: term });
    if (descError) throw descError;
    const descIds = (descRows || []).map((r) => r.id);

    return await fetchAllRows(() => {
        let q = supabase
            .from('inventory')
            .select('erp_sucursal_id, erp_product_id, descripcion, presentacion, lote, fecha_vencimiento, cantidad, is_vencidos')
            .gt('cantidad', 0)
            .order('descripcion')
            .order('fecha_vencimiento', { ascending: true, nullsFirst: false });
        q = productIds.length > 0
            ? q.or(`id.in.(${descIds.length > 0 ? descIds.join(',') : 0}),erp_product_id.in.(${productIds.join(',')})`)
            : q.in('id', descIds.length > 0 ? descIds : [0]);
        return q;
    }) || [];
}

// Inventario con stock filtrado directo por una lista de product IDs — usado
// para la sección "Alternativas en inventario" tras una búsqueda SRS.
export async function fetchInventoryByProductIds(productIds) {
    if (!productIds?.length) return [];
    return await fetchAllRows(() =>
        supabase
            .from('inventory')
            .select('erp_sucursal_id, erp_product_id, descripcion, presentacion, lote, fecha_vencimiento, cantidad')
            .gt('cantidad', 0)
            .in('erp_product_id', productIds)
            .order('descripcion')
            .order('fecha_vencimiento', { ascending: true, nullsFirst: false })
    ) || [];
}

// WidgetSrsInventory.jsx — cruza resultados del SRS contra inventario propio
// para marcar cuáles ya tenemos en stock.
export function fetchInventoryStockFlags(erpIds) {
    return supabase.from('inventory').select('erp_product_id').in('erp_product_id', erpIds).gt('cantidad', 0);
}

// SyncHealthBanner.jsx / SidebarSyncStatus.jsx — mismo query base (el banner
// del dashboard además lee items_count; select en superset, filtros idénticos).
export function fetchInventorySyncLogRecent() {
    const since = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    return supabase.from('inventory_sync_log')
        .select('erp_sucursal_id, success, synced_at, error_msg, items_count')
        .gte('synced_at', since)
        .eq('is_vencidos', false)
        .order('synced_at', { ascending: false })
        .limit(60);
}
