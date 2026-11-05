// ─────────────────────────────────────────────────────────────────────────────
// Descargar y abrir archivos — la versión del NAVEGADOR.
// ─────────────────────────────────────────────────────────────────────────────
//
// El núcleo arma el archivo (el CSV, el ZIP, el PDF) y se lo entrega a esto; en
// la app nativa su gemelo `descargas.native.js` lo compartirá o lo guardará con
// el sistema de archivos del teléfono. Plan en
// `docs/PLAN-NUCLEO-PORTABLE-2026-09-24.md`.
//
// ── Un solo patrón, el que ya se comprobó ─────────────────────────────────
//
// Defecto real del 2026-07-22 (anotado en `data/facturasCompra.js`):
// `a.click()` y `URL.revokeObjectURL` espalda con espalda, con el `<a>` fuera
// de la página, pueden liberar el archivo antes de que el navegador empiece a
// leerlo, y la descarga se pierde EN SILENCIO — sin error en consola. Ahí se
// corrigió; los otros tres sitios que descargaban (la exportación a CSV de
// todas las tablas, el ZIP de los documentos de venta y los archivos
// guardados) seguían con el patrón frágil. Ahora descargan todos por acá.

/** Guarda un `Blob` en el dispositivo con ese nombre. */
export function descargarArchivo(blob, nombre) {
    const a = Object.assign(document.createElement('a'), {
        href: URL.createObjectURL(blob),
        download: nombre,
    });
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // Con demora: liberar en el acto puede ganarle al navegador.
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/**
 * Descarga un documento de pdfmake (`pdfMake.createPdf(def)`).
 *
 * NUNCA `.download()` de pdfmake: pasa por file-saver, que dispara el clic con
 * un `<a>` fuera de la página. En Safari eso pierde el `download` y el archivo
 * llega como «Unknown.pdf — No se puede mover el archivo» (hoja de carnés de
 * practicantes, 2026-11-05). Además `.download()` es asíncrono y nadie lo
 * esperaba: un fallo al maquetar quedaba sin aviso y la pantalla decía
 * «descargada». Acá se espera el blob y sale por el patrón comprobado.
 */
export async function descargarPdf(documentoPdfmake, nombre) {
    const blob = await documentoPdfmake.getBlob();
    descargarArchivo(blob, nombre);
}

/** Abre una dirección en otra pestaña. */
export function abrirEnPestanaNueva(url) {
    window.open(url, '_blank');
}

/**
 * Abre una pestaña YA y la lleva a una dirección que todavía hay que pedir.
 * Los bloqueadores de ventanas emergentes matan un `window.open` que ocurre
 * después de un `await`, así que la pestaña se abre en blanco dentro del clic
 * y se navega cuando llega la dirección; si no llega, se cierra.
 */
export async function abrirEnPestanaCuandoLlegue(promesaDeUrl) {
    const win = window.open('about:blank', '_blank');
    const url = await promesaDeUrl;
    if (url && win) win.location.href = url;
    else if (win) win.close();
}
