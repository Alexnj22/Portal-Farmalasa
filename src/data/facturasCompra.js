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

export async function setPurchaseDteProveedor(documentId, proveedorId) {
    const { error } = await supabase.rpc('set_purchase_dte_proveedor', { p_document_id: documentId, p_proveedor_id: proveedorId });
    if (error) throw error;
}

// Fase 3.2: fusiona un doc "confirmado sin JSON" (solo PDF) con el
// duplicado que sí trae el JSON completo — acción manual del usuario, ver
// PLAN-MEJORAS-DTE-PROVEEDORES-2026-07.md §3.2 (sin match automático: las
// filas sin JSON no guardan numero_control/monto/fecha/NIT).
export async function mergePurchaseDteDocuments(targetId, sourceId) {
    const { error } = await supabase.rpc('merge_purchase_dte_documents', {
        p_target_id: targetId, p_source_id: sourceId,
    });
    if (error) throw error;
}

// Fase 3.2: busca un documento YA sincronizado (con JSON) por su
// codigo_generacion exacto — usado tras extraer el UUID del PDF vía
// pdfjs-dist (ver utils/dtePdfCodigo.js). Devuelve null si no hay match.
export async function findPurchaseDteDocumentByCodigo(codigo) {
    const { data, error } = await supabase.rpc('find_purchase_dte_document_by_codigo', { p_codigo: codigo });
    if (error) throw error;
    return data || null;
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
    const baseName = row.codigo_generacion || `doc-${row.id}`;

    const jsonUrl = await getSignedFileUrl(row.json_path);
    if (jsonUrl) {
        const res = await fetch(jsonUrl);
        if (res.ok) { zip.file(`${baseName}.json`, await res.blob()); included++; }
    }
    if (row.pdf_path) {
        const pdfUrl = await getSignedFileUrl(row.pdf_path);
        if (pdfUrl) {
            const res = await fetch(pdfUrl);
            if (res.ok) { zip.file(`${baseName}.pdf`, await res.blob()); included++; }
        }
    }
    if (included === 0) throw new Error('No se pudo descargar ningún archivo de este documento.');

    const blob = await zip.generateAsync({ type: 'blob' });
    const a = Object.assign(window.document.createElement('a'), {
        href: URL.createObjectURL(blob),
        download: `${baseName}.zip`,
    });
    a.click();
    URL.revokeObjectURL(a.href);
}

// Descarga masiva — el edge function arma cada tanda server-side (tope 300
// docs por llamada, límite real de tiempo de ejecución, no del usuario) y el
// navegador las mergea en un solo ZIP final con JSZip. Sin tope para quien
// descarga — un rango de 1000+ documentos simplemente hace más tandas.
const ZIP_BATCH_SIZE = 300; // debe coincidir con MAX_ITEMS de export-purchase-dte-zip

export async function downloadPurchaseDteZipBulk(ids, onProgress) {
    const chunks = [];
    for (let i = 0; i < ids.length; i += ZIP_BATCH_SIZE) chunks.push(ids.slice(i, i + ZIP_BATCH_SIZE));

    const master = new JSZip();
    const manifestParts = [];
    for (let i = 0; i < chunks.length; i++) {
        onProgress?.(i + 1, chunks.length);
        const { data, error } = await supabase.functions.invoke('export-purchase-dte-zip', { body: { ids: chunks[i] } });
        if (error) throw new Error(await extractFunctionErrorMessage(error));
        const blob = data instanceof Blob ? data : new Blob([data]);
        const batchZip = await JSZip.loadAsync(blob);
        for (const [path, file] of Object.entries(batchZip.files)) {
            if (file.dir) continue;
            // manifest-errores.txt viene por tanda — juntarlas en vez de que
            // master.file() pise el de la tanda anterior (mismo nombre en
            // cada ZIP intermedio).
            if (path === 'manifest-errores.txt') { manifestParts.push(await file.async('string')); continue; }
            master.file(path, await file.async('uint8array'));
        }
    }
    if (manifestParts.length > 0) master.file('manifest-errores.txt', manifestParts.join('\n'));

    const finalBlob = await master.generateAsync({ type: 'blob' });
    const a = Object.assign(window.document.createElement('a'), {
        href: URL.createObjectURL(finalBlob),
        download: `facturas-compra-${new Date().toISOString().slice(0, 10)}.zip`,
    });
    a.click();
    URL.revokeObjectURL(a.href);
}
