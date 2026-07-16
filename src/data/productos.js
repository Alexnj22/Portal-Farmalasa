// Bloque 6.A — capa de datos, entidad "productos" (catálogo). Extraído de
// TabCatalogo.jsx: 29 llamadas supabase.from() distintas. Dos pares de
// sitios eran duplicados literales (el update de foto_url en dos
// componentes de foto separados; el fetch de detalle expandido en
// prefetchRow y toggleRow) y quedan en una sola función acá.
import { supabase } from '../supabaseClient';

// ── Principios activos ──────────────────────────────────────────────────────

export function deleteProductActivePrinciples(productId) {
    return supabase.from('product_active_principles').delete().eq('product_id', productId);
}

export function insertProductActivePrinciples(rows) {
    return supabase.from('product_active_principles').insert(rows);
}

export function updateProductPrincipioActivo(productId, text) {
    return supabase.from('products').update({ principio_activo: text || null }).eq('id', productId);
}

// ── Categoría ────────────────────────────────────────────────────────────────

export function updateProductCategoria(productId, categoria) {
    return supabase.from('products').update({ tipo_medicamento: categoria || null }).eq('id', productId);
}

export function insertProductCategory(nombre) {
    return supabase.from('product_categories').insert({ nombre });
}

// ── Ubicaciones ──────────────────────────────────────────────────────────────

export function upsertProductLocations(rows) {
    return supabase.from('product_locations').upsert(rows, { onConflict: 'product_id,branch_id' });
}

export function deleteProductLocations(productId, branchIds) {
    return supabase.from('product_locations').delete().eq('product_id', productId).in('branch_id', branchIds);
}

// ── Devolutivo / foto ────────────────────────────────────────────────────────

export function updateProductDevolutivo(productId, value) {
    return supabase.from('products').update({ devolutivo: value }).eq('id', productId);
}

export function updateProductFoto(productId, fotoUrl) {
    return supabase.from('products').update({ foto_url: fotoUrl }).eq('id', productId);
}

export function updateProductSinPrincipioActivo(productId, value) {
    return supabase.from('products').update({ sin_principio_activo: value }).eq('id', productId);
}

// ── Enriquecimiento SRS (principios activos por lote) ───────────────────────

export function fetchProductsWithoutPrincipioActivo(batchSize) {
    return supabase
        .from('products')
        .select('id, nombre, laboratorios(nombre)')
        .eq('activo', true)
        .eq('sin_principio_activo', false)
        .or('principio_activo.is.null,principio_activo.eq.')
        .limit(batchSize)
        .order('nombre');
}

// ── Stats de márgen (página recursiva, PostgREST cap-safe) ──────────────────

export function fetchProductPreciosMarginPage(priceSelect, from, pageSize) {
    return supabase.from('product_precios')
        .select(`product_id, costo, ${priceSelect}`)
        .eq('activo', true)
        .gt('costo', 0)
        .range(from, from + pageSize - 1);
}

// ── Contadores de productos (activos/inactivos/nuevos del mes) ─────────────

export function fetchProductCounts(startOfMonthIso) {
    return Promise.all([
        supabase.from('products').select('*', { count: 'exact', head: true }).eq('activo', true),
        supabase.from('products').select('*', { count: 'exact', head: true }).eq('activo', false),
        supabase.from('products').select('*', { count: 'exact', head: true }).gte('created_at', startOfMonthIso),
    ]);
}

// ── Changelog (página recursiva, PostgREST cap-safe) ────────────────────────
// products_changelog trae 'campo, valor_anterior' además de product_id (usado
// para filtrar CHANGELOG_HIDDEN); product_precios_changelog solo necesita el id.

export function fetchChangelogPage(table, isProd, startOfMonthIso, from, pageSize) {
    return supabase.from(table)
        .select(isProd ? 'product_id, campo, valor_anterior' : 'product_id')
        .gte('detected_at', startOfMonthIso)
        .range(from, from + pageSize - 1);
}

// ── Lista principal de productos (tabla paginada del catálogo) ─────────────

