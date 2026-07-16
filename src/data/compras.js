// Bloque 6.A — capa de datos, entidad "compras" (recepciones de bodega
// desde el ERP). Extraído de ComprasView.jsx: 5 llamadas supabase.from().
import { supabase } from '../supabaseClient';

export function fetchPurchaseReceiptItems(receiptId) {
    return supabase.from('purchase_receipt_items')
        .select('linea_num, erp_product_id, descripcion, cantidad, precio_unitario, total_linea, lote, fecha_vencimiento')
        .eq('receipt_id', receiptId)
        .order('linea_num');
}

export function fetchPurchaseReceiptsPage({ from, to, dateStart, dateEnd, sinProveedor, supplierId, searchTerm }) {
    let q = supabase
        .from('purchase_receipts')
        .select('id, erp_purchase_id, fecha, proveedor, estado, subtotal, iva, total, supplier_id, suppliers(nombre), purchase_receipt_items(id)', { count: 'exact' })
        .order('fecha', { ascending: false })
        .order('id',    { ascending: false })
        .range(from, to);

    if (dateStart) q = q.gte('fecha', dateStart);
    if (dateEnd)   q = q.lte('fecha', dateEnd);
    if (sinProveedor) q = q.is('supplier_id', null);
    else if (supplierId) q = q.eq('supplier_id', supplierId);
    if (searchTerm) {
        const term = searchTerm.trim();
        q = q.or(`proveedor.ilike.%${term}%`);
    }
    return q;
}

export function fetchProductPurchaseSummaryPage(from, to, searchTerm) {
    let q = supabase
        .from('product_purchase_summary')
        .select('erp_product_id, first_purchase_date, last_purchase_date, days_since_first_purchase, total_receipts, total_units_received, avg_cost, latest_cost, distinct_suppliers', { count: 'exact' })
        .order('last_purchase_date', { ascending: false })
        .range(from, to);

    if (searchTerm) {
        const term = searchTerm.trim();
        if (!isNaN(Number(term))) q = q.eq('erp_product_id', Number(term));
    }
    return q;
}

export function fetchSuppliersBasic() {
    return supabase.from('suppliers').select('id, nombre').order('nombre');
}

export function fetchUnlinkedPurchaseReceiptsCount() {
    return supabase.from('purchase_receipts').select('id', { count: 'exact', head: true }).is('supplier_id', null);
}
