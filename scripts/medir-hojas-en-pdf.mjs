/**
 * ¿El PDF que arma `hojasEnPdf` abre de verdad?
 *
 *     npm run medir:pdf
 *
 * Se genera en un navegador (necesita `File` y `canvas`) y se verifica con
 * **pdfjs-dist**, o sea con un lector que no participó en escribirlo.
 *
 * ── Y se MIRA, no sólo se cuenta ───────────────────────────────────────────
 *
 * La primera versión comprobaba páginas, proporciones y que la lista de
 * operadores incluyera «pintar una imagen». Dio verde con las tres páginas
 * NEGRAS: la lista de operadores dice que se dibuja una imagen, no CUÁL. Al
 * pintarlas se vio enseguida.
 *
 * Y ahí apareció la segunda lección: las páginas estaban negras porque el
 * fixture pasaba `'rojo'` como color CSS —que no existe, así que `fillStyle` se
 * quedaba en negro—. O sea que el instrumento estaba roto y acusaba al código
 * que sí funcionaba. Por eso los colores de acá son hex y el rótulo va escrito
 * dentro de cada hoja: si una página sale donde no va, se ve.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';

const codigo = fs.readFileSync('src/utils/hojasEnPdf.js', 'utf8').replace(/^export /gm, '');
const b = await chromium.launch();
const pg = await b.newPage();
const out = await pg.evaluate(async ({ codigo }) => {
  eval(codigo);
  // Tres hojas de proporciones distintas, con un color propio cada una para
  // poder distinguirlas después.
  const hacer = (w, h, css, nombre) => new Promise(res => {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d');
    g.fillStyle = css; g.fillRect(0, 0, w, h);
    g.fillStyle = '#000'; g.font = 'bold 120px sans-serif'; g.fillText(nombre, 40, 180);
    c.toBlob(bl => res(new File([bl], 'h.jpg', { type: 'image/jpeg' })), 'image/jpeg', 0.9);
  });
  const hojas = [await hacer(1200, 1600, '#e03131', 'ROJO'),
                 await hacer(1600, 1200, '#2f9e44', 'VERDE'),
                 await hacer(900, 1600, '#1971c2', 'AZUL')];
  const pdf = await hojasEnPdf(hojas, 'expediente'); // eslint-disable-line no-undef
  const bytes = new Uint8Array(await pdf.arrayBuffer());
  return { nombre: pdf.name, tipo: pdf.type, bytes: Array.from(bytes),
           pesoHojas: hojas.reduce((s, h) => s + h.size, 0) };
}, { codigo });
await b.close();

const buf = Buffer.from(out.bytes);
fs.writeFileSync('/tmp/prueba-hojas.pdf', buf);
console.log(`archivo: ${out.nombre} · ${out.tipo} · ${(buf.length / 1024).toFixed(0)} kB (las 3 fotos suman ${(out.pesoHojas / 1024).toFixed(0)} kB)`);

// Y ahora lo lee otro: pdfjs, que no participó en escribirlo.
const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
const doc = await getDocument({ data: new Uint8Array(buf) }).promise;
console.log(`páginas: ${doc.numPages}`);
const esperado = [[1200, 1600], [1600, 1200], [900, 1600]];
let mal = 0;
for (let i = 1; i <= doc.numPages; i++) {
  const p = await doc.getPage(i);
  const v = p.getViewport({ scale: 1 });
  const [ow, oh] = esperado[i - 1];
  const propOriginal = ow / oh, propPagina = v.width / v.height;
  const ok = Math.abs(propOriginal - propPagina) < 0.01 && Math.round(Math.max(v.width, v.height)) === 792;
  if (!ok) mal++;
  const ops = await p.getOperatorList();
  const tieneImagen = ops.fnArray.some(f => f === 85 || f === 86 || f === 87); // paintImageXObject y familia
  console.log(`  p${i}: ${Math.round(v.width)}×${Math.round(v.height)} pt · proporción ${propPagina.toFixed(3)} vs ${propOriginal.toFixed(3)} · lado largo 792: ${Math.round(Math.max(v.width, v.height)) === 792 ? 'sí' : 'NO'} · dibuja imagen: ${tieneImagen ? 'sí' : 'NO'}`);
  if (!tieneImagen) mal++;
}
console.log(mal ? `\n${mal} problema(s).` : '\nlas 3 páginas bien.');
process.exit(mal ? 1 : 0);
