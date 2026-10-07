import { pdfDelDocumento } from '@nucleo/utils/distribucionDocumento';
import { enviarCorreoDocumento } from '@nucleo/data/distribucion';
import { MARCA_PAPEL } from './marca';

// Mandarle a un cliente su documento (borrador 0019): el PDF es el mismo que se
// descarga desde el documento, armado acá y enviado junto con el pedido.

const aBase64 = (blob) => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
    r.onerror = () => reject(r.error ?? new Error('No se pudo leer el PDF.'));
    r.readAsDataURL(blob);
});

/** Arma el PDF del documento y lo manda. Lanza con el motivo si no se pudo. */
export async function enviarDocumentoPorCorreo(dte, { destinatario = null } = {}) {
    const pdf = await aBase64(await pdfDelDocumento(dte, MARCA_PAPEL));
    return enviarCorreoDocumento(dte.id, pdf, { destinatario });
}

/** Qué decir del correo de un documento: vive en el núcleo (la app dice lo mismo). */
export { estadoDelCorreo } from '@nucleo/utils/distribucionFacturacion';
