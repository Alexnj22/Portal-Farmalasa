/**
 * Leer un QR de una FOTO tomada con la cámara del sistema.
 *
 * Es el camino que funciona en cualquier navegador: el de la cámara o de Google
 * Lens en Android (que no dan cámara en vivo), una vista web incrustada sin
 * permiso de cámara, o un teléfono sin `getUserMedia`. Una foto con
 * `<input capture>` sí se puede en todos lados.
 *
 * ── Por qué tantos intentos (reporte del 2026-10-14) ───────────────────────
 *
 * La primera versión probaba la foto entera y dos reducciones con zxing, y en
 * Android contestaba «no se leyó ningún código» sobre el QR del carné. Una foto
 * de cámara es el peor caso para ese lector: 12 a 50 megapíxeles, el código
 * chico en el medio, a veces inclinado, y —si el carné se fotografía en la
 * pantalla de otro teléfono en modo oscuro— BLANCO sobre negro, que zxing no lee
 * nunca. Ahora, en orden:
 *
 *   1. `BarcodeDetector` del navegador. En Chrome de Android es el motor de
 *      Google (el de Lens): lee QR chicos, inclinados e invertidos sin ayuda.
 *   2. zxing con `TRY_HARDER`, a varias escalas, sobre la foto entera y sobre
 *      el centro recortado (donde la gente pone el código), primero SUAVIZADA
 *      con un desenfoque de 1 px. Medido: con el fondo texturado de una foto
 *      real (mesa, tela, ruido del sensor) zxing no encuentra el código aunque
 *      el QR esté nítido —0 de 4 casos—; suavizado, 7 de 8.
 *   3. Lo mismo con los colores INVERTIDOS.
 *
 * Todo con la orientación ya corregida (`imageOrientation: 'from-image'`): una
 * foto vertical llega acostada según su EXIF.
 *
 * @param {File} file
 * @returns {Promise<string|null>} el texto del código, o `null` si no se leyó
 */
export async function leerQrDeFoto(file) {
    if (!file) return null;
    const imagen = await abrirImagen(file);
    if (!imagen) return null;
    try {
        const nativo = await conElDetectorDelNavegador(imagen);
        if (nativo) return nativo;
        return await conZxing(imagen);
    } catch {
        // Un lector que revienta no puede dejar la pantalla en «Leyendo…»: se
        // contesta «no se leyó» y la persona puede intentar otra foto.
        return null;
    } finally {
        imagen.close?.();
    }
}

/** ¿Este navegador da la cámara EN VIVO? El de la app de cámara de Android, no. */
export const hayCamaraEnVivo = () =>
    typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;

async function abrirImagen(file) {
    try {
        return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
        // Safari viejo no acepta opciones; sin ellas igual abre.
        try { return await createImageBitmap(file); } catch { return null; }
    }
}

async function conElDetectorDelNavegador(imagen) {
    if (typeof window === 'undefined' || !('BarcodeDetector' in window)) return null;
    try {
        const formatos = await window.BarcodeDetector.getSupportedFormats?.();
        if (Array.isArray(formatos) && !formatos.includes('qr_code')) return null;
        const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
        // El detector de Chrome en Android lee invertidos solo; el de otras
        // plataformas no siempre, así que la versión invertida va igual.
        for (const lienzo of [null, ...variantes(imagen, [2000]), ...variantes(imagen, [2000], true)]) {
            const hallados = await detector.detect(lienzo || imagen);
            const texto = hallados?.find(h => h?.rawValue)?.rawValue;
            if (texto) return texto;
        }
    } catch { /* sin detector usable: sigue zxing */ }
    return null;
}

async function conZxing(imagen) {
    const [{ BrowserQRCodeReader }, { DecodeHintType }] = await Promise.all([
        import('@zxing/browser'), import('@zxing/library'),
    ]);
    const pistas = new Map([[DecodeHintType.TRY_HARDER, true]]);
    const lector = new BrowserQRCodeReader(pistas);
    for (const invertir of [false, true]) {
        for (const lienzo of [...variantes(imagen, [1600, 1000, 700], invertir, 'blur(1px)'),
                              ...variantes(imagen, [1600, 1000], invertir)]) {
            try {
                const r = lector.decodeFromCanvas(lienzo);
                const texto = r?.getText?.();
                if (texto) return texto;
            } catch { /* este tamaño no: el siguiente */ }
        }
    }
    return null;
}

/**
 * Las versiones de la foto que se prueban: la imagen entera y el centro
 * recortado, cada una a los lados mayores pedidos (sin agrandar nunca).
 */
function* variantes(imagen, lados, invertir = false, filtro = 'none') {
    const recortes = [
        { x: 0, y: 0, w: imagen.width, h: imagen.height },
        // El 60 % del centro: ahí apunta quien fotografía un código.
        { x: imagen.width * 0.2, y: imagen.height * 0.2, w: imagen.width * 0.6, h: imagen.height * 0.6 },
    ];
    for (const r of recortes) {
        for (const lado of lados) {
            const escala = Math.min(1, lado / Math.max(r.w, r.h));
            const lienzo = document.createElement('canvas');
            lienzo.width = Math.max(1, Math.round(r.w * escala));
            lienzo.height = Math.max(1, Math.round(r.h * escala));
            const ctx = lienzo.getContext('2d', { willReadFrequently: true });
            ctx.filter = filtro;
            ctx.drawImage(imagen, r.x, r.y, r.w, r.h, 0, 0, lienzo.width, lienzo.height);
            if (invertir) {
                const px = ctx.getImageData(0, 0, lienzo.width, lienzo.height);
                const d = px.data;
                for (let i = 0; i < d.length; i += 4) {
                    d[i] = 255 - d[i]; d[i + 1] = 255 - d[i + 1]; d[i + 2] = 255 - d[i + 2];
                }
                ctx.putImageData(px, 0, 0);
            }
            yield lienzo;
        }
    }
}
