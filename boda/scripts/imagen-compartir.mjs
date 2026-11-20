// Arma la imagen que se ve al compartir el enlace (WhatsApp, iMessage…):
// la foto de la portada con el Save the Date, los nombres y la fecha del
// diseñador encima. 1200 × 630, sale a public/fotos/compartir.jpg.
//
//   node scripts/imagen-compartir.mjs
//
// Volver a correrlo si cambia la foto de la portada o alguna pieza.
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { SOLIDO } from '../src/components/logoStdTrazos.js';
import { VISTA_NOMBRES, NOMBRES } from '../src/components/nombresTrazos.js';
import { PIEZAS } from '../src/components/piezasTrazos.js';
import { boda } from '../src/config.js';

const raiz = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
async function cargarPlaywright() {
  try { return await import('playwright'); } catch { /* vive en el repo de al lado */ }
  const otro = path.resolve(raiz, '../../Portal-Farmalasa/node_modules/playwright/index.mjs');
  return import(pathToFileURL(otro).href);
}

const foto = readFileSync(path.join(raiz, 'public/fotos/portada-1800.jpg')).toString('base64');
const svg = (vista, ds, color, ancho) =>
  `<svg viewBox="${vista}" style="display:block;width:${ancho}px;height:auto;fill:${color}">${ds.map((d) => `<path d="${d}"/>`).join('')}</svg>`;
const LINO = '#efe7da';
const CHAMPAN = '#e2d2b8';

const html = `<!doctype html><html><body style="margin:0">
<div style="position:relative;width:1200px;height:630px;overflow:hidden;background:#0e0d0a">
  <img src="data:image/jpeg;base64,${foto}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:${boda.portadaEnfoque || '50% 50%'}">
  <div style="position:absolute;inset:0;background:linear-gradient(90deg,rgba(14,13,10,.86) 0%,rgba(14,13,10,.55) 46%,rgba(14,13,10,.05) 75%),linear-gradient(180deg,transparent 60%,rgba(14,13,10,.5))"></div>
  <div style="position:absolute;left:72px;top:0;bottom:0;display:flex;flex-direction:column;justify-content:center;gap:26px">
    ${svg('0 0 753.14 138.64', [SOLIDO], LINO, 620)}
    ${svg(VISTA_NOMBRES, NOMBRES, CHAMPAN, 470)}
    <div style="width:470px;height:1px;background:rgba(239,231,218,.35)"></div>
    ${svg(PIEZAS.fechaCorta.vista, PIEZAS.fechaCorta.d, LINO, 170)}
  </div>
</div></body></html>`;

const { chromium } = await cargarPlaywright();
const navegador = await chromium.launch();
const pagina = await navegador.newPage({ viewport: { width: 1200, height: 630 } });
await pagina.setContent(html, { waitUntil: 'load' });
await pagina.screenshot({ path: path.join(raiz, 'public/fotos/compartir.jpg'), type: 'jpeg', quality: 88 });
await navegador.close();
console.log('public/fotos/compartir.jpg listo');
