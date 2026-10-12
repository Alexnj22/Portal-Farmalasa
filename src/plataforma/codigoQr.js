// La matriz de módulos de un código QR, en la WEB. `@zxing/library` entra por
// `await import()` (regla de librerías pesadas de CLAUDE.md): sólo hace falta
// al imprimir un afiche. El teléfono tiene su propio adaptador con el mismo
// codificador (`apps/mobile/plataforma/codigoQr.js`).
let libPromise = null;
function getLib() {
    if (!libPromise) {
        libPromise = import('@zxing/library')
            .catch((err) => { libPromise = null; throw err; });
    }
    return libPromise;
}

/** @returns {Promise<{ancho: number, oscuro: (x: number, y: number) => boolean}>} con la zona tranquila incluida. */
export async function matrizQr(texto) {
    const { QRCodeWriter, BarcodeFormat } = await getLib();
    const m = new QRCodeWriter().encode(String(texto), BarcodeFormat.QR_CODE, 0, 0, new Map());
    return { ancho: m.getWidth(), oscuro: (x, y) => m.get(x, y) };
}
