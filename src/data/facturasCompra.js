// Facturas de Compra — capa de datos. Lectura vía RPC Patrón C (json_agg, sin
// paginación server-side — el rango de fechas acota el payload).
import JSZip from 'jszip';
import { supabase } from '../supabaseClient';
import { getSignedFileUrl } from '../utils/storageFiles';

// supabase-js lanza FunctionsHttpError con .message genérico
// ("Edge Function returned a non-2xx status code") — el mensaje real que arma
// la función (ej. "Máximo 300 documentos...") solo está en error.context
// (el Response crudo). Sin esto, el usuario nunca ve por qué falló.
async function extractFunctionErrorMessage(error) {
    try {
        const body = await error?.context?.json?.();
        if (body?.error) return body.error;
    } catch { /* respuesta no era JSON (ej. el ZIP binario en un 200) */ }
    return error?.message || 'Error desconocido';
}

export async function fetchPurchaseDteDocuments(desde, hasta) {
    const { data, error } = await supabase.rpc('get_purchase_dte_documents', { p_desde: desde, p_hasta: hasta });
    if (error) throw error;
    return data || [];
}

export async function fetchPurchaseDteReviewQueue(status = 'pendiente') {
    const { data, error } = await supabase.rpc('get_purchase_dte_review_queue', { p_status: status });
    if (error) throw error;
    return data || [];
}

export async function setPurchaseDteSupplier(documentId, supplierId) {
    const { error } = await supabase.rpc('set_purchase_dte_supplier', { p_document_id: documentId, p_supplier_id: supplierId });
    if (error) throw error;
}

export async function resolvePurchaseDteReview(reviewId, action, matchedDocumentId = null) {
    const { error } = await supabase.rpc('resolve_purchase_dte_review', {
        p_review_id: reviewId, p_action: action, p_matched_document_id: matchedDocumentId,
    });
    if (error) throw error;
}

export async function syncPurchaseEmailsNow({ dryRun = false, accountId = null } = {}) {
    const { data, error } = await supabase.functions.invoke('sync-purchase-emails', {
        body: { dry_run: dryRun, account_id: accountId },
    });
    if (error) throw new Error(await extractFunctionErrorMessage(error));
    return data;
}

// ZIP con JSON+PDF de un solo documento — liviano, se arma en el navegador
// (no amerita ida al servidor, ver decisión en el plan). "row" para no
// shadowear el `document` global (document.createElement más abajo).
export async function downloadPurchaseDtePackage(row) {
    const zip = new JSZip();
    let included = 0;

    const jsonUrl = await getSignedFileUrl(row.json_path);
    if (jsonUrl) {
        const res = await fetch(jsonUrl);
        if (res.ok) { zip.file(`${row.codigo_generacion}.json`, await res.blob()); included++; }
    }
    if (row.pdf_path) {
        const pdfUrl = await getSignedFileUrl(row.pdf_path);
        if (pdfUrl) {
            const res = await fetch(pdfUrl);
            if (res.ok) { zip.file(`${row.codigo_generacion}.pdf`, await res.blob()); included++; }
        }
    }
    if (included === 0) throw new Error('No se pudo descargar ningún archivo de este documento.');

    const blob = await zip.generateAsync({ type: 'blob' });
    const a = Object.assign(window.document.createElement('a'), {
        href: URL.createObjectURL(blob),
        download: `${row.codigo_generacion}.zip`,
    });
    a.click();
    URL.revokeObjectURL(a.href);
}

// Descarga masiva — arma el ZIP server-side (edge function, tope 300 docs) y
// lo entrega directo, sin persistir un archivo temporal en Storage.
export async function downloadPurchaseDteZipBulk(ids) {
    const { data, error } = await supabase.functions.invoke('export-purchase-dte-zip', { body: { ids } });
    if (error) throw new Error(await extractFunctionErrorMessage(error));
    const blob = data instanceof Blob ? data : new Blob([data]);
    const a = Object.assign(window.document.createElement('a'), {
        href: URL.createObjectURL(blob),
        download: `facturas-compra-${new Date().toISOString().slice(0, 10)}.zip`,
    });
    a.click();
    URL.revokeObjectURL(a.href);
}
