// Vive aparte del visor (`components/common/VisorDeDocumento.jsx`) porque es
// lógica pura: un archivo de componente que además exporta una función rompe
// el refresco en caliente (react-refresh/only-export-components).

/* ── Qué es el archivo NO se pregunta al nombre ────────────────────────────
 *
 * Se preguntaba, y falló en el primer documento real: el nombre llegó vacío
 * —la fila no lo tenía guardado— así que cayó en «Documento», el visor lo dio
 * por PDF y lo puso en un marco. Dos síntomas de una sola causa: la foto se
 * veía AMPLIADA (un marco muestra la imagen a tamaño natural, no ajustada) y el
 * botón de recortar no aparecía, porque un PDF no se edita.
 *
 * El tipo autoritativo es el del CONTENIDO, que llega en el `Content-Type` del
 * propio archivo. El nombre y la extensión quedan de respaldo para cuando el
 * servidor no dice nada útil (`application/octet-stream`), que pasa. */
const porExtension = (texto = '') =>
    /\.(jpe?g|png|webp|gif|heic|heif)(\?|$)/i.test(texto);

export const esImagen = (tipoReal, nombre, url) => {
    if (tipoReal && /^image\//i.test(tipoReal)) return true;
    if (tipoReal && /^application\/pdf/i.test(tipoReal)) return false;
    return porExtension(nombre) || porExtension(url);
};
