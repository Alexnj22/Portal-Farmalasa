// Bloque 6.A — capa de datos, entidad "ventas" (facturas de venta,
// items, precios, changelog). Extraído de VentasView.jsx: 13 llamadas
// supabase.from().
import { supabase } from '../supabaseClient';
import { fetchAllRows } from '../utils/supabaseUtils';

// Los productos bajo receta, para pintar el badge de cada renglón y para saber
// si la píldora «Receta Médica» tiene sentido. Son 79 sobre 5,212 — cabe de
// sobra bajo el tope de PostgREST, y aun así el filtro NO se resuelve con esta
// lista: ver el comentario de fetchVentasConReceta.
export function fetchAntibioticProductIds() {
    return supabase.from('products').select('id').eq('es_antibiotico', true);
}

/*
 * El filtro «Receta Médica» vive en la base, no acá.
 *
 * La versión anterior pedía los `invoice_id` de `sales_invoice_items` con un
 * `.in('erp_product_id', …)` sin paginar y los reinyectaba como `.in('id', …)`.
 * PostgREST corta en 1000 filas sin avisar: contra 4,013 renglones reales el
 * navegador veía 901 facturas de 3,655, y como la consulta tampoco llevaba
 * fechas, el recorte caía repartido por toda la historia. Agosto/2026 mostraba
 * 8 ventas de 93.
 *
 * Y traer la lista completa tampoco servía: con «Este año» son ~1,700 ids, y
 * esos ids viajan dentro de la URL del `.in()`.
 *
 * `p_anuladas` es 'todas' | 'solo' | 'excluir' porque la lista y los totales
 * NO piden lo mismo — ver dónde los llama VentasView.
 */
export function fetchVentasConReceta({ fini, ffin, branchFilter, anuladas, searchTerm, sortCol, sortDir, page, pageSize }) {
    return supabase.rpc('get_ventas_con_receta', {
        p_fini:      fini,
        p_ffin:      ffin,
        p_branch_id: branchFilter ? Number(branchFilter) : null,
        p_anuladas:  anuladas,
        p_search:    searchTerm?.trim() || null,
        p_sort_col:  sortCol,
        p_sort_dir:  sortDir,
        p_limit:     pageSize,
        p_offset:    (page - 1) * pageSize,
    });
}

export function fetchVentasRecetaStats({ fini, ffin, branchFilter, anuladas, searchTerm }) {
    return supabase.rpc('get_ventas_receta_stats', {
        p_fini:      fini,
        p_ffin:      ffin,
        p_branch_id: branchFilter ? Number(branchFilter) : null,
        p_anuladas:  anuladas,
        p_search:    searchTerm?.trim() || null,
    });
}

export function fetchPuntosLineItems(invoiceIds) {
    return supabase.from('sales_invoice_items')
        .select('invoice_id, total_linea')
        .eq('erp_product_id', 0)
        .in('invoice_id', invoiceIds);
}

// Usado por fetchStats con filtros especiales (anuladas/antibiótico/búsqueda) —
// fetchAllRows evita el cap silencioso de 1000 filas: sin esto, el monto
// mostrado podía quedar truncado aunque el conteo (count exact) fuera correcto.
export async function fetchInvoicesForStatsSpecial({ fini, ffin, branchFilter, filterAnuladas, cancelledEstados, isSearching, searchTerm }) {
    let searchIds = null;
    if (isSearching) {
        const { data, error } = await supabase.rpc('search_ventas_ids', { p_search: searchTerm.trim(), p_fini: fini, p_ffin: ffin });
        if (error) throw error;
        searchIds = (data || []).map((r) => r.id);
    }
    return fetchAllRows(() => {
        let q = supabase.from('sales_invoices').select('id, total').gte('fecha', fini).lte('fecha', ffin);
        if (branchFilter) q = q.eq('branch_id', branchFilter);
        if (filterAnuladas) q = q.in('estado', cancelledEstados);
        else q = q.not('estado', 'in', `(${cancelledEstados.join(',')})`);
        if (isSearching) q = q.in('id', searchIds.length > 0 ? searchIds : [0]);
        return q;
    });
}

// La forma de una fila de la lista de ventas. Sale del `.select()` a propósito:
// la cadena ya pasaba de 180 caracteres y `data-gate` mira una ventana de 450
// desde el `.from(` para decidir si la consulta pagina — con la lista adentro,
// el `.range()` de más abajo quedaba fuera de esa ventana y la consulta se
// reportaba como sin paginar. Pagina; lo que faltaba era que se pudiera ver.
const COLUMNAS_LISTA = 'id, branch_id, erp_invoice_id, correlativo, tipo_documento, ' +
    'fecha, hora, cliente, cod_vendedor, tipo_pago, subtotal, iva, retencion, total, ' +
    'estado, recibido_mh, has_puntos';

