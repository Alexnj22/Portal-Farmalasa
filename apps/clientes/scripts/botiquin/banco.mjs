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

const imgs = { fondo: b64('caja-fondo.png'), frente: b64('caja-frente.png') };
const archivos = [...Array(11).keys()].map((n) => `pieza-${n}`).concat(['germen-0', 'germen-1', 'germen-2', 'gel']);
archivos.forEach((f, i) => { imgs[i] = b64(`${f}.png`); imgs[`s${i}`] = b64(`${f}-sombra.png`); });

const navegador = await chromium.launch();
const pagina = await navegador.newPage({ viewport: { width: 430, height: 700 }, deviceScaleFactor: 2 });
await pagina.setContent(`<html><body style="margin:0;background:linear-gradient(#04262A,#0B4E4C,#3B5E12)"><canvas id="c" width="860" height="1400" style="width:430px;height:700px"></canvas></body></html>`);
await pagina.addScriptTag({ content: js });
await pagina.exposeFunction('__foto', async (n) => { await pagina.screenshot({ path: join(salida, `banco-${n}.png`) }); });
const resultado = await pagina.evaluate(async ({ imgs, semilla, PAUSA_BOT, PUNTERIA }) => {
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
    const lista = M.piezas(m);
    for (const pase of ['s', '']) for (const b of lista) {
      const f = M.formaDe(b.plugin); const { w, h } = M.medidas(f); const e = b.plugin.esc; const g = b.plugin.golpe;
      const i = M.imagenDe(b.plugin); const x = ox + b.position.x * k; const y = oy + b.position.y * k;
      c.save(); c.translate(x, y + (pase ? 3 * k : 0)); c.scale(1 + 0.1 * g, 1 - 0.1 * g); c.rotate(b.angle);
      if (pase) c.drawImage(I[`s${i}`], (-w / 2 - 7) * e * k, (-h / 2 - 7) * e * k, (w + 14) * e * k, (h + 14) * e * k);
      else c.drawImage(I[i], -w / 2 * e * k, -h / 2 * e * k, w * e * k, h * e * k);
      c.restore();
    }
    c.drawImage(I.frente, ox - CAJA.PARED * k, oy - CAJA.ARRIBA * k, W * k, (CAJA.ARRIBA + CAJA.ALTO + CAJA.PARED) * k);
    c.strokeStyle = m.peligro > 0 ? '#FF6B7E' : 'rgba(255,255,255,0.35)'; c.setLineDash([8, 8]); c.lineWidth = 3;
    c.beginPath(); c.moveTo(ox, oy); c.lineTo(ox + CAJA.ANCHO * k, oy); c.stroke(); c.setLineDash([]);
    c.fillStyle = '#fff'; c.font = '700 40px -apple-system'; c.fillText(`${m.puntos}  germ:${m.germenesVivos} limp:${m.limpiados}`, 30, 50);
  };
  // Juega solo: suelta donde hay una igual cerca de arriba, si no al azar.
  let s = semilla * 9301 + 49297; const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const capturas = []; let ms = 0; let pasos = 0; let soltadas = 0;
  for (let seg = 0; seg < 900 && !m.perdio; seg += 1 / 60) {
    // Como una persona: una pieza por segundo y puntería mediana. Al gel lo
    // tira sobre un germen; al germen, lejos de los otros.
    if (M.puedeSoltar(m) && m.t - m.ultimaSoltada >= PAUSA_BOT) {
      const vivos = M.piezas(m);
      let blanco = null;
      if (m.actual.tipo === 'gel') blanco = vivos.find((b) => b.plugin.tipo === 'germen');
      else if (m.actual.tipo === 'med') blanco = vivos.filter((b) => b.plugin.tipo === 'med' && b.plugin.n === m.actual.n).sort((a, b) => a.position.y - b.position.y)[0];
      const x = blanco && rnd() < PUNTERIA ? blanco.position.x + (rnd() - 0.5) * 30 : rnd() * CAJA.ANCHO;
      if (M.soltar(m, x)) soltadas++;
    }
    const t0 = performance.now(); pasos += M.avanzar(m, 1 / 60); ms += performance.now() - t0;
    if (soltadas && [20, 60, 120, 200].includes(soltadas) && !capturas.includes(soltadas)) { dibujar(); capturas.push(soltadas); await window.__foto(soltadas); }
  }
  dibujar(); await window.__foto('fin');
  return { puntos: m.puntos, mayor: m.mayor, limpiados: m.limpiados, germenes: m.germenesVivos, soltadas, perdio: m.perdio, piezas: M.piezas(m).length, msPorPaso: ms / Math.max(1, pasos), t: m.t };
}, { imgs, semilla, PAUSA_BOT: Number(process.env.PAUSA || 1.0), PUNTERIA: Number(process.env.PUNTERIA || 0.55) }).catch((e) => ({ error: String(e) }));
console.log(JSON.stringify(resultado));
await navegador.close();
