// Bloque 6.A — capa de datos, entidad "facturacion" (DTE/Hacienda:
// facturas NULA, pendientes de MH, saltos de correlativo, campos nulos,
// pagos no-efectivo). Extraído de FacturacionView.jsx: 23 llamadas
// supabase.from() (más 2 a supabase.storage.from('payment-proofs'),
// fuera de alcance — es acceso a bucket, no a tabla).
import { supabase } from '../supabaseClient';
import { fetchAllRows } from '../utils/supabaseUtils';

// ── Facturas NULA / con estado nulo ──────────────────────────────────────────
// sales_invoices está en la lista de CLAUDE.md de tablas que requieren
// paginación — el backlog de NULA/nulo puede superar 1000 filas.

export function fetchNulaInvoices(filterBranch) {
    return fetchAllRows(() => {
        let q = supabase
            .from('sales_invoices')
            .select('id, branch_id, tipo_documento, correlativo, erp_invoice_id, cliente, fecha, hora, total, estado, codigo_generacion, recibido_mh')
            .or('estado.eq.NULA,estado.is.null,estado.eq.undefined')
            .order('tipo_documento', { ascending: false })
            .order('fecha', { ascending: true })
            .order('hora', { ascending: true });
        if (filterBranch) q = q.eq('branch_id', Number(filterBranch));
        return q;
    });
}

// ── Pendientes de confirmación Hacienda (recibido_mh IS NULL) ──────────────

export function fetchPendingMhInvoices(filterBranch) {
    return fetchAllRows(() => {
        let q = supabase
            .from('sales_invoices')
            .select('id, branch_id, tipo_documento, correlativo, erp_invoice_id, cliente, fecha, hora, total, estado')
            .is('recibido_mh', null)
            .not('estado', 'eq', 'NULA')
            .order('branch_id', { ascending: true })
            .order('fecha',     { ascending: true })
            .order('hora',      { ascending: true });
        if (filterBranch) q = q.eq('branch_id', Number(filterBranch));
        return q;
    });
}

export function fetchConfirmedMhInvoices(filterBranch, fini, ffin) {
    let q = supabase
        .from('sales_invoices')
        .select('id, branch_id, tipo_documento, correlativo, erp_invoice_id, cliente, fecha, total')
        .eq('recibido_mh', true)
        .gte('fecha', fini).lte('fecha', ffin)
        .order('fecha', { ascending: false });
    if (filterBranch) q = q.eq('branch_id', Number(filterBranch));
    return q;
}

export function updateInvoiceReceivedMh(invoiceId) {
    return supabase.from('sales_invoices').update({ recibido_mh: true }).eq('id', invoiceId);
}

// ── Genérico: lookup de facturas por lote de IDs (columnas varían por caller) ─

export function fetchInvoicesByIds(ids, columns) {
    return supabase.from('sales_invoices').select(columns).in('id', ids);
}

// ── Resoluciones de anulación (sales_invoice_resolutions) ──────────────────

export function fetchInvoiceResolutionIds() {
    return supabase.from('sales_invoice_resolutions').select('invoice_id');
}

// ── WidgetAnnulmentRequest.jsx (2 de sus 7 sitios; los otros 4 son inserts
// idénticos que reutilizan insertApprovalRequestSilent de data/requests.js,
// y 1 es búsqueda de clientes en data/customers.js) ─────────────────────────

export function fetchInvoiceItemsForInvoice(invoiceId) {
    return supabase.from('sales_invoice_items')
        .select('descripcion, presentacion, cantidad, precio_unitario, total_linea')
        .eq('invoice_id', invoiceId)
        .order('total_linea', { ascending: false });
}

export function fetchBranchInvoicesForMonth(branchId, from, to) {
    return supabase.from('sales_invoices')
        .select('id, correlativo, fecha, total, tipo_documento, cliente, tipo_pago, branch_id, cod_vendedor')
        .eq('branch_id', Number(branchId))
        .gte('fecha', from).lte('fecha', to)
        .order('fecha', { ascending: false })
        .order('correlativo', { ascending: false })
        .limit(500);
}

export function fetchInvoiceResolutionsHistorial(columns) {
    return supabase.from('sales_invoice_resolutions').select(columns).order('resolved_at', { ascending: false });
}

export function insertInvoiceResolution(payload, selectCols) {
    const q = supabase.from('sales_invoice_resolutions').insert(payload);
    return selectCols ? q.select(selectCols) : q;
}

// ── Campos nulos (sales_invoice_nulls) ──────────────────────────────────────

export function fetchInvoiceNullIds() {
    return supabase.from('sales_invoice_nulls').select('id');
}

export function fetchSalesInvoiceNulls(filterBranch) {
    let q = supabase.from('sales_invoice_nulls').select('*');
    if (filterBranch) q = q.eq('branch_id', Number(filterBranch));
    return q;
}

export function insertNullResolution(payload) {
    return supabase.from('sales_null_resolutions').insert(payload);
}

export function fetchNullResolutionIds() {
    return supabase.from('sales_null_resolutions').select('null_id');
}

// ── Saltos de correlativo (sales_invoice_gaps) ──────────────────────────────

export function fetchSalesInvoiceGaps(filterBranch) {
    let q = supabase.from('sales_invoice_gaps').select('*');
    if (filterBranch) q = q.eq('branch_id', Number(filterBranch));
    return q;
}

export function fetchGapResolutions() {
    return supabase.from('sales_gap_resolutions').select('*').order('resolved_at', { ascending: false });
}

export function insertGapResolution(payload) {
    return supabase.from('sales_gap_resolutions').insert(payload).select('*');
}

// ── Pagos no-efectivo (sales_payment_confirmations) ─────────────────────────
// fetchAllRows nuevo acá: la query original no paginaba pese a filtrar
// sales_invoices (tabla flagged en CLAUDE.md) — un mes con mucho volumen
// de tarjeta/transferencia podía truncarse en silencio sobre 1000 filas.

export function fetchNonCashInvoices(filterBranch, fini, ffin, nonCashTypes) {
    return fetchAllRows(() => {
        let q = supabase
            .from('sales_invoices')
            .select('id, branch_id, tipo_documento, correlativo, erp_invoice_id, cliente, fecha, hora, total, tipo_pago')
            .in('tipo_pago', nonCashTypes)
            .gte('fecha', fini).lte('fecha', ffin)
            .order('tipo_pago', { ascending: true })
            .order('fecha', { ascending: false });
        if (filterBranch) q = q.eq('branch_id', Number(filterBranch));
        return q;
    });
}

export function fetchPaymentConfirmationIds() {
    return supabase.from('sales_payment_confirmations').select('invoice_id');
}

export function fetchPaymentConfirmationsHistorial() {
    return supabase.from('sales_payment_confirmations')
        .select('id, invoice_id, confirmed_by, confirmed_by_photo, confirmed_at, notes, proof_url, tipo_pago, branch_id')
        .order('confirmed_at', { ascending: false });
}

export function insertPaymentConfirmation(payload) {
    return supabase.from('sales_payment_confirmations').insert(payload).select('*');
}
