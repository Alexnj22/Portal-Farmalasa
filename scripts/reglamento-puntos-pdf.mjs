/**
 * El reglamento de puntos, en PDF para imprimir y pegar en la sala.
 *
 * Nace de un pedido concreto —«necesito el reglamento en un documento oficial
 * para compartir / pegar en la sucursal»— y de una cláusula del propio
 * reglamento: la 13 dice que un ejemplar se mantiene disponible en todas las
 * salas. Un documento que promete su propia disponibilidad y no se puede
 * imprimir no cumple lo que dice.
 *
 * Se genera desde el MISMO archivo que se publica en línea, no desde una copia.
 * Dos originales del mismo reglamento es cómo se llega a que el de la pared y
 * el del sitio digan cosas distintas, y el que reclama siempre tiene el otro.
 *
 *   node scripts/reglamento-puntos-pdf.mjs <fuente.html> [salida.pdf]
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const fuente = process.argv[2];
const salida = process.argv[3] ?? 'docs/legal/REGLAMENTO-PROGRAMA-DE-PUNTOS.pdf';
if (!fuente) { console.error('falta el HTML de origen'); process.exit(1); }

// El archivo que se publica no trae <html>/<head>/<body>: eso lo pone el
// publicador. Acá hay que armarlo para que un navegador de verdad lo entienda.
const cuerpo = readFileSync(resolve(fuente), 'utf8');

// El pie de firma existe SÓLO en el papel. En línea, un espacio para firmar que
// nadie firmó se lee como un documento a medias; pegado en la pared, la firma es
// lo que lo vuelve oficial.
const firma = `
<div class="firma">
  <p>Chalatenango, El Salvador.</p>
  <div class="linea"></div>
  <p class="cargo">Representante Legal<br>Farmacias La Popular y La Salud</p>
</div>
<style>
  .firma { margin-top: 3.5rem; page-break-inside: avoid; }
  .firma p { font-family: "IBM Plex Sans", system-ui, sans-serif; font-size: .85rem; color: var(--ink-2); }
  .firma .linea { width: 17rem; border-bottom: 1px solid var(--ink); margin: 3.5rem 0 .4rem; }
  .firma .cargo { font-size: .8rem; line-height: 1.5; }
</style>`;

// Se inyecta antes del ÚLTIMO `</div>` —el cierre de `.doc`— buscándolo desde
// el final. Un `replace` sobre un fragmento exacto de maquetado se rompe en
// silencio el día que alguien cambia un salto de línea: el PDF sale sin firma y
// nadie se entera hasta que está pegado en la pared.
const cierre = cuerpo.lastIndexOf('</div>');
if (cierre === -1) { console.error('el HTML no tiene dónde cerrar'); process.exit(1); }
const conFirma = cuerpo.slice(0, cierre) + firma + '\n' + cuerpo.slice(cierre);

const html = `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body>${conFirma}</body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent(html, { waitUntil: 'networkidle' });
// `networkidle` no espera a que las fuentes estén LISTAS para pintar, sólo a que
// la red se calme. Sin esto el PDF sale con la tipografía de reserva y no se
// parece al que se publicó.
await page.evaluate(() => document.fonts.ready);
await page.emulateMedia({ media: 'print' });
await page.pdf({
  path: resolve(salida),
  format: 'Letter',
  printBackground: true,
  margin: { top: '18mm', bottom: '18mm', left: '20mm', right: '20mm' },
  displayHeaderFooter: true,
  headerTemplate: '<div></div>',
  footerTemplate:
    '<div style="width:100%;font-size:8pt;color:#666;padding:0 20mm;'
    + 'font-family:system-ui,sans-serif;display:flex;justify-content:space-between">'
    + '<span>Reglamento del Programa de Puntos · Farmacias La Popular y La Salud</span>'
    // Las tres piezas del número van en UN solo span: como el pie es un flex con
    // `space-between`, separarlas las manda a las esquinas y el «3 / 7» sale
    // repartido a lo ancho de la página.
    + '<span><span class="pageNumber"></span> de <span class="totalPages"></span></span></div>',
});
await browser.close();
console.log('PDF escrito en', salida);
