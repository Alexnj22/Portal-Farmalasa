/**
 * El afiche del programa de puntos, en PDF para la vitrina.
 *
 * Es un documento APARTE del reglamento y a propósito: uno obliga —lleva
 * membrete, cláusulas numeradas y firma— y el otro informa. Meter el resumen
 * dentro del reglamento habría hecho que la hoja que la gente lee de pie tuviera
 * que ser también la que se firma.
 *
 * Una sola página, tamaño carta. Los dos QR ya vienen pegados en el HTML (ver
 * `qr-svg.mjs`), así que este archivo sólo maqueta e imprime: la página que se
 * publica en línea y el papel de la vitrina son el MISMO archivo.
 *
 *   node scripts/afiche-puntos-pdf.mjs <fuente.html> [salida.pdf]
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { RGBLuminanceSource, HybridBinarizer, BinaryBitmap, MultiFormatReader,
         BarcodeFormat, DecodeHintType } from '@zxing/library';

const fuente = process.argv[2];
const salida = process.argv[3] ?? 'docs/legal/AFICHE-PROGRAMA-DE-PUNTOS.pdf';
if (!fuente) { console.error('falta el HTML de origen'); process.exit(1); }

const cuerpo = readFileSync(resolve(fuente), 'utf8');
const html = `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body>${cuerpo}</body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent(html, { waitUntil: 'networkidle' });
// `networkidle` da por cargada la hoja de estilos de las tipografías, no las
// tipografías. Sin esta espera el PDF sale con la de repuesto y se parece a
// otro documento — el mismo tropiezo que costó una segunda pasada en el
// reglamento.
await page.evaluate(() => document.fonts.ready);
await page.emulateMedia({ media: 'print' });
// Sin encabezado ni pie: un afiche de una página que dice «1 de 1» se lee como
// un documento al que le falta el resto.
await page.pdf({
  path: resolve(salida),
  format: 'Letter',
  printBackground: true,
  margin: { top: '16mm', bottom: '13mm', left: '17mm', right: '17mm' },
});

// ── Los códigos se LEEN antes de dar el PDF por bueno ──────────────────────
// Un QR mal armado no se ve mal: se ve como un QR. Y el modo de falla es que
// nadie lo nota hasta que hay cien copias pegadas en las vitrinas y alguien
// apunta el teléfono. Así que acá se dibuja cada uno en un lienzo, se leen sus
// píxeles y se decodifica de verdad — la misma norma que usa el login para
// leer un carné. Si no decodifica, o si lo que dice no es la dirección escrita
// al lado, el script FALLA y no deja un PDF que parece correcto.
const leidos = await page.evaluate(async () => {
  const salida = [];
  for (const svg of document.querySelectorAll('.qr')) {
    const url = new XMLSerializer().serializeToString(svg);
    const img = new Image();
    await new Promise((ok, mal) => {
      img.onload = ok; img.onerror = mal;
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(url);
    });
    // 8 px por módulo y un borde blanco: sin margen, el decodificador no
    // encuentra la zona tranquila y da por ilegible un código impecable.
    const n = 33 * 8, m = 32;
    const c = document.createElement('canvas');
    c.width = c.height = n + m * 2;
    const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    g.drawImage(img, m, m, n, n);
    const d = g.getImageData(0, 0, c.width, c.height);
    salida.push({ ancho: c.width, alto: c.height, datos: Array.from(d.data),
                  rotulo: svg.closest('.codigo')?.querySelector('.url')?.textContent?.trim() ?? '' });
  }
  return salida;
});

const hints = new Map();
hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.QR_CODE]);
hints.set(DecodeHintType.TRY_HARDER, true);

let fallo = false;
for (const { ancho, alto, datos, rotulo } of leidos) {
  const lum = new Uint8ClampedArray(ancho * alto);
  for (let i = 0; i < lum.length; i++) {
    lum[i] = (datos[i*4] * 299 + datos[i*4+1] * 587 + datos[i*4+2] * 114) / 1000;
  }
  const lector = new MultiFormatReader();
  lector.setHints(hints);
  let dice;
  try {
    dice = lector.decode(new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(lum, ancho, alto))));
  } catch {
    console.error(`✗ un código NO se pudo leer (el rotulado «${rotulo}»)`);
    fallo = true; continue;
  }
  const texto = dice.getText();
  // El rótulo impreso es la única forma de notar un código viejo a ojo, así que
  // tiene que decir lo mismo que el código. Se compara sin el «https://».
  if (texto.replace(/^https?:\/\//, '') !== rotulo) {
    console.error(`✗ el código dice «${texto}» y al lado está escrito «${rotulo}»`);
    fallo = true; continue;
  }
  console.log('✓ código legible:', texto);
}

await browser.close();
if (fallo) { console.error('El PDF quedó escrito, pero NO se puede pegar: revisar los códigos.'); process.exit(1); }
console.log('PDF escrito en', salida);
