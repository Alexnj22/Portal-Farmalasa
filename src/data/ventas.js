// Bloque 6.A — capa de datos, entidad "ventas" (facturas de venta,
// items, precios, changelog). Extraído de VentasView.jsx: 13 llamadas
// supabase.from().
import { supabase } from '../supabaseClient';
import { fetchAllRows } from '../utils/supabaseUtils';

export function fetchAntibioticProductIds() {
    return supabase.from('products').select('id').eq('es_antibiotico', true);
}

export function fetchInvoiceIdsByProductIds(productIds) {
    return supabase.from('sales_invoice_items').select('invoice_id').in('erp_product_id', productIds);
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
export function fetchInvoicesForStatsSpecial({ fini, ffin, branchFilter, filterAnuladas, cancelledEstados, filterAntibiotico, abInvoiceIds, isSearching, searchTerm }) {
    return fetchAllRows(() => {
        let q = supabase.from('sales_invoices').select('id, total').gte('fecha', fini).lte('fecha', ffin);
        if (branchFilter) q = q.eq('branch_id', branchFilter);
        if (filterAnuladas) q = q.in('estado', cancelledEstados);
        else q = q.not('estado', 'in', `(${cancelledEstados.join(',')})`);
        if (filterAntibiotico) q = q.in('id', abInvoiceIds);
        if (isSearching) {
            const s = searchTerm.trim();
            q = q.or(`erp_invoice_id.ilike.%${s}%,correlativo.ilike.%${s}%,cliente.ilike.%${s}%`);
        }
        return q;
    });
}

export function fetchInvoicesList({ fini, ffin, sortCol, asc, filterBranch, filterAnuladas, cancelledEstados, abIdsFilter, isSearching, searchTerm, page, pageSize }) {
    let q = supabase
        .from('sales_invoices')
        .select('id, branch_id, erp_invoice_id, correlativo, tipo_documento, fecha, hora, cliente, cod_vendedor, tipo_pago, subtotal, iva, total, estado, recibido_mh, has_puntos')
        .gte('fecha', fini).lte('fecha', ffin)
        .order(sortCol, { ascending: asc });
    if (sortCol === 'fecha') q = q.order('hora', { ascending: asc });
    if (filterBranch) q = q.eq('branch_id', Number(filterBranch));
    if (filterAnuladas) q = q.in('estado', cancelledEstados);
    if (abIdsFilter) q = q.in('id', abIdsFilter);
    if (isSearching) {
        const s = searchTerm.trim();
        q = q.or(`erp_invoice_id.ilike.%${s}%,correlativo.ilike.%${s}%,cliente.ilike.%${s}%`).limit(200);
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
