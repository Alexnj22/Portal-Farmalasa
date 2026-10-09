// Bloque 6.A — capa de datos, entidad "productos" (catálogo). Extraído de
// TabCatalogo.jsx: 29 llamadas supabase.from() distintas. Dos pares de
// sitios eran duplicados literales (el update de foto_url en dos
// componentes de foto separados; el fetch de detalle expandido en
// prefetchRow y toggleRow) y quedan en una sola función acá.
import { supabase } from '../supabaseClient';
import { buscarIdsDeProducto, enElOrdenDe } from './busquedaProductos';
import { anotar, conBitacora } from './audit';
import { worstMarginOf } from '../utils/preciosDeProducto';

// Las escrituras de la ficha anotan su propia entrada en la bitácora (D3,
// 2026-09-28): cualquier cliente que las llame la deja. `contexto` son los
// datos legibles que sólo la pantalla conoce; la acción es fija.

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

/**
 * Reemplaza los principios activos de un producto —las filas y el texto de
 * `products.principio_activo`— y lo anota. Es lo que hace el editor de la ficha
 * del catálogo. Devuelve el resultado del último paso (el texto).
 */
export async function guardarPrincipiosActivos(productId, rows, text, contexto = {}) {
    await deleteProductActivePrinciples(productId);
    if (rows.length > 0) await insertProductActivePrinciples(rows);
    const res = await updateProductPrincipioActivo(productId, text);
    if (!res?.error) anotar('UPDATE_PRODUCT_PRINCIPLES', productId, { count: rows.length, ...contexto });
    return res;
}

// ── Categoría ────────────────────────────────────────────────────────────────