/*
 * El rótulo de la columna NO es el nombre de la columna.
 *
 * `DataTable` emite `onSort(col.key)` con la clave que se le declaró, y cuatro
 * de las ocho de esta tabla no existen en `sales_invoices`: Tipo es
 * `tipo_documento`, Sucursal es `branch_id`, Vendedor es `cod_vendedor` y
 * Método pago es `tipo_pago`. Sin este mapa, `.order('tipo')` devuelve 400 y
 * `fetchRows` sólo desestructura `data` — o sea que ordenar por cualquiera de
 * esas cuatro vaciaba la lista sin decir por qué.
 *
 * Es la regla de «un rótulo no es una clave» del CLAUDE.md, en su versión de
 * ordenamiento. La MISMA lista vive en la whitelist de `get_ventas_con_receta`
 * (migración 20260817175559) y las dos se mueven juntas.
 */
const COLUMNA_DE_ORDEN = {
    fecha:    'fecha',
    id:       'id',
    tipo:     'tipo_documento',
    sucursal: 'branch_id',
    vendedor: 'cod_vendedor',
    cliente:  'cliente',
    metodo:   'tipo_pago',
    total:    'total',
};

export async function fetchInvoicesList({ fini, ffin, sortCol, asc, filterBranch, filterAnuladas, cancelledEstados, isSearching, searchTerm, page, pageSize }) {
    const col = COLUMNA_DE_ORDEN[sortCol] || 'fecha';
    let q = supabase
        .from('sales_invoices')
        .select(COLUMNAS_LISTA)
        .gte('fecha', fini).lte('fecha', ffin)
        .order(col, { ascending: asc });
    if (col === 'fecha') q = q.order('hora', { ascending: asc });
    if (filterBranch) q = q.eq('branch_id', Number(filterBranch));
    if (filterAnuladas) q = q.in('estado', cancelledEstados);
    if (isSearching) {
        const { data, error } = await supabase.rpc('search_ventas_ids', { p_search: searchTerm.trim(), p_fini: fini, p_ffin: ffin });
        if (error) throw error;
        const searchIds = (data || []).map((r) => r.id);
        q = q.in('id', searchIds.length > 0 ? searchIds : [0]).limit(200);
    } else {
        q = q.range((page - 1) * pageSize, page * pageSize - 1);
    }
    return q;
}

export function fetchInvoiceItemsByIds(invoiceIds) {
    return supabase.from('sales_invoice_items')
        .select('invoice_id, erp_product_id, descripcion, presentacion, cantidad, precio_unitario, total_linea, lote, fecha_vencimiento')
        .in('invoice_id', invoiceIds)
        .order('total_linea', { ascending: false });
}

/**
 * Una venta puntual, por su id INTERNO.
 *
 * Nunca por correlativo: el número se repite entre salas —medido en prod, el
 * `0000068132_COF` existe en Salud 4 y en La Popular, con distinto cliente y
 * distinto monto— así que buscar por ahí puede traer la venta de otra sucursal.
 * `metadata.invoice_id` de la solicitud es esta clave.
 *
 * Reusa las columnas de la lista: es exactamente lo que hace falta para leer una
 * venta entera, y una segunda lista de columnas se separaría de aquélla.
 */
export function fetchInvoiceById(invoiceId) {
    return supabase.from('sales_invoices').select(COLUMNAS_LISTA).eq('id', invoiceId).maybeSingle();
}

export function fetchInvoiceItemsForInvoice(invoiceId) {
    return supabase.from('sales_invoice_items')
        .select('erp_product_id, descripcion, presentacion, cantidad, precio_unitario, total_linea, lote, fecha_vencimiento')
        .eq('invoice_id', invoiceId)
        .order('total_linea', { ascending: false });
}

export function fetchProductPreciosActivos(productIds) {
    return supabase.from('product_precios')
        .select('product_id, vineta, vip, clinica, mayoreo, premium, descuento_1, precio_7')
        .eq('activo', true)
        .in('product_id', productIds);
}

export function fetchInvoiceChangelog(invoiceIds) {
    return supabase.from('sales_invoice_changelog')
        .select('invoice_id, campo, valor_anterior, valor_nuevo')
        .in('invoice_id', invoiceIds);
}

export function fetchVendorMonthlyStats(mes, branchId) {
    return supabase.from('ventas_monthly_stats')
        .select('cod_vendedor, total_sum')
        .eq('mes', mes).eq('branch_id', branchId).neq('cod_vendedor', '');
}

export function fetchProductPreciosDetail(productId) {
    return supabase.from('product_precios')
        .select('id_presentacion, descripcion, vineta, vip, clinica, mayoreo, premium, descuento_1, precio_7, presentaciones(tipo)')
        .eq('product_id', productId)
        .eq('activo', true);
}

export function fetchProductPreciosHistory(productId) {
    return supabase.from('product_precios_history')
        .select('id_presentacion, vineta, vip, clinica, mayoreo, premium, descuento_1, precio_7, valid_from, valid_until, presentaciones(tipo)')
        .eq('product_id', productId)
        .order('valid_from', { ascending: false });
}
