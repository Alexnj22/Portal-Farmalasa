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

// Dispara la descarga de un Blob de forma confiable. Bug real 2026-07-22:
// a.click() + URL.revokeObjectURL(a.href) espalda-con-espalda (sin agregar
// el <a> al DOM) puede revocar el blob URL antes de que el navegador
// empiece a leerlo — la descarga se pierde en silencio, sin error en
// consola (justo lo reportado). El patrón robusto: agregar al DOM, click,
// remover, y revocar con demora (no inmediato).
function triggerDownload(blob, filename) {
    const a = Object.assign(window.document.createElement('a'), {
        href: URL.createObjectURL(blob),
        download: filename,
    });
    window.document.body.appendChild(a);
    a.click();
    window.document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
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

// Clasificar un PDF huérfano de Revisión (ej. sello ANULADO gráfico que la
// detección automática no pudo leer como texto): el usuario elige el tipo
// (anulacion|otro) y el documento DTE al que se enlaza; si es anulación el
// RPC marca ese documento invalidado, y en ambos casos la fila de revisión
// queda resuelta con matched_document_id (trazabilidad de qué PDF lo justificó).
export async function classifyPurchaseDteReview(reviewId, documentId, tipo, motivo = null) {
    const { error } = await supabase.rpc('classify_purchase_dte_review', {
        p_review_id: reviewId, p_document_id: documentId, p_tipo: tipo, p_motivo: motivo,
    });
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

// El PDF huérfano de Revisión que justificó marcar un documento invalidado
// (ver classify_purchase_dte_review) — para poder mostrar un link "Ver PDF
// de anulación" en el detalle del documento en vez de dejarlo sin rastro.
export async function fetchPurchaseDteReviewSource(documentId) {
    const { data, error } = await supabase.rpc('get_purchase_dte_review_source', { p_document_id: documentId });
    if (error) throw error;
    return (data || [])[0] || null;
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
    triggerDownload(blob, `${baseName}.zip`);
}

// Descarga masiva — el edge function arma cada tanda server-side (tope 300
// docs por llamada, límite real de tiempo de ejecución, no del usuario) y el
// navegador las mergea en un solo ZIP final con JSZip. Sin tope para quien
// descarga — un rango de 1000+ documentos simplemente hace más tandas.
const ZIP_BATCH_SIZE = 300; // debe coincidir con MAX_ITEMS de export-purchase-dte-zip
const ZIP_BATCH_TIMEOUT_MS = 120_000; // ver nota de invokeWithProgress abajo

// Medido en vivo 2026-07-23 (caso real: "Este mes", 518 docs, 2 tandas):
// el cuello de botella NO es el server (concurrencia de descarga probada
// en 16/40/80 sin diferencia — no era eso) ni la compresión (DEFLATE
// reduce <5% sobre PDFs ya comprimidos, y a esa escala directamente
// rompió el edge function por CPU) — es transferencia de datos real
// (~1.5-2MB/s sostenido, no mejora con más paralelismo del lado servidor).
// Con eso claro, dos cambios que sí ayudan sin arriesgar nada:
// (1) invocar las tandas en PARALELO (antes esperaban una a la otra sin
// ninguna dependencia real entre ellas — cada una es una llamada
// independiente al edge function); (2) reportar progreso real en bytes
// (Content-Length + ReadableStream) en vez de "tanda x/y" estático, para
// que la espera se sienta activa en vez de trabada — pedido explícito del
// usuario ("debe sentirse fluido"). Se usa fetch() crudo en vez de
// supabase.functions.invoke() porque este último no expone el Response
// crudo (necesario para leer el stream y su Content-Length).
async function invokeWithProgress(fnName, body, onBytes) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ZIP_BATCH_TIMEOUT_MS);
    try {
        const { data: { session } } = await supabase.auth.getSession();
        const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${fnName}`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${session?.access_token}`,
                apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
            signal: controller.signal,
        });
        if (!res.ok) {
            let msg = `HTTP ${res.status}`;
            try { const j = await res.json(); if (j.error) msg = j.error; } catch { /* respuesta no era JSON */ }
            throw new Error(msg);
        }
        const total = Number(res.headers.get('Content-Length')) || 0;
        if (!res.body) return await res.blob(); // fallback (navegadores sin streams body en respuestas)
        const reader = res.body.getReader();
        const parts = [];
        let received = 0;
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            parts.push(value);
            received += value.length;
            onBytes?.(received, total);
        }
        return new Blob(parts);
    } catch (e) {
        if (controller.signal.aborted) throw new Error('Tiempo de espera agotado armando el ZIP — probá con un rango de fechas más chico.');
        throw e;
    } finally {
        clearTimeout(timer);
    }
}

// includePendingReview: pedido del usuario 2026-07-22 — la descarga masiva
// también trae lo que sigue pendiente en Revisión (PDFs huérfanos, JSON
// inválido, etc.) en su propia carpeta "Revisar" dentro del ZIP. Se pide
// solo en la primera tanda para no duplicarlo cuando el rango necesita
// varias llamadas al edge function.
//
// onProgress recibe { received, total } en bytes (agregado de todas las
// tandas en curso) — el llamador decide cómo mostrarlo (ej. "34/67 MB").
export async function downloadPurchaseDteZipBulk(ids, onProgress, { includePendingReview = true } = {}) {
    const chunks = [];
    for (let i = 0; i < ids.length; i += ZIP_BATCH_SIZE) chunks.push(ids.slice(i, i + ZIP_BATCH_SIZE));
    if (chunks.length === 0) chunks.push([]); // ids vacío pero includePendingReview (solo carpeta Revisar)

    const progressByBatch = chunks.map(() => ({ received: 0, total: 0 }));
    const reportProgress = () => {
        onProgress?.({
            received: progressByBatch.reduce((s, p) => s + p.received, 0),
            total: progressByBatch.reduce((s, p) => s + p.total, 0),
        });
    };

    const blobs = await Promise.all(chunks.map((chunk, i) => invokeWithProgress(
        'export-purchase-dte-zip',
        { ids: chunk, include_pending_review: includePendingReview && i === 0 },
        (received, total) => { progressByBatch[i] = { received, total }; reportProgress(); },
    )));

    const filename = `facturas-compra-${new Date().toISOString().slice(0, 10)}.zip`;

    // Camino rápido: con una sola tanda no hace falta desempacar+reempacar
    // el ZIP que ya arma el edge function — se descarga tal cual.
    if (blobs.length === 1) {
        triggerDownload(blobs[0], filename);
        return;
    }

    const master = new JSZip();
    const manifestParts = [];
    for (const blob of blobs) {
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

    // STORE: los ZIP de cada tanda ya vienen sin comprimir (ver
    // export-purchase-dte-zip) — re-comprimir acá sería costo de CPU del
    // navegador sin beneficio real de tamaño (los PDF ya están comprimidos).
    const finalBlob = await master.generateAsync({ type: 'blob', compression: 'STORE' });
    triggerDownload(finalBlob, filename);
}
