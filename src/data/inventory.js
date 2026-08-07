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

/**
 * La búsqueda de la Consulta de Inventario, en UN viaje.
 *
 * Antes eran cuatro, y encadenados: productos por principio activo → RPC de
 * ids por descripción → inventory por esos ids → productos otra vez por las
 * fotos. Cada uno esperaba al anterior, así que la espera era la SUMA.
 * Medido el 2026-08-07 en el navegador: 2.667 ms de mediana, con la base
 * respondiendo cada tramo en menos de 400 ms. El costo era la cadena.
 *
 * `buscar_inventario_global` hace las cuatro cosas del lado del servidor y
 * devuelve las filas con `principio_activo` y `foto_url` ya adentro — así que
 * acá no queda nada que cruzar. Corre en 16,7 ms medidos con EXPLAIN ANALYZE,
 * y da EXACTAMENTE las mismas filas que la cadena vieja (comprobado sobre
 * «amoxicilina»: 151 = 151, cero de diferencia en los dos sentidos).
 *
 * Devuelve `json` y no `SETOF`: el corte de 1.000 filas de PostgREST no aplica.
 */
export async function buscarInventarioGlobal(termino) {
    const { data, error } = await supabase.rpc('buscar_inventario_global', { p_search: termino });
    if (error) { console.error('buscarInventarioGlobal:', error.message); return { filas: [], error }; }
    return { filas: data ?? [], error: null };
}

// Inventario con stock (cantidad > 0) que matchea por descripción O por una
// lista de product IDs (vía principio_activo). Incluye vencidos — el
// consumidor los separa. Paginado con fetchAllRows.
//
// Queda para quien todavía necesite el camino en piezas; la Consulta de
// Inventario usa `buscarInventarioGlobal`.
export async function searchInventory({ term, productIds = [] }) {
    const { data: descRows, error: descError } = await supabase.rpc('search_inventory_descripcion_ids', { p_search: term });
    if (descError) throw descError;
    const descIds = (descRows || []).map((r) => r.id);

    return await fetchAllRows(() => {
        let q = supabase
            .from('inventory')
            // `detalle` trae el factor de la presentación (`1x30`, `1x10`,
            // `1x1`) y sin él NO se puede sumar: `cantidad` está en la
            // presentación de la fila, no en unidades. Ver `unidadesDe` en
            // WidgetInventorySearch.
            .select('erp_sucursal_id, erp_product_id, descripcion, presentacion, detalle, lote, fecha_vencimiento, cantidad, is_vencidos')
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
            .select('erp_sucursal_id, erp_product_id, descripcion, presentacion, detalle, lote, fecha_vencimiento, cantidad')
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

/**
 * Lo que le falta a una sala y otra sí tiene.
 *
 * Tres condiciones, y cada una descarta un falso positivo: el producto está en
 * el min/max de la sala (si no, saldría medio catálogo), la sala no tiene ni
 * una unidad, y la que lo tiene queda por encima de su propio mínimo después
 * de ceder una — no se le saca el único que le queda para tapar el hueco de
 * otra. Todo eso vive en el RPC, no acá: son cuatro tablas cruzadas y traerlas
 * al navegador para filtrarlas sería el camino largo al mismo número.
 */
export async function fetchFaltantesConStockEnOtraSala(erpSucursalId, limite = 40) {
    if (!erpSucursalId) return { filas: [], error: null };
    const { data, error } = await supabase.rpc('get_faltantes_con_stock_en_otra_sala', {
        p_erp_sucursal_id: Number(erpSucursalId),
        p_limite: limite,
    });
    return { filas: data ?? [], error };
}
