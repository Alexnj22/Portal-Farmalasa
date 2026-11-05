// Convierte el arte del Botiquín (arte.mjs) a PNG con Chromium (Playwright).
// Uso: node apps/clientes/scripts/botiquin/render.mjs [--hoja ruta.png]
// Sale a apps/clientes/assets/juegos/botiquin/. Con --hoja además arma una
// hoja de contacto para mirar todas las piezas juntas.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BRILLO, LADO, PIEZAS, caja } from './arte.mjs';
import { CAJA, RADIOS } from '../../lib/botiquinMotor.js';

const aqui = dirname(fileURLToPath(import.meta.url));
const salida = join(aqui, '../../assets/juegos/botiquin');
mkdirSync(salida, { recursive: true });

// Píxeles por unidad del mundo: el mundo mide ~444 de ancho y en un teléfono
// de 430 pt × 3 eso es ~2.9 px por unidad. 3 deja todo nítido sin pesar de más.
const PX = 3;

const navegador = await chromium.launch();
const pagina = await navegador.newPage({ deviceScaleFactor: 1 });

async function png(svg, ancho, alto, archivo) {
  await pagina.setViewportSize({ width: Math.ceil(ancho), height: Math.ceil(alto) });
  await pagina.setContent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`);
  await pagina.locator('svg').screenshot({ path: archivo, omitBackground: true });
}
// Los id de los degradados se repiten entre piezas: en una misma página el
// primero gana y todas salen del mismo color. Se les pone un prefijo único.
let nId = 0;
const unico = (svg) => { const p = `k${nId++}`; return svg.replace(/id="([\w-]+)"/g, `id="${p}$1"`).replace(/url\(#([\w-]+)\)/g, `url(#${p}$1)`); };
const envolver = (cuerpo, px) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${LADO} ${LADO}" width="${px}" height="${px}" style="display:block">${unico(cuerpo)}</svg>`;

for (let n = 0; n < PIEZAS.length; n++) {
  const px = Math.max(96, Math.round(RADIOS[n] * 2 * PX));
  await png(envolver(PIEZAS[n].svg(), px), px, px, join(salida, `pieza-${n}.png`));
}
await png(envolver(BRILLO, 384), 384, 384, join(salida, 'brillo.png'));
const k = caja(CAJA);
const conTam = (svg) => svg.replace(/width="[\d.]+" height="[\d.]+"/, `width="${k.W * PX}" height="${k.H * PX}" style="display:block"`);
await png(conTam(k.fondo), k.W * PX, k.H * PX, join(salida, 'caja-fondo.png'));
await png(conTam(k.frente), k.W * PX, k.H * PX, join(salida, 'caja-frente.png'));

const i = process.argv.indexOf('--hoja');
if (i > 0) {
  const celdas = PIEZAS.map((p) => `<div style="text-align:center;font:600 14px -apple-system;color:#fff"><div style="position:relative;width:180px;height:180px">${envolver(p.svg(), 180)}<div style="position:absolute;inset:0">${envolver(BRILLO, 180)}</div></div>${p.nombre}</div>`).join('');
  await pagina.setViewportSize({ width: 1240, height: 700 });
  await pagina.setContent(`<html><body style="margin:0;background:linear-gradient(#04262A,#0B4E4C);padding:20px;display:flex;flex-wrap:wrap;gap:22px">${celdas}</body></html>`);
  await pagina.screenshot({ path: process.argv[i + 1], fullPage: true });
}
await navegador.close();
console.log(`✓ ${PIEZAS.length} piezas, brillo y caja en ${salida}`);
