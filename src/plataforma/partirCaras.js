// ─────────────────────────────────────────────────────────────────────────────
// Partir la imagen del DUI que manda el teléfono en sus DOS caras.
// ─────────────────────────────────────────────────────────────────────────────
//
// El teléfono (`CapturaDeFotoView`, `unirCaras`) manda frente y reverso en UNA
// imagen —frente arriba, una franja blanca del 4% del ancho, reverso abajo—
// porque el canal de captura lleva un archivo. Del lado de la computadora eso
// entraba como «DUI en un solo archivo»: se guardaba todo en una casilla y la
// lectura no encontraba nada (reportado el 2026-10-14: «se guarda en una sola en
// frontal… no encuentra nada ni ve el nombre, número»). Subidas de a una, las
// dos caras sí se leían.
//
// Así que acá se deshace la unión: se busca la franja blanca más cercana al
// centro y se corta ahí. Si no hay franja reconocible (una foto que no vino de
// `unirCaras`), devuelve `null` y quien llama sigue como un solo archivo.

import { abrirImagen } from './imagenes';

const BLANCO = 245;          // canal mínimo para contar un píxel como blanco
const MUESTRAS = 64;         // píxeles por fila que se miran

/**
 * @param {File|Blob} archivo
 * @returns {Promise<{ frente: File, reverso: File } | null>}
 */
export async function partirCarasDelDui(archivo) {
    if (!archivo || !String(archivo.type || '').startsWith('image/')) return null;
    const img = await abrirImagen(archivo, 'No se pudo abrir la foto del DUI.');
    const w = img.naturalWidth, h = img.naturalHeight;
    // Dos caras de DUI apiladas son más altas que anchas; una sola, no.
    if (!w || !h || h < w * 0.9) return null;

    const lienzo = document.createElement('canvas');
    lienzo.width = w; lienzo.height = h;
    const ctx = lienzo.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);

    // Filas blancas en el tercio central.
    const desde = Math.floor(h / 3), hasta = Math.ceil((2 * h) / 3);
    const datos = ctx.getImageData(0, desde, w, hasta - desde).data;
    const paso = Math.max(1, Math.floor(w / MUESTRAS));
    const esBlanca = (fila) => {
        const base = fila * w * 4;
        for (let x = 0; x < w; x += paso) {
            const i = base + x * 4;
            if (datos[i] < BLANCO || datos[i + 1] < BLANCO || datos[i + 2] < BLANCO) return false;
        }
        return true;
    };

    // La franja blanca (mínimo 1% del ancho) más cercana al centro.
    const minimo = Math.max(3, Math.round(w * 0.01));
    let mejor = null, inicio = -1;
    for (let f = 0; f <= hasta - desde; f++) {
        const blanca = f < hasta - desde && esBlanca(f);
        if (blanca && inicio < 0) inicio = f;
        if (!blanca && inicio >= 0) {
            if (f - inicio >= minimo) {
                const centro = desde + (inicio + f) / 2;
                if (!mejor || Math.abs(centro - h / 2) < Math.abs(mejor.centro - h / 2)) {
                    mejor = { arriba: desde + inicio, abajo: desde + f, centro };
                }
            }
            inicio = -1;
        }
    }
    if (!mejor) return null;

    const recorte = async (y0, y1, nombre) => {
        const c = document.createElement('canvas');
        c.width = w; c.height = Math.max(1, y1 - y0);
        c.getContext('2d').drawImage(lienzo, 0, y0, w, y1 - y0, 0, 0, w, y1 - y0);
        const blob = await new Promise(ok => c.toBlob(ok, 'image/jpeg', 0.92));
        if (!blob) throw new Error('No se pudo partir la foto del DUI.');
        return new File([blob], nombre, { type: 'image/jpeg' });
    };
    return {
        frente: await recorte(0, mejor.arriba, 'dui_frente.jpg'),
        reverso: await recorte(mejor.abajo, h, 'dui_reverso.jpg'),
    };
}
