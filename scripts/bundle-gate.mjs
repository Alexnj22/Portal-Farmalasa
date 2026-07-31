#!/usr/bin/env node
/**
 * bundle-gate — el peso que el usuario realmente descarga. Corre sobre dist/,
 * así que necesita `npm run build` antes.
 *
 * Nace de la auditoría del 2026-07-30: `pedidoPrint.js` importaba pdfmake +
 * vfs_fonts de forma ESTÁTICA, así que abrir Pedidos bajaba 809 kB gzip de
 * fuentes PDF embebidas — 4× el tablero entero — aunque nadie imprimiera.
 * Nadie lo vio en meses porque ninguna medición miraba el cierre estático de
 * cada ruta; se medía tiempo con caché caliente, que es justo donde ese costo
 * es invisible.
 *
 * Tres reglas:
 *
 *  1. LIBRERÍAS PESADAS: sólo por `await import()`. Una librería que sólo hace
 *     falta al apretar un botón no puede viajar en el chunk de la vista.
 *  2. PRESUPUESTO POR VISTA: el cierre estático de cada ruta lazy, en gzip.
 *  3. PRESUPUESTO DEL ENTRY: lo que se baja en frío y DESPUÉS DE CADA DEPLOY
 *     (los hashes cambian, así que la caché del navegador no ayuda).
 *
 * Ratchet contra scripts/bundle-gate-baseline.json, igual que design-gate.
 * Al bajar peso: npm run gate:bundle -- --update-baseline
 */
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(RAIZ, 'dist');
const ASSETS = join(DIST, 'assets');
const BASELINE = join(RAIZ, 'scripts', 'bundle-gate-baseline.json');

if (!existsSync(ASSETS)) {
  console.error('✗ no hay dist/assets — correr `npm run build` primero.');
  process.exit(2);
}

/**
 * Librerías que NUNCA deben quedar en el cierre estático de una vista.
 * El valor es el motivo — un número sin motivo no se puede discutir después.
 */
const PESADAS = {
  'vfs_fonts': 'pdfmake embebe las fuentes: 809 kB gzip. Sólo hace falta al generar el PDF.',
  'pdfmake': 'Sólo hace falta al generar el PDF.',
  'pdf.worker': 'pdfjs sólo hace falta al leer un PDF subido.',
  'ort.bundle': 'onnxruntime (quitar fondo de fotos) — sólo al editar una foto.',
  'ort.webgpu': 'onnxruntime (quitar fondo de fotos) — sólo al editar una foto.',
  'jszip': 'Sólo hace falta al exportar el ZIP.',
  'zxing': 'Sólo hace falta al abrir la cámara del escáner.',
};

// Techo por vista, en kB gzip, para el cierre ESTÁTICO (lo que se baja al entrar).
const TECHO_VISTA_KB = 250;
const TECHO_ENTRY_KB = 300;

// ── grafo ──────────────────────────────────────────────────────────────────
const files = readdirSync(ASSETS).filter(f => f.endsWith('.js'));
const gz = new Map(), estaticos = new Map(), dinamicos = new Map();

for (const f of files) {
  const p = join(ASSETS, f);
  const src = readFileSync(p, 'utf8');
  gz.set(f, gzipSync(readFileSync(p)).length);

  const dyn = new Set();
  for (const m of src.matchAll(/import\(\s*["'](\.\/[^"']+\.js)["']\s*\)/g)) dyn.add(basename(m[1]));
  dinamicos.set(f, dyn);

  const st = new Set();
  for (const m of src.matchAll(/from\s*["'](\.\/[^"']+\.js)["']/g)) st.add(basename(m[1]));
  for (const m of src.matchAll(/(?:^|[;{}\s])import\s*["'](\.\/[^"']+\.js)["']/g)) st.add(basename(m[1]));
  for (const d of dyn) st.delete(d);
  estaticos.set(f, st);
}

function cierre(inicio) {
  const visto = new Set([inicio]), pila = [inicio];
  while (pila.length) {
    for (const d of estaticos.get(pila.pop()) || []) {
      if (!visto.has(d) && gz.has(d)) { visto.add(d); pila.push(d); }
    }
  }
  return visto;
}

