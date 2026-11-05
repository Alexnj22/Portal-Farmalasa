// Banco de pruebas del Botiquín: corre el MISMO motor (lib/botiquinMotor.js)
// en Chromium, con el arte de verdad, jugando solo, y saca capturas. Sirve
// para afinar la física y el aspecto sin compilar la app.
// Uso: node apps/clientes/scripts/botiquin/banco.mjs <carpeta-de-salida> [semilla]
import { chromium } from 'playwright';
import { build } from 'esbuild';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const aqui = dirname(fileURLToPath(import.meta.url));
const salida = process.argv[2]; const semilla = Number(process.argv[3] || 7);
mkdirSync(salida, { recursive: true });
const assets = join(aqui, '../../assets/juegos/botiquin');
const b64 = (f) => `data:image/png;base64,${readFileSync(join(assets, f)).toString('base64')}`;

const codigo = `
import * as M from ${JSON.stringify(join(aqui, '../../lib/botiquinMotor.js'))};
window.M = M;
`;
const bundle = await build({ stdin: { contents: codigo, resolveDir: join(aqui, '../..') }, bundle: true, write: false, format: 'iife' });
const js = bundle.outputFiles[0].text;

const imgs = { fondo: b64('caja-fondo.png'), frente: b64('caja-frente.png'), brillo: b64('brillo.png') };
for (let n = 0; n < 11; n++) imgs[n] = b64(`pieza-${n}.png`);

const navegador = await chromium.launch();
const pagina = await navegador.newPage({ viewport: { width: 430, height: 700 }, deviceScaleFactor: 2 });
await pagina.setContent(`<html><body style="margin:0;background:linear-gradient(#04262A,#0B4E4C,#3B5E12)"><canvas id="c" width="860" height="1400" style="width:430px;height:700px"></canvas></body></html>`);
await pagina.addScriptTag({ content: js });
await pagina.exposeFunction('__foto', async (n) => { await pagina.screenshot({ path: join(salida, `banco-${n}.png`) }); });
const resultado = await pagina.evaluate(async ({ imgs, semilla }) => {
  const M = window.M;
  const carga = (src) => new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.src = src; });
  const I = {}; for (const k of Object.keys(imgs)) I[k] = await carga(imgs[k]);
  const { CAJA, RADIOS, ZONA_ARRIBA } = M;
  const W = CAJA.ANCHO + CAJA.PARED * 2; const H = ZONA_ARRIBA + CAJA.ALTO + CAJA.PARED;
  const cv = document.getElementById('c'); const c = cv.getContext('2d');
  const k = Math.min(860 / W, 1300 / H); const ox = (860 - W * k) / 2 + CAJA.PARED * k; const oy = 60 + ZONA_ARRIBA * k;
  const m = M.crearMundo(semilla);
  window.m = m;
  const dibujar = () => {
    c.clearRect(0, 0, 860, 1400);
    c.drawImage(I.fondo, ox - CAJA.PARED * k, oy - CAJA.ARRIBA * k, W * k, (CAJA.ARRIBA + CAJA.ALTO + CAJA.PARED) * k);
    for (const b of M.piezas(m)) {
      const r = b.circleRadius * k; const x = ox + b.position.x * k; const y = oy + b.position.y * k;
      c.save(); c.translate(x, y); c.rotate(b.angle); c.drawImage(I[b.plugin.n], -r, -r, r * 2, r * 2); c.restore();
      c.drawImage(I.brillo, x - r, y - r, r * 2, r * 2);
    }
    c.drawImage(I.frente, ox - CAJA.PARED * k, oy - CAJA.ARRIBA * k, W * k, (CAJA.ARRIBA + CAJA.ALTO + CAJA.PARED) * k);
    c.strokeStyle = m.peligro > 0 ? '#FF6B7E' : 'rgba(255,255,255,0.35)'; c.setLineDash([8, 8]); c.lineWidth = 3;
    c.beginPath(); c.moveTo(ox, oy); c.lineTo(ox + CAJA.ANCHO * k, oy); c.stroke(); c.setLineDash([]);
    c.fillStyle = '#fff'; c.font = '700 40px -apple-system'; c.fillText(String(m.puntos), 30, 50);
  };
  // Juega solo: suelta donde hay una igual cerca de arriba, si no al azar.
  let s = semilla * 9301 + 49297; const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const capturas = []; let ms = 0; let pasos = 0; let soltadas = 0;
  for (let seg = 0; seg < 240 && !m.perdio; seg += 1 / 60) {
    if (M.puedeSoltar(m)) {
      const igual = M.piezas(m).filter((b) => b.plugin.n === m.actual).sort((a, b) => a.position.y - b.position.y)[0];
      const x = igual && rnd() < 0.7 ? igual.position.x : rnd() * CAJA.ANCHO;
      if (M.soltar(m, x)) soltadas++;
    }
    const t0 = performance.now(); pasos += M.avanzar(m, 1 / 60); ms += performance.now() - t0;
    if (soltadas && [8, 25, 50, 90, 140].includes(soltadas) && !capturas.includes(soltadas)) { dibujar(); capturas.push(soltadas); await window.__foto(soltadas); }
  }
  dibujar(); await window.__foto('fin');
  return { puntos: m.puntos, mayor: m.mayor, soltadas, perdio: m.perdio, piezas: M.piezas(m).length, msPorPaso: ms / Math.max(1, pasos), t: m.t };
}, { imgs, semilla }).catch((e) => ({ error: String(e) }));
console.log(JSON.stringify(resultado));
await navegador.close();
