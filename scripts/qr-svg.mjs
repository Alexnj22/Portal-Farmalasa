/**
 * Un QR como SVG, para pegarlo dentro de un documento.
 *
 * No agrega una dependencia: `@zxing/library` ya está en el proyecto porque el
 * login lee códigos con ella. Leer y escribir un QR es la misma norma.
 *
 * La salida se PEGA en el HTML de destino, no se inyecta al compilar. Un QR que
 * se arma en el build vive sólo en el PDF, y entonces la página publicada y el
 * papel dejan de ser el mismo documento — que es justo lo que
 * `reglamento-puntos-pdf.mjs` existe para evitar. Pegado, el archivo es uno solo
 * y se puede publicar tal cual.
 *
 * Para que un QR viejo se pueda notar, la dirección va escrita EN LETRA al lado
 * del código. Un cuadrito no se puede leer a ojo: si la ruta cambia y nadie
 * regenera el SVG, el único que avisa es el texto de abajo.
 *
 *   node scripts/qr-svg.mjs https://portal.farmasalud.lat/mis-puntos
 */
import { QRCodeWriter, BarcodeFormat, EncodeHintType } from '@zxing/library';

const url = process.argv[2];
if (!url) { console.error('falta la dirección'); process.exit(1); }

const hints = new Map();
// Corrección M: aguanta ~15% del código tapado. En una vitrina el papel se
// arruga y le pega el sol, así que el mínimo (L) es poco; los niveles altos
// engordan la matriz y encogen el módulo, que es lo que un teléfono viejo no
// alcanza a resolver.
hints.set(EncodeHintType.ERROR_CORRECTION, 'M');
// Sin margen: el aire alrededor lo pone la maqueta, que sabe cuánto tiene.
hints.set(EncodeHintType.MARGIN, 0);

const matriz = new QRCodeWriter().encode(url, BarcodeFormat.QR_CODE, 0, 0, hints);
const n = matriz.getWidth();

// Un solo <path> con los módulos de cada fila unidos en tiras. Un <rect> por
// módulo son ~600 nodos y el archivo pesa cinco veces más para dibujar lo mismo.
let d = '';
for (let y = 0; y < n; y++) {
  let x = 0;
  while (x < n) {
    if (!matriz.get(x, y)) { x++; continue; }
    let ancho = 0;
    while (x + ancho < n && matriz.get(x + ancho, y)) ancho++;
    d += `M${x} ${y}h${ancho}v1h-${ancho}z`;
    x += ancho;
  }
}

console.log(`<!-- ${url} — regenerar con: node scripts/qr-svg.mjs ${url} -->`);
console.log(`<svg class="qr" viewBox="0 0 ${n} ${n}" aria-hidden="true"><path d="${d}"/></svg>`);
