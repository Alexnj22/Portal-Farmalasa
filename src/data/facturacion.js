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

// ── El sello de recepción de Hacienda son exactamente 40 caracteres ─────────
//
// `IS NOT NULL` **no** significa "tiene sello". Ese fue el bug: 24 facturas
// llegaron con `recibido_mh = 'undefined'` (la cadena, no el valor — el `??` del
// sync no la filtra) y como no eran NULL cayeron del lado "confirmada por
// Hacienda". No es que el módulo no las detectara: las reportaba como buenas.
// Lo destapó la diferencia contra el libro IVA del ERP (2026-07-31).
//
// PostgREST no expone `length()`, pero `like` con 40 `_` es equivalente: `_`
// matchea exactamente un carácter. Verificado contra prod — `like repeat('_',40)`
// y `length(...) = 40` devuelven la misma cuenta.
const SELLO_MH_LARGO = 40;
const SELLO_MH_LIKE = '_'.repeat(SELLO_MH_LARGO);

// ── Pendientes de confirmación Hacienda (SIN sello, esperando) ──────────────
//
// `recibido_mh IS NULL` a secas, y no "sin sello válido": un sello presente
// pero corrupto (`'undefined'`, largo != 40) NO es una espera. Esa factura no
// va a cambiar sola por más que pase el plazo — hay que corregirla en el ERP—,
// así que su lugar es Observaciones (`SELLO_INVALIDO`) y no esta cola.
//
// Medido el 2026-07-31 antes del cambio: de 185 pendientes, 23 eran sellos
// corruptos que además ya figuraban en Observaciones. La misma factura pedía
// solventarse dos veces, en dos tablas de resoluciones distintas.
//
// La frontera entre las dos pestañas es la CAUSA: falta el sello → acá;
// el dato está mal escrito → Observaciones.
export function fetchPendingMhInvoices(filterBranch) {
    return fetchAllRows(() => {
        let q = supabase
            .from('sales_invoices')
            .select('id, branch_id, tipo_documento, correlativo, erp_invoice_id, cliente, fecha, hora, total, estado, recibido_mh')
            .is('recibido_mh', null)
            .not('estado', 'eq', 'NULA')
            .order('branch_id', { ascending: true })
            .order('fecha',     { ascending: true })
            .order('hora',      { ascending: true });
        if (filterBranch) q = q.eq('branch_id', Number(filterBranch));
        return q;
    });
}

// `recibido_mh` es **text**: guarda el sello de recepción de Hacienda (40
// caracteres), no un booleano. Este filtro pasó por dos versiones malas antes de
// la buena, y las dos fallaban en silencio:
//
//   1. `.eq('recibido_mh', true)`     → `text = 'true'`: cero filas SIEMPRE
//                                       (en julio: 0 de 21,666).
//   2. `.not('recibido_mh','is',null)` → demasiadas: 'undefined' y '' entraban
//                                       como confirmadas.
//
// La buena exige la forma del dato, no su ausencia de NULL. Ver CLAUDE.md,
// "el tipo de la columna manda, no el nombre".
export function fetchConfirmedMhInvoices(filterBranch, fini, ffin) {
    let q = supabase
        .from('sales_invoices')
        .select('id, branch_id, tipo_documento, correlativo, erp_invoice_id, cliente, fecha, total')
        .like('recibido_mh', SELLO_MH_LIKE)
        .gte('fecha', fini).lte('fecha', ffin)
        .order('fecha', { ascending: false });
    if (filterBranch) q = q.eq('branch_id', Number(filterBranch));
    return q;
}

// ── Observaciones: cualquier anomalía, no solo el sello ─────────────────────
//
// Contraparte del RPC `get_invoice_observations` (migración 20260731172746).
// La gracia es que el catálogo de anomalías vive en UN solo lugar y del lado del
// servidor: agregar una clase nueva no requiere tocar el frontend, y los
// catch-alls (ESTADO_DESCONOCIDO, TIPO_DOC_DESCONOCIDO) hacen que un valor que
// el sync todavía no escribe aparezca solo el día que aparezca.
//
// Devuelve `observaciones` como array — una factura puede tener varias.
export function fetchInvoiceObservations(desde, hasta, filterBranch) {
    return supabase.rpc('get_invoice_observations', {
        p_desde: desde,
        p_hasta: hasta,
        p_branch_id: filterBranch ? Number(filterBranch) : null,
    });
}

// Tabla propia y no `sales_invoice_resolutions`: ver el comentario de la
// migración 20260731193337. Resumen — esa tabla es la cola del MH, y una
// factura observada suele estar además pendiente de sello; compartirla haría
// que "ya revisé la suma" la sacara de la cola con fecha límite de Hacienda.
export function fetchObservationResolutions(columns) {
    return supabase.from('sales_observation_resolutions')
        .select(columns).order('resolved_at', { ascending: false });
}

export function insertObservationResolution(payload) {
    return supabase.from('sales_observation_resolutions').insert(payload);
}

// Acá vivía `updateInvoiceReceivedMh`, que hacía `update({ recibido_mh: true })`
// al solventar un pendiente de MH: escribía la cadena 'true' ENCIMA del sello
// fiscal. Nunca corrompió nada porque `sales_invoices` no tiene policy de UPDATE
// y el RLS lo frenaba, pero era una bomba de tiempo.
//
// No se reemplaza por nada: el sello lo pone Hacienda vía sync, no el portal.
// Una resolución manual se registra en `sales_invoice_resolutions` y la factura
// queda con `recibido_mh` NULL — que es justo lo que el camino de lectura de
// FacturacionView ya esperaba ("manually resolved ... recibido_mh still null").

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
