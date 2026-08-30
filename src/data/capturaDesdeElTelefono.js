/**
 * El lado del TELÉFONO del traspaso de la foto.
 *
 * Lo usa una sola pantalla —`CapturaDeFotoView`, la que se abre al escanear el
 * QR— y por eso vive aparte de `capturaDeFoto.js`, que es el lado de la
 * computadora. El motivo es de peso, literal: el lado de la computadora lo
 * importa `FileField`, o sea los 21 adjuntos del portal, y arrastrar hasta ahí
 * el redimensionador de imágenes costaba 2 kB en cada vista para código que en
 * una computadora no se ejecuta nunca.
 */
import { supabase } from '../supabaseClient';

/** ¿Ese código todavía sirve? La llama el TELÉFONO, sin sesión. */
export async function capturaVigente(secreto) {
    const { data, error } = await supabase.rpc('captura_de_foto_vigente', { p_secreto: secreto });
    if (error) return { ok: false };
    return data || { ok: false };
}

/**
 * Reduce la foto antes de mandarla.
 *
 * Una cámara de teléfono da 4000 px y varios megas. Mandarla entera cuesta la
 * subida por datos móviles —donde esto se va a usar— y es exactamente lo que
 * tumbó `leer-dui` por memoria.
 *
 * ── Un solo tamaño, y es el del DOCUMENTO ──────────────────────────────────
 *
 * Estuvo en 1024 px mientras esto era sólo la foto de un empleado. Desde el
 * 28-ago el mismo camino trae CUALQUIER adjunto —una boleta, un permiso, un
 * comprobante de depósito—, y ahí 1024 px no alcanza: la letra chica de un
 * documento a 1024 px del lado mayor deja de leerse, y el lector de IA que
 * corre después sobre esa imagen lee lo que le llegue.
 *
 * Se eligió UN tamaño para los dos casos en vez de un modo por tipo, porque el
 * teléfono no sabe para qué es la foto: el QR no lo dice y agregárselo sería
 * meter un dato en la llave. 1600 px del lado mayor al 85% deja un documento
 * legible en ~400 kB, y para una cara sólo significa una foto mejor: el portal
 * la muestra chica igual.
 */
export async function reducirParaMandar(file, ladoMaximo = 1600) {
    const dataUrl = await new Promise((res, rej) => {
        const fr = new FileReader();
        fr.onload = () => res(fr.result);
        fr.onerror = () => rej(new Error('No se pudo leer la foto.'));
        fr.readAsDataURL(file);
    });

    const img = await new Promise((res, rej) => {
        const el = new Image();
        el.onload = () => res(el);
        el.onerror = () => rej(new Error('No se pudo abrir la foto.'));
        el.src = dataUrl;
    });

    const escala = Math.min(1, ladoMaximo / Math.max(img.width, img.height));
    // Una foto que ya es chica NO se agranda: reescalar hacia arriba sólo
    // agrega peso y le quita nitidez.
    const w = Math.round(img.width * escala);
    const h = Math.round(img.height * escala);

    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    canvas.getContext('2d').drawImage(img, 0, 0, w, h);
    return { base64: canvas.toDataURL('image/jpeg', 0.85), tipo: 'image/jpeg' };
}

/** El mismo reductor, pero devolviendo un archivo — para armar el PDF. */
export async function hojaReducida(file, nombre = 'hoja.jpg') {
    const { base64 } = await reducirParaMandar(file);
    const crudo = atob(base64.replace(/^data:[^,]+,/, ''));
    const bytes = new Uint8Array(crudo.length);
    for (let i = 0; i < crudo.length; i++) bytes[i] = crudo.charCodeAt(i);
    return new File([bytes], nombre, { type: 'image/jpeg' });
}

/**
 * El teléfono manda lo que armó: una foto, o el PDF con todas las hojas.
 *
 * El PDF **no pasa por el reductor**: `reducirParaMandar` lo abre como `Image`
 * y un PDF no es una imagen, así que fallaría con «No se pudo abrir la foto» —
 * un mensaje que manda a mirar la cámara cuando el problema sería el tipo de
 * archivo. Sus páginas ya vienen reducidas de una por una, que además es donde
 * hay que hacerlo: reducir el PDF entero después de armarlo no se puede.
 */
export async function mandarFoto(secreto, file) {
    const esPdf = file?.type === 'application/pdf';
    let reducida;
    if (esPdf) {
        const b = new Uint8Array(await file.arrayBuffer());
        // En tandas: `String.fromCharCode(...todo)` revienta la pila con un
        // archivo de varios megas, y eso se vería como «no se pudo enviar».
        let bin = '';
        for (let i = 0; i < b.length; i += 0x8000) {
            bin += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
        }
        reducida = { base64: btoa(bin), tipo: 'application/pdf' };
    } else {
        try {
            reducida = await reducirParaMandar(file);
        } catch (e) {
            return { ok: false, motivo: e?.message || 'No se pudo preparar la foto.' };
        }
    }

    const { data, error } = await supabase.functions.invoke('subir-foto-de-captura', {
        body: { secreto, imagenBase64: reducida.base64, tipo: reducida.tipo },
    });
    if (error) return { ok: false, motivo: 'No se pudo enviar. Revisa tu señal.' };
    if (!data?.ok) {
        const porQue = {
            CODIGO_INVALIDO: 'Ese código ya se usó o venció. Pide uno nuevo en la computadora.',
            MUY_GRANDE: 'Pesa demasiado. Quita alguna hoja e intenta de nuevo.',
        };
        return { ok: false, motivo: porQue[data?.error] || 'No se pudo guardar la foto.' };
    }
    return { ok: true };
}

