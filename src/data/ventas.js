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
 * La lista de Ventas y sus totales viven en la BASE, no acá. Las dos.
 *
 * Nacieron para el filtro «Receta Médica» y desde el 2026-08-21 sirven también
 * al camino normal, por `soloReceta`. Son la misma consulta con una línea de
 * diferencia, y unificarlas no fue prolijidad: eran DOS caminos con el MISMO
 * bug, y sólo uno estaba arreglado.
 *
 * ── El bug de «Receta Médica» (arreglado el 2026-08-17) ──
 * Pedía los `invoice_id` de `sales_invoice_items` con un `.in('erp_product_id',
 * …)` sin paginar y los reinyectaba como `.in('id', …)`. PostgREST corta en
 * 1000 filas sin avisar: contra 4,013 renglones reales el navegador veía 901
 * facturas de 3,655, y como la consulta tampoco llevaba fechas, el recorte caía
 * repartido por toda la historia. Agosto/2026 mostraba 8 ventas de 93.
 *
 * ── El mismo bug en el camino normal (arreglado el 2026-08-21) ──
 * `search_ventas_ids` devuelve SETOF y se llamaba con `supabase.rpc()` sin
 * paginar, así que el mismo tope de 1000 la cortaba. Medido contra producción:
 *
 *     buscar «maria» · Este mes         →    810 filas   (entra)
 *     buscar «maria» · Últimos 6 meses  →  7,540 filas   → llegaban 1,000
 *     buscar «maria» · Este año         →  9,777 filas   → llegaban 1,000
 *
 * Y no era sólo que faltaran filas: los totales del encabezado se SUMABAN sobre
 * el conjunto recortado, así que el monto y el conteo en pantalla no eran los
 * del período. Después la lista pintaba 200 de esos 1,000 arbitrarios. Los dos
 * rangos están a un clic en el PeriodPicker.
 *
 * La salida es la misma de siempre: cuando el conjunto no cabe ni en la
 * respuesta ni en la URL, el filtro va a la base. Adentro de la función,
 * `search_ventas_ids` se llama como SUBCONSULTA y ahí el tope no existe.
 *
 * `p_anuladas` es 'todas' | 'solo' | 'excluir' porque la lista y los totales
 * NO piden lo mismo — ver dónde los llama VentasView.
 *
 * `p_solo_receta` es el DÉCIMO argumento de la lista y el SEXTO de los totales,
 * y las dos llamadas se mueven juntas: si dejan de coincidir, el encabezado
 * vuelve a hablar de una lista que no está en pantalla.
 */
export function fetchVentasConReceta({ fini, ffin, branchFilter, anuladas, searchTerm, sortCol, sortDir, page, pageSize, soloReceta = true }) {
    return supabase.rpc('get_ventas_con_receta', {
        p_fini:         fini,
        p_ffin:         ffin,
        p_branch_id:    branchFilter ? Number(branchFilter) : null,
        p_anuladas:     anuladas,
        p_search:       searchTerm?.trim() || null,
        p_sort_col:     sortCol,
        p_sort_dir:     sortDir,
        p_limit:        pageSize,
        p_offset:       (page - 1) * pageSize,
        p_solo_receta:  soloReceta,
    });
}

export function fetchVentasRecetaStats({ fini, ffin, branchFilter, anuladas, searchTerm, soloReceta = true }) {
    return supabase.rpc('get_ventas_receta_stats', {
        p_fini:         fini,
        p_ffin:         ffin,
        p_branch_id:    branchFilter ? Number(branchFilter) : null,
        p_anuladas:     anuladas,
        p_search:       searchTerm?.trim() || null,
        p_solo_receta:  soloReceta,
    });
}

/*
 * Acá vivían `fetchPuntosLineItems` y `fetchInvoicesForStatsSpecial`, que
 * armaban en el navegador los totales del encabezado cuando había búsqueda o el
 * chip «Anuladas». Las dos se fueron el 2026-08-21 con el camino que las
 * necesitaba, y conviene saber por qué para no volver a escribirlas.
 *
 * `fetchInvoicesForStatsSpecial` paginaba bien su propio select —usaba
 * `fetchAllRows`, con su `.order('id')` obligatorio y todo—, pero le entraba
 * una lista de ids que YA venía recortada: `search_ventas_ids` devuelve SETOF y
 * se la llamaba con `supabase.rpc()` sin paginar, así que PostgREST la cortaba
 * en 1,000. Con «maria» sobre «Este año» eran 9,777 facturas.
 *
 * O sea que la mitad cuidadosa de la función era irrelevante: **paginaba con
 * precisión sobre un conjunto que ya estaba mal**. Es la forma más difícil de
 * ver de este bug — el código que se lee como correcto porque lo es, sobre una
 * entrada que no.
 *
 * Hoy el conteo, el monto y los puntos salen de `get_ventas_receta_stats` en
 * UNA llamada, con el conjunto armado adentro de la base, donde
 * `search_ventas_ids` es una subconsulta y el tope no existe.
 */

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

/*
 * Los renglones de las facturas de la página. PAGINA, aunque la entrada esté
 * acotada: `invoice_id` se repite, así que 100 facturas no son 100 filas.
 *
 * Lo normal son ~170 (1.7 renglones por factura, medido), pero el techo es
 * alcanzable: las 100 facturas con más renglones de la historia suman **1,846**.
 * Están repartidas en 18 meses, así que no se juntan navegando; sí puede
 * juntarlas un filtro. Y si se cortara, no avisa: faltarían renglones al abrir
 * una venta y la etiqueta «Receta Médica» no se pintaría — un vacío que se ve
 * igual que un producto que no está.
 *
 * El desempate por `id` no es decorativo: `range()` corta por POSICIÓN, y
 * `total_linea` empata todo el tiempo (dos renglones del mismo precio). Sin
 * orden total, la base puede mandar la misma fila en dos páginas y perder otra.
 */
export async function fetchInvoiceItemsByIds(invoiceIds) {
    const data = await fetchAllRows(() => supabase.from('sales_invoice_items')
        .select('invoice_id, erp_product_id, descripcion, presentacion, cantidad, precio_unitario, total_linea, lote, fecha_vencimiento')
        .in('invoice_id', invoiceIds)
        .order('total_linea', { ascending: false })
        .order('id', { ascending: true }));
    return { data };
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
