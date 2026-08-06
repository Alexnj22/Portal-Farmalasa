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
/**
 * Las fotos de UNOS productos, no las de todos.
 *
 * Antes esto bajaba `products` entero —todas las filas con foto, paginadas— en
 * cada búsqueda, para después usar las tres o cuatro que aparecían en los
 * resultados. Ese era el motivo de que las fotos tardaran en salir: no pesaban
 * las imágenes, pesaba traer el catálogo para elegirlas.
 *
 * Se pide en tandas de 1000 porque el `in()` viaja como filtro y la respuesta
 * se corta en 1000 filas sin avisar.
 */
export async function fetchProductPhotoMap(nombres = null) {
    const pedir = async (lista) => {
        let q = supabase.from('products').select('nombre, foto_url').not('foto_url', 'is', null);
        if (lista) q = q.in('nombre', lista);
        return q;
    };

    let rows;
    if (Array.isArray(nombres) && nombres.length > 0) {
        const unicos = [...new Set(nombres.filter(Boolean))];
        const tandas = [];
        for (let i = 0; i < unicos.length; i += 1000) tandas.push(unicos.slice(i, i + 1000));
        const res = await Promise.all(tandas.map(pedir));
        rows = res.flatMap(r => r.data ?? []);
    } else {
        // Sin lista sigue trayendo todo, paginado: es el camino de quien
        // todavía no sabe qué productos va a mostrar.
        rows = await fetchAllRows(() => pedir(null));
    }

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