export function updateProductCategoria(productId, categoria) {
    return conBitacora(supabase.from('products').update({ tipo_medicamento: categoria || null }).eq('id', productId),
        'UPDATE_PRODUCT_CATEGORY', productId, { categoria: categoria || null });
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

/**
 * Guarda las ubicaciones de un producto por sala: las que tienen datos se
 * escriben, las vacías se borran. Anota una sola entrada por guardado.
 */
export async function guardarUbicacionesProducto(productId, toUpsert, toDelete, contexto = {}) {
    let error = null;
    if (toUpsert.length > 0) ({ error } = await upsertProductLocations(toUpsert));
    if (!error && toDelete.length > 0) ({ error } = await deleteProductLocations(productId, toDelete));
    if (!error) anotar('UPDATE_PRODUCT_LOCATIONS', productId, { branches: toUpsert.length, ...contexto });
    return { error };
}

// ── Devolutivo / foto ────────────────────────────────────────────────────────

export function updateProductDevolutivo(productId, value, contexto = {}) {
    return conBitacora(supabase.from('products').update({ devolutivo: value }).eq('id', productId),
        'PRODUCTO_DEVOLUTIVO', productId, { devolutivo: value, ...contexto });
}

/** ¿Se muestra en el catálogo de la app de clientes? Por defecto sí; una fila en `app_catalogo_ocultos` lo oculta. */
export async function fetchVisibleEnApp(productId) {
    const { data, error } = await supabase.from('app_catalogo_ocultos').select('product_id').eq('product_id', productId).maybeSingle();
    if (error) throw error;
    return !data;
}

export async function setVisibleEnApp(productId, visible, contexto = {}) {
    const q = visible
        ? supabase.from('app_catalogo_ocultos').delete().eq('product_id', productId)
        : supabase.from('app_catalogo_ocultos').upsert({ product_id: productId }, { onConflict: 'product_id', ignoreDuplicates: true });
    const { error } = await q;
    if (error) throw error;
    anotar(visible ? 'PRODUCTO_MOSTRAR_EN_APP' : 'PRODUCTO_OCULTAR_EN_APP', productId, { visible, ...contexto });
}

export function updateProductFoto(productId, fotoUrl) {
    return supabase.from('products').update({ foto_url: fotoUrl }).eq('id', productId);
}

// Decir que un producto NO tiene principio activo lo saca de la clasificación
// regulada: es una decisión de una persona sobre el catálogo, y se toma de a
// cientos en una corrida. Por eso se anota siempre.
export function updateProductSinPrincipioActivo(productId, value) {
    return conBitacora(supabase.from('products').update({ sin_principio_activo: value }).eq('id', productId),
        'MARCAR_SIN_PRINCIPIO_ACTIVO', productId, { sin_principio_activo: value });
}

// ── Enriquecimiento SRS (principios activos por lote) ───────────────────────

/**
 * La cola del enriquecimiento SRS, con los del LIBRO BAJO RECETA primero.
 *
 * Son 3,676 productos sin principio activo y la cola iba por orden alfabético,
 * así que los 47 que le importan al libro —los antibióticos— quedaban repartidos
 * entre todos y la deuda no bajaba nunca. Y ahí el principio activo no es un
 * dato lindo de tener: es lo único que permite comprobar la regla por molécula;
 * sin él la única defensa es acertarle al nombre comercial, que ya falló una vez
 * (BACTIVANZ 300 resultó ser cefdinir, no claritromicina).
 *
 * Se filtra por `es_antibiotico`, que hoy cubre los 47 exactos (verificado el
 * 2026-09-22: 47 por la casilla, 0 que entren sólo por `dispensacion_clases`).
 * Si algún día una clase agrega un producto que la casilla no marca, ése vuelve
 * a caer en el montón — lo dirá `npm run gate:receta`.
 */
export async function fetchProductsWithoutPrincipioActivo(batchSize) {
    const pendientes = () => supabase
        .from('products')
        .select('id, nombre, laboratorios(nombre)')
        .eq('activo', true)
        .eq('sin_principio_activo', false)
        .or('principio_activo.is.null,principio_activo.eq.');

    const { data: libro, error } = await pendientes()
        .eq('es_antibiotico', true)
        .order('nombre')
        .limit(batchSize);
    if (error) return { data: null, error };

    const faltan = batchSize - (libro?.length ?? 0);
    if (faltan <= 0) return { data: libro, error: null };

    // `not is true` y no `eq false`: la casilla admite nulo, y un `eq false`
    // dejaría fuera a todos los que nadie clasificó — que son la mayoría.
    const { data: resto, error: e2 } = await pendientes()
        .not('es_antibiotico', 'is', true)
        .order('nombre')
        .limit(faltan);
    if (e2) return { data: null, error: e2 };

    return { data: [...(libro ?? []), ...(resto ?? [])], error: null };
}

// ── Stats de márgen (página recursiva, PostgREST cap-safe) ──────────────────

// El costo NO se lee de la tabla: desde la regla 5 (docs/PLAN-CERRAR-AUTORIZACION)
// la columna sólo la entrega `get_precios_con_costo`, que mira el permiso de
// costos y devuelve `[]` sin él. Es un único JSON (Patrón C): la primera página
// trae todo y las siguientes vienen vacías, así el bucle del llamador termina.
async function preciosConCosto(productIds, soloActivos = true) {
    const { data, error } = await supabase.rpc('get_precios_con_costo', {
        p_product_ids: productIds, p_solo_activos: soloActivos,
    });
    return { data: error ? null : (data || []), error };
}

export async function fetchProductPreciosMarginPage(_priceSelect, from) {
    if (from > 0) return { data: [], error: null };
    const { data, error } = await preciosConCosto(null);
    return { data: data && data.filter(r => Number(r.costo) > 0), error };
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

const CATALOGO_SELECT = 'id, nombre, principio_activo, tipo_medicamento, es_antibiotico, requiere_receta, activo, foto_url, devolutivo, laboratorios(nombre)';

/*
 * Con búsqueda, el texto lo resuelve `buscar_productos_ids` (la regla del
 * portal: el nombre, el principio activo y el laboratorio, que la tabla
 * muestra, y el código de barras). Es un catálogo: con el orden por defecto,
 * lo más parecido va primero (plan §8.1); si el usuario eligió otra columna,
 * manda esa columna.
 */
export async function fetchProductsList({
    search, page, pageSize, filterActivo, laboratorioId, categoria,
    filterNuevos, effectiveBids, sortField, sortDir,
}) {
    const filtrar = (qb) => {
        if (filterActivo === 'activos') qb = qb.eq('activo', true);
        if (laboratorioId) qb = qb.eq('laboratorio_id', laboratorioId);
        if (categoria) qb = qb.eq('tipo_medicamento', categoria);
        if (filterNuevos) qb = qb.gte('created_at', filterNuevos);
        if (effectiveBids !== null) qb = qb.in('id', effectiveBids);
        return qb;
    };

    let idsBuscados = null;
    let aproximado = false;
    if (search) {
        const { ids, aproximado: sonParecidos, error } = await buscarIdsDeProducto(search, {
            limite: 1000, conPrincipioActivo: true, conLaboratorio: true,
            soloActivos: filterActivo === 'activos',
        });
        if (error) return { data: null, count: 0, error };
        if (!ids.length) return { data: [], count: 0, error: null };
        idsBuscados = ids;
        aproximado = sonParecidos;

        // Orden por defecto + búsqueda = relevancia. Primero los ids que pasan
        // los filtros (sólo el id: pocos bytes), después la página en ese orden.
        if (sortField === 'nombre' && sortDir === 'asc') {
            const { data: quedan, error: e1 } = await filtrar(
                supabase.from('products').select('id').in('id', ids));
            if (e1) return { data: null, count: 0, error: e1 };
            const orden = enElOrdenDe(quedan, ids).map(r => r.id);
            const pagina = orden.slice((page - 1) * pageSize, page * pageSize);
            if (!pagina.length) return { data: [], count: orden.length, error: null, aproximado };
            const { data, error: e2 } = await supabase.from('products')
                .select(CATALOGO_SELECT).in('id', pagina);
            if (e2) return { data: null, count: 0, error: e2 };
            return { data: enElOrdenDe(data, pagina), count: orden.length, error: null, aproximado };
        }
    }

    let qb = supabase
        .from('products')
        .select(CATALOGO_SELECT, { count: 'exact' })
        .range((page - 1) * pageSize, page * pageSize - 1);
    if (idsBuscados) qb = qb.in('id', idsBuscados);
    qb = filtrar(qb);

    if (sortField === 'nombre')        qb = qb.order('nombre', { ascending: sortDir === 'asc' });
    else if (sortField === 'activo')   qb = qb.order('activo', { ascending: sortDir === 'asc' }).order('nombre');
    else if (sortField === 'categoria') qb = qb.order('tipo_medicamento', { ascending: sortDir === 'asc', nullsFirst: false }).order('nombre');
    else if (sortField === 'lab')      qb = qb.order('nombre', { referencedTable: 'laboratorios', ascending: sortDir === 'asc', nullsFirst: false }).order('nombre');
    else                               qb = qb.order('nombre');

    return { ...(await qb), aproximado };
}

// ── Datos derivados (changelog + margen) para un lote de IDs visibles ──────

export function fetchProductChangeAndMarginData(ids) {
    return Promise.all([
        supabase.from('product_precios_changelog').select('product_id').in('product_id', ids),
        supabase.from('products_changelog').select('product_id, campo, valor_anterior').in('product_id', ids),
        preciosConCosto(ids).then(r => ({ ...r, data: r.data && r.data.filter(p => Number(p.costo) > 0) })),
    ]);
}

/** Los precios de un producto por presentación, sin costos: para quien sólo
 *  tiene que decir cuánto cuesta (la ficha del producto en el teléfono). */
export function fetchPreciosDelProducto(productId, columnas) {
    return supabase.from('product_precios')
        .select(`id_presentacion, activo, descripcion, factor, ${columnas}, presentaciones(tipo)`)
        .eq('product_id', productId)
        .order('activo', { ascending: false });
}

// ── Detalle expandido de un producto (prefetch + expand comparten la forma) ─

export function fetchProductDetail(productId, priceSelect, canSeeCosts) {
    return Promise.all([
        canSeeCosts
            ? preciosConCosto([productId], false)
            : supabase.from('product_precios').select(`id_presentacion, activo, descripcion, factor, ${priceSelect}, presentaciones(tipo)`).eq('product_id', productId).order('activo', { ascending: false }),
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

/**
 * La fila de UN producto para su ficha: lo mismo que trae una fila del
 * catálogo (`CATALOGO_SELECT`) más si es perecedero. La ficha del teléfono no
 * pasa por la lista del catálogo, así que la pide sola.
 */
export function fetchFichaDeProducto(productId) {
    return supabase.from('products')
        .select(`${CATALOGO_SELECT}, perecedero, codigo_barras`)
        .eq('id', productId)
        .maybeSingle();
}

/** Las ubicaciones guardadas del producto en cada sala (vitrina/estante y bodega). */
export function fetchUbicacionesDeProducto(productId) {
    return supabase.from('product_locations')
        .select('branch_id, vitrina, estante, peldano, bodega_numero, bodega_peldano')
        .eq('product_id', productId);
}

/** El nombre de un producto, para la pantalla que llega con el id y nada más
 *  (un enlace o un aviso). `null` si no existe o si falla. */
export async function fetchNombreDeProducto(productId) {
    const { data, error } = await supabase.from('products').select('nombre').eq('id', productId).maybeSingle();
    if (error) { console.error('productos: fetchNombreDeProducto', error.message); return null; }
    return data?.nombre ?? null;
}

/** Los principios activos de un producto, en su orden (para editarlos). */
export async function fetchPrincipiosDeProducto(productId) {
    const { data, error } = await supabase.from('product_active_principles')
        .select('id, nombre, concentracion, orden').eq('product_id', productId).order('orden');
    if (error) throw error;
    return data ?? [];
}

// ── Las cuentas del catálogo, para el portal y el teléfono ─────────────────
// Vivían como bucles dentro de `TabCatalogo`. Se paginan solas (las dos fuentes
// pasan de 1000 filas) y devuelven los ids, que es lo que filtra la lista.

/** Los productos con alguna presentación en pérdida (<0 %) o con margen bajo (<15 %). */
export async function fetchIdsPorMargen(campos) {
    const perdida = new Set();
    const bajo = new Set();
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
        const { data, error } = await fetchProductPreciosMarginPage(null, from);
        if (error || !data) break;
        for (const pp of data) {
            const w = worstMarginOf(pp, campos);
            if (w === null) continue;
            if (w < 0) perdida.add(pp.product_id);
            if (w < 15) bajo.add(pp.product_id);
        }
        if (data.length !== PAGE) break;
    }
    return { perdida, bajo };
}

/** Los productos con algún cambio (ficha o precio) desde `inicioIso`; sin los cambios ocultos. */
export async function fetchIdsModificadosDesde(inicioIso, ocultos = new Set(['laboratorio_id'])) {
    const ids = new Set();
    const PAGE = 1000;
    const recorrer = async (tabla) => {
        const esProd = tabla === 'products_changelog';
        for (let from = 0; ; from += PAGE) {
            const { data, error } = await fetchChangelogPage(tabla, esProd, inicioIso, from, PAGE);
            if (error) throw error;
            for (const r of data ?? []) {
                if (esProd && ocultos.has(r.campo) && !r.valor_anterior) continue;
                ids.add(r.product_id);
            }
            if ((data ?? []).length !== PAGE) break;
        }
    };
    await Promise.all([recorrer('products_changelog'), recorrer('product_precios_changelog')]);
    return ids;
}
