// Convierte el arte del Botiquín (arte.mjs) a PNG con Chromium (Playwright).
// Uso: node apps/clientes/scripts/botiquin/render.mjs [--hoja ruta.png]
// Sale a apps/clientes/assets/juegos/botiquin/. Con --hoja además arma una
// hoja de contacto para mirar todas las piezas juntas.
import { chromium } from 'playwright';
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PIEZAS, catalogo, estuche } from './arte.mjs';
import { CAJA } from '../../lib/botiquinMotor.js';

const aqui = dirname(fileURLToPath(import.meta.url));
const salida = join(aqui, '../../assets/juegos/botiquin');
mkdirSync(salida, { recursive: true });
for (const f of readdirSync(salida)) if (f.endsWith('.png')) rmSync(join(salida, f));

// Píxeles por unidad del mundo: el mundo mide ~444 de ancho y en un teléfono
// de 430 pt × 3 eso es ~2.9 px por unidad. 3 deja todo nítido sin pesar de más.
const PX = 3;
/** Margen de la sombra, en unidades del mundo (la pantalla lo usa igual). */
export const MARGEN_SOMBRA = 7;

const navegador = await chromium.launch();
const pagina = await navegador.newPage({ deviceScaleFactor: 1 });

async function png(svg, ancho, alto, archivo) {
  await pagina.setViewportSize({ width: Math.ceil(ancho), height: Math.ceil(alto) });
  await pagina.setContent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`);
  await pagina.locator('svg').first().screenshot({ path: archivo, omitBackground: true });
}
const svgDe = (vb, px, py, cuerpo) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" width="${px}" height="${py}" style="display:block">${cuerpo}</svg>`;

const todas = catalogo();
for (const p of todas) {
  await png(svgDe(`0 0 ${p.w} ${p.h}`, Math.round(p.w * PX), Math.round(p.h * PX), p.svg), p.w * PX, p.h * PX, join(salida, `${p.archivo}.png`));
  // La sombra: la misma figura, negra y desenfocada, con un margen alrededor.
  const M = MARGEN_SOMBRA;
  const sombra = `<defs><filter id="s" x="-50%" y="-50%" width="200%" height="200%"><feFlood flood-color="#00140F" flood-opacity="0.55"/><feComposite in2="SourceAlpha" operator="in"/><feGaussianBlur stdDeviation="2.6"/></filter></defs>
    <g filter="url(#s)" transform="translate(${M} ${M})">${p.svg}</g>`;
  await png(svgDe(`0 0 ${p.w + M * 2} ${p.h + M * 2}`, Math.round((p.w + M * 2) * 1.5), Math.round((p.h + M * 2) * 1.5), sombra), (p.w + M * 2) * 1.5, (p.h + M * 2) * 1.5, join(salida, `${p.archivo}-sombra.png`));
}
const k = estuche(CAJA);
const conTam = (svg) => svg.replace('<svg ', `<svg width="${k.W * PX}" height="${k.H * PX}" style="display:block" `);
await png(conTam(k.fondo), k.W * PX, k.H * PX, join(salida, 'caja-fondo.png'));
await png(conTam(k.frente), k.W * PX, k.H * PX, join(salida, 'caja-frente.png'));

const i = process.argv.indexOf('--hoja');
if (i > 0) {
  const celdas = todas.map((p, j) => {
    const esc = Math.min(150 / p.w, 150 / p.h);
    return `<div style="text-align:center;font:600 13px -apple-system;color:#fff;width:170px"><div style="height:160px;display:flex;align-items:center;justify-content:center">${svgDe(`0 0 ${p.w} ${p.h}`, p.w * esc, p.h * esc, p.svg.replace(/id="([\w-]+)"/g, `id="h${j}$1"`).replace(/url\(#([\w-]+)\)/g, `url(#h${j}$1)`))}</div>${PIEZAS[j]?.nombre || p.archivo}</div>`;
  }).join('');
  await pagina.setViewportSize({ width: 1150, height: 800 });
  await pagina.setContent(`<html><body style="margin:0;background:linear-gradient(#04262A,#0B4E4C);padding:20px;display:flex;flex-wrap:wrap;gap:14px">${celdas}</body></html>`);
  await pagina.screenshot({ path: process.argv[i + 1], fullPage: true });
}
await navegador.close();
console.log(`✓ ${todas.length} figuras con sombra y el estuche en ${salida}`);