export function fetchProductsList({
    search, page, pageSize, filterActivo, laboratorioId, categoria,
    filterNuevos, effectiveBids, sortField, sortDir,
}) {
    let qb = supabase
        .from('products')
        .select('id, nombre, principio_activo, tipo_medicamento, es_antibiotico, requiere_receta, activo, foto_url, devolutivo, laboratorios(nombre)', { count: 'exact' })
        .range((page - 1) * pageSize, page * pageSize - 1);

    if (search) qb = qb.or(`nombre.ilike.%${search}%,principio_activo.ilike.%${search}%`);
    if (filterActivo === 'activos') qb = qb.eq('activo', true);
    if (laboratorioId) qb = qb.eq('laboratorio_id', laboratorioId);
    if (categoria) qb = qb.eq('tipo_medicamento', categoria);
    if (filterNuevos) qb = qb.gte('created_at', filterNuevos);
    if (effectiveBids !== null) qb = qb.in('id', effectiveBids);

    if (sortField === 'nombre')        qb = qb.order('nombre', { ascending: sortDir === 'asc' });
    else if (sortField === 'activo')   qb = qb.order('activo', { ascending: sortDir === 'asc' }).order('nombre');
    else if (sortField === 'categoria') qb = qb.order('tipo_medicamento', { ascending: sortDir === 'asc', nullsFirst: false }).order('nombre');
    else if (sortField === 'lab')      qb = qb.order('nombre', { referencedTable: 'laboratorios', ascending: sortDir === 'asc', nullsFirst: false }).order('nombre');
    else                               qb = qb.order('nombre');

    return qb;
}

// ── Datos derivados (changelog + margen) para un lote de IDs visibles ──────

export function fetchProductChangeAndMarginData(ids, priceSelect) {
    return Promise.all([
        supabase.from('product_precios_changelog').select('product_id').in('product_id', ids),
        supabase.from('products_changelog').select('product_id, campo, valor_anterior').in('product_id', ids),
        supabase.from('product_precios').select(`product_id, costo, ${priceSelect}`).in('product_id', ids).eq('activo', true).gt('costo', 0),
    ]);
}

// ── Detalle expandido de un producto (prefetch + expand comparten la forma) ─

export function fetchProductDetail(productId, priceSelect, canSeeCosts) {
    return Promise.all([
        supabase.from('product_precios').select(`id_presentacion, activo, descripcion, factor, costo, ${priceSelect}, presentaciones(tipo)`).eq('product_id', productId).order('activo', { ascending: false }),
        supabase.from('product_precios_changelog').select('id_presentacion, campo, valor_anterior, valor_nuevo, detected_at').eq('product_id', productId).order('detected_at', { ascending: false }),
        supabase.from('products_changelog').select('campo, valor_anterior, valor_nuevo, detected_at').eq('product_id', productId).order('detected_at', { ascending: false }),
        supabase.from('product_active_principles').select('id, nombre, concentracion, orden').eq('product_id', productId).order('orden'),
        canSeeCosts
            ? supabase.from('purchase_receipt_items').select('cantidad, precio_unitario, purchase_receipts(fecha, proveedor)').eq('erp_product_id', productId).order('receipt_id', { ascending: false }).limit(60)
            : Promise.resolve({ data: [] }),
        // 7B.6 — serie histórica de precios vigentes (SCD2, distinto del
        // changelog campo-a-campo de arriba). product_precios_history ya
        // acumula una fila por corrida del sync aunque el precio no cambie
        // (write-churn preexistente, fuera de alcance tocar el sync acá) —
        // el dedupe de snapshots idénticos se hace en la UI, no en la query.
        supabase.from('product_precios_history')
            .select('id_presentacion, valid_from, vineta, descuento_1, vip, clinica, mayoreo, premium, precio_7, presentaciones(tipo)')
            .eq('product_id', productId)
            .order('id_presentacion', { ascending: true })
            .order('valid_from', { ascending: true }),
    ]);
}
