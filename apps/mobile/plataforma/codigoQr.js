// La matriz de módulos de un código QR, en el TELÉFONO. Es el mismo
// codificador de `@zxing/library` que usa la web, pero tomado por su ruta
// interna (`cjs/core/qrcode`): el paquete entero está marcado sólo-web en
// `metro.config.js` porque su entrada principal arrastra lectores del
// navegador; el codificador es JavaScript puro y no toca el DOM.
//
// El paquete vive en el `node_modules` de la raíz del portal (la app no lo
// declara); `metro.config.js` resuelve esta ruta allá.
import QRCodeWriter from '@zxing/library/cjs/core/qrcode/QRCodeWriter';
import BarcodeFormat from '@zxing/library/cjs/core/BarcodeFormat';

const Escritor = QRCodeWriter.default || QRCodeWriter;
const Formato = BarcodeFormat.default || BarcodeFormat;

/** @returns {Promise<{ancho: number, oscuro: (x: number, y: number) => boolean}>} con la zona tranquila incluida. */
export async function matrizQr(texto) {
  const m = new Escritor().encode(String(texto), Formato.QR_CODE, 0, 0, new Map());
  return { ancho: m.getWidth(), oscuro: (x, y) => m.get(x, y) };
}
