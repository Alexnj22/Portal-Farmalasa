/*
 * Copias WebP de las fotos propias (public/fotos/<nombre>-<ancho>.webp), a
 * partir de la copia de 3200 px. Pesan la mitad o menos que el JPEG con la
 * misma vista; src/lib/fotos.js las pide cuando la foto del config es .webp.
 * Uso: node scripts/fotos-webp.mjs   (Chromium de Playwright hace la codificación)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '../../../Portal-Farmalasa/node_modules/playwright/index.mjs';

const raiz = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(raiz, 'public/fotos');
const ANCHOS = [480, 640, 800, 960, 1200, 1400, 1800, 2400, 3200];
const CALIDAD = 0.74;
const nombres = fs.readdirSync(dir).filter((f) => /-3200\.jpg$/.test(f)).map((f) => f.replace(/-3200\.jpg$/, ''));

const b = await chromium.launch();
const p = await b.newPage();
for (const n of nombres) {
  const datos = fs.readFileSync(path.join(dir, `${n}-3200.jpg`)).toString('base64');
  const salida = await p.evaluate(async ({ datos, ANCHOS, CALIDAD }) => {
    const img = new Image();
    img.src = `data:image/jpeg;base64,${datos}`;
    await img.decode();
    const out = {};
    for (const w of ANCHOS) {
      const h = Math.round(img.naturalHeight * (w / img.naturalWidth));
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const x = c.getContext('2d');
      x.imageSmoothingQuality = 'high';
      x.drawImage(img, 0, 0, w, h);
      out[w] = c.toDataURL('image/webp', CALIDAD).split(',')[1];
    }
    return out;
  }, { datos, ANCHOS, CALIDAD });
  for (const [w, b64] of Object.entries(salida)) fs.writeFileSync(path.join(dir, `${n}-${w}.webp`), Buffer.from(b64, 'base64'));
  console.log(n, 'listo');
}
await b.close();