const kb = n => Math.round(n / 1024);
const limpio = f => f.replace(/-[A-Za-z0-9_-]{8}\.js$/, '');

const html = readFileSync(join(DIST, 'index.html'), 'utf8');
const entry = basename((html.match(/src="\/assets\/([^"]+\.js)"/) || [])[1] || '');
const cierreEntry = cierre(entry);
const entryKb = kb([...cierreEntry].reduce((a, f) => a + gz.get(f), 0));

// ── medición por vista ─────────────────────────────────────────────────────
const vistas = {};
const violaciones = [];

for (const v of [...(dinamicos.get(entry) || [])].filter(f => gz.has(f))) {
  const nuevos = [...cierre(v)].filter(f => !cierreEntry.has(f));
  const total = kb(nuevos.reduce((a, f) => a + gz.get(f), 0));
  const nombre = limpio(v);
  vistas[nombre] = total;

  for (const dep of nuevos) {
    for (const [lib, motivo] of Object.entries(PESADAS)) {
      if (dep.includes(lib)) {
        violaciones.push({ vista: nombre, lib, kb: kb(gz.get(dep)), motivo });
      }
    }
  }
}

// ── reporte ────────────────────────────────────────────────────────────────
if (process.argv.includes('--update-baseline')) {
  // Holgura del 15% (mínimo 10 kB). Un ratchet al byte exacto falla con
  // cualquier import trivial y termina regenerándose por reflejo — que es
  // exactamente cómo un gate deja de significar algo. Lo que tiene que
  // saltar es un salto de escalón (una librería nueva), no el ruido.
  const holgura = n => Math.max(n + 10, Math.ceil(n * 1.15));
  writeFileSync(BASELINE, JSON.stringify({
    _comment: 'Techos en kB gzip del cierre ESTÁTICO. Generado con `npm run gate:bundle -- --update-baseline` (incluye 15% de holgura). Al BAJAR peso, regenerar y commitear.',
    entry: holgura(entryKb),
    vistas: Object.fromEntries(Object.entries(vistas).map(([k, v]) => [k, holgura(v)])),
  }, null, 2) + '\n');
  console.log(`✓ baseline de bundle actualizado (entry ${entryKb} kB → tope ${holgura(entryKb)}, ${Object.keys(vistas).length} vistas)`);
  process.exit(0);
}

const base = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : { entry: TECHO_ENTRY_KB, vistas: {} };
let falla = false;

console.log(`\nENTRY (frío / tras cada deploy): ${entryKb} kB gzip  [tope ${base.entry}]`);
if (entryKb > base.entry) { falla = true; console.log('  ✗ el entry creció'); }

if (violaciones.length) {
  falla = true;
  console.log(`\n✗ LIBRERÍA PESADA EN CIERRE ESTÁTICO (${violaciones.length})`);
  console.log('  Se baja al ENTRAR a la vista, la use el usuario o no.');
  console.log('  Arreglo: mover a `const { X } = await import(...)` dentro de la función que la usa.\n');
  for (const v of violaciones) {
    console.log(`  ${v.vista}  ←  ${v.lib}  (${v.kb} kB gzip)`);
    console.log(`     ${v.motivo}`);
  }
}

const crecidas = Object.entries(vistas)
  .filter(([n, k]) => k > (base.vistas[n] ?? TECHO_VISTA_KB))
  .sort((a, b) => b[1] - a[1]);

if (crecidas.length) {
  falla = true;
  console.log(`\n✗ VISTAS QUE CRECIERON (${crecidas.length})`);
  for (const [n, k] of crecidas) console.log(`  ${n}: ${k} kB  [tope ${base.vistas[n] ?? TECHO_VISTA_KB}]`);
}

const top = Object.entries(vistas).sort((a, b) => b[1] - a[1]).slice(0, 6);
console.log(`\nLas 6 vistas más pesadas:`);
for (const [n, k] of top) console.log(`  ${String(k).padStart(4)} kB  ${n}`);

if (falla) { console.error('\n✗ bundle-gate\n'); process.exit(1); }
console.log('\n✓ bundle-gate en verde\n');
