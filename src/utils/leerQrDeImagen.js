/**
 * Lee un código QR de una IMAGEN (no de la cámara en vivo).
 *
 * ── Para qué ───────────────────────────────────────────────────────────────
 *
 * Para que el carné digital de dependiente se pueda entrar **desde el
 * teléfono**, sin construir un segundo circuito.
 *
 * El portal ya sabe traer una foto del teléfono a la computadora: se pinta un
 * QR, alguien lo escanea, saca la foto y la imagen aparece sola en el
 * formulario (`data/capturaDeFoto.js`). Lo único que faltaba para el carné era
 * el último paso — el dato que hace falta no es la foto, es el TEXTO del QR que
 * se fotografió.
 *
 * Así que la computadora decodifica la imagen que recibió. No hay pantalla
 * nueva en el teléfono, no hay canal nuevo, no hay permiso nuevo: es el mismo
 * traspaso con un paso más del lado que sí tiene con qué hacerlo.
 *
 * ── `@zxing` entra por `await import()` ────────────────────────────────────
 *
 * Pesa, y esto sólo corre cuando alguien mandó una foto de un carné. Misma
 * regla que el lector de la cámara.
 */

/**
 * @param {string} url  la imagen (URL firmada, `blob:` o `data:`)
 * @returns {Promise<string|null>} el texto del QR, o `null` si no había ninguno
 */
export async function leerQrDeImagen(url) {
    const { BrowserQRCodeReader } = await import('@zxing/browser');
    try {
        const resultado = await new BrowserQRCodeReader().decodeFromImageUrl(url);
        return resultado?.getText?.() || null;
    } catch {
        // `NotFoundException` es el caso NORMAL: la foto salió movida, o lo que
        // se fotografió no tenía ningún QR. No es un error del portal y no se
        // registra como tal — quien llama decide qué decir.
        return null;
    }
}
