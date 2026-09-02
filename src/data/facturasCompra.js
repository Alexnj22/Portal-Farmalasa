// Facturas de Compra — capa de datos. Lectura vía RPC Patrón C (json_agg, sin
// paginación server-side — el rango de fechas acota el payload).
import { supabase } from '../supabaseClient';
import { getSignedFileUrl } from '../utils/storageFiles';

import { registrarEgreso } from './egreso';
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

// Los respaldos de Revisión que justificaron marcar un documento invalidado
// (ver classify_purchase_dte_review) — para poder abrirlos desde el detalle en
// vez de dejar la anulación sin rastro.
//
// Devuelve la LISTA y no el primero: una anulación puede traer dos archivos —el
// PDF con el sello y el JSON del evento, con su propio sello de recepción del
// Ministerio de Hacienda— y quedarse con `[0]` dejaba al otro sin forma de
// abrirse. Vienen con el PDF primero y cada uno con su `kind`, que es lo que
// decide el rótulo.
export async function fetchPurchaseDteReviewSources(documentId) {
    const { data, error } = await supabase.rpc('get_purchase_dte_review_source', { p_document_id: documentId });
    if (error) throw error;
    return data || [];
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

// El ZIP se arma en el NAVEGADOR con client-zip (~3 kB), no con JSZip: JSZip
// necesita TODOS los archivos en memoria antes de generar nada, client-zip
// escribe entrada por entrada a medida que las recibe. Con los 181 MB de un
// mes eso es la diferencia entre un pico de memoria de ~700 MB y uno de ~0
// (ver downloadPurchaseDteZipBulk). Va por await import() — regla de
// librerías pesadas: solo hace falta al apretar Descargar, no al entrar.
let zipPromise = null;
function getZip() {
    if (!zipPromise) {
        zipPromise = import('client-zip')
            .catch(err => { zipPromise = null; throw err; });  // reintentar, no quedar roto
    }
    return zipPromise;
}

export function nombreZipFacturas() {
    return `facturas-compra-${new Date().toISOString().slice(0, 10)}.zip`;
}

// ZIP con JSON+PDF de un solo documento — liviano, se arma en el navegador
// (no amerita ida al servidor, ver decisión en el plan). "row" para no
// shadowear el `document` global (document.createElement más abajo).
export async function downloadPurchaseDtePackage(row) {
    const { downloadZip } = await getZip();
    const baseName = row.codigo_generacion || `doc-${row.id}`;
    const entradas = [];

    for (const [ext, path] of [['json', row.json_path], ['pdf', row.pdf_path]]) {
        if (!path) continue;
        const url = await getSignedFileUrl(path);
        if (!url) continue;
        const res = await fetch(url);
        if (res.ok) entradas.push({ name: `${baseName}.${ext}`, input: await res.blob() });
    }
    if (entradas.length === 0) throw new Error('No se pudo descargar ningún archivo de este documento.');

    triggerDownload(await downloadZip(entradas).blob(), `${baseName}.zip`);
    registrarEgreso('dte_compra', { formato: 'zip', filas: entradas.length, detalle: { documento: baseName } });
}

// ── Descarga masiva ────────────────────────────────────────────────────────
// El servidor NO mueve archivos: `export-purchase-dte-manifest` devuelve la
// lista de entradas del ZIP con su URL firmada, y el navegador baja cada
// archivo del CDN de Storage directo. Reemplaza (2026-08-03) al diseño de
// tandas de 300 documentos que armaba cada ZIP server-side.
//
// El motivo es el reintento. Medido con julio 2026 — 863 documentos, 1,726
// archivos, 181 MB — el diseño anterior bajaba en 3 tandas dentro de un
// `Promise.all`: si una se cortaba, se descartaban también las que ya habían
// terminado y se perdían los 181 MB completos. Encima las 3 tandas se
// disputaban el mismo ancho de banda, así que cada una tardaba lo que tardaba
// TODA la descarga y rozaba su propio timeout de 120s con la red en buen
// estado. Acá la unidad de reintento es UN archivo (~83 kB de promedio): un
// corte de red cuesta reintentar eso, no la descarga entera.
//
// Los otros dos problemas se caen solos con el mismo cambio: los bytes ya no
// viajan dos veces (Storage → edge function → navegador), y el ZIP se escribe
// en streaming en vez de acumular 181 MB de blobs + desempaquetarlos + volver
// a empaquetarlos, que era un pico de ~4× el tamaño de la descarga.
//
// Nota sobre el "~1.5-2MB/s sostenido" que medía el comentario anterior: ese
// número medía el proxy, no la red. Sin la ida y vuelta por la función, el
// techo lo pone la conexión del usuario contra el CDN.
const DESCARGA_CONCURRENCIA = 8;
// 5 intentos con espera 1s/2s/4s/8s = ~15s de tolerancia por archivo. El caso
// que hay que aguantar no es un 500 puntual sino la conexión que se cae y
// vuelve: con 3 intentos rápidos un bache de 10s ya perdía el archivo.
const INTENTOS_POR_ARCHIVO = 5;

const esperar = (ms) => new Promise(r => setTimeout(r, ms));

// Nunca rechaza: devuelve { blob } o { error }. Un archivo que no se pudo
// bajar tras los reintentos no puede tumbar la descarga completa — se anota
// en manifest-errores.txt dentro del ZIP y el resto sigue.
async function bajarArchivo(url) {
    let ultimo = 'no se pudo descargar';
    for (let intento = 1; intento <= INTENTOS_POR_ARCHIVO; intento++) {
        try {
            const res = await fetch(url);
            if (res.ok) return { blob: await res.blob() };
            ultimo = `HTTP ${res.status}`;
            // 404 = el objeto no está en Storage (fila apuntando a un archivo
            // borrado). Reintentar no lo va a traer.
            if (res.status === 404) break;
        } catch (e) {
            ultimo = e?.message || 'conexión interrumpida';
        }
        if (intento < INTENTOS_POR_ARCHIVO) await esperar(1000 * 2 ** (intento - 1));
    }
    return { error: ultimo };
}

async function pedirManifiesto(ids, includePendingReview) {
    const { data, error } = await supabase.functions.invoke('export-purchase-dte-manifest', {
        body: { ids, include_pending_review: includePendingReview },
    });
    if (error) throw new Error(await extractFunctionErrorMessage(error));
    if (!data?.files?.length) throw new Error('No hay archivos para descargar en este período.');
    return data;
}

// includePendingReview: pedido del usuario 2026-07-22 — la descarga masiva
// también trae lo que sigue pendiente en Revisión (PDFs huérfanos, JSON
// inválido, etc.) en su propia carpeta "Revisar" dentro del ZIP.
//
// onProgress recibe { hechos, total, bytes, fallidos } — el denominador ahora
// es la cantidad de ARCHIVOS, que se conoce desde el manifiesto y solo sube.
// El de antes eran bytes contra un Content-Length que aparecía tarde y por
// tanda, así que la barra arrancaba quieta mientras el servidor armaba el ZIP.
//
// fileHandle (File System Access API): si el llamador lo pasa, el ZIP se
// escribe DIRECTO al disco y la memoria del navegador queda constante sin
// importar el tamaño. Tiene que crearlo el llamador dentro del gesto del
// click (showSaveFilePicker lo exige). Sin él se cae al Blob de siempre, que
// igual es 1× el tamaño en vez de las 4× del diseño anterior.
export async function downloadPurchaseDteZipBulk(ids, onProgress, { includePendingReview = true, fileHandle = null } = {}) {
    const { files, warnings } = await pedirManifiesto(ids, includePendingReview);
    const { downloadZip } = await getZip();

    const total = files.length;
    const fallidos = [...(warnings || [])];   // los que ni se pudieron firmar
    let hechos = 0, incluidos = 0, bytes = 0;
    onProgress?.({ hechos, total, bytes, fallidos: fallidos.length });

    // Ventana deslizante: client-zip consume esta secuencia EN ORDEN y de a
    // una, así que la concurrencia tiene que venir de acá — se mantienen N
    // descargas en vuelo y se van entregando a medida que les toca el turno.
    // Acotada a propósito: sin tope, 1,726 fetch simultáneos volverían a
    // meter la descarga entera en memoria, que es justo lo que se quitó.
    async function* entradas() {
        const enVuelo = new Map();
        const lanzar = (i) => { if (i < files.length) enVuelo.set(i, bajarArchivo(files[i].url)); };
        for (let i = 0; i < DESCARGA_CONCURRENCIA; i++) lanzar(i);

        for (let i = 0; i < files.length; i++) {
            const pendiente = enVuelo.get(i);
            enVuelo.delete(i);
            lanzar(i + DESCARGA_CONCURRENCIA);

            const { blob, error } = await pendiente;
            hechos++;
            if (blob) { incluidos++; bytes += blob.size; }
            else fallidos.push(`${files[i].name}: ${error}`);
            onProgress?.({ hechos, total, bytes, fallidos: fallidos.length });

            if (blob) yield { name: files[i].name, input: blob };
        }

        if (fallidos.length > 0) {
            yield {
                name: 'manifest-errores.txt',
                input: `Archivos que no se pudieron incluir en este ZIP:\n\n${fallidos.join('\n')}\n`,
            };
        }
    }

    const res = downloadZip(entradas());
    if (fileHandle) {
        // pipeTo cierra el writable al terminar; si falla, lo aborta.
        await res.body.pipeTo(await fileHandle.createWritable());
    } else {
        triggerDownload(await res.blob(), nombreZipFacturas());
    }

    if (incluidos === 0) throw new Error('No se pudo descargar ningún archivo.');
    // La descarga masiva: se anota lo que de verdad entró al ZIP, no lo que se
    // pidió. `total` e `incluidos` difieren cuando algún archivo no estaba, y
    // para la línea base importa el que salió.
    registrarEgreso('dte_compra', {
        formato: 'zip', filas: incluidos,
        detalle: { masiva: true, pedidos: total, fallidos: fallidos.length },
    });
    return { total, incluidos, fallidos: fallidos.length };
}
