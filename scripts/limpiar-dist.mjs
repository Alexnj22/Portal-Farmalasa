#!/usr/bin/env node
/**
 * limpiar-dist.mjs — borra las carpetas `dist-*` que deja cada sesión.
 *
 * POR QUÉ EXISTE
 * Con varias sesiones sobre el mismo árbol, la regla de CLAUDE.md es compilar a
 * un directorio propio (`OUT_DIR=dist-<nombre> npm run build`) para no pisar el
 * `dist/` ajeno. Nada las borraba al terminar: el 2026-08-23 había 45 carpetas
 * y 1.5 GB, una por cada tema tocado desde el 1 de agosto. Son regenerables
 * (`npm run build`) y están en `.gitignore`, así que borrarlas no pierde nada
 * que no se pueda volver a construir en un minuto.
 *
 * LOS CUATRO FRENOS (una carpeta se salva si cualquiera aplica)
 *   1. `dist` y `dist-staging` nunca se tocan: son los destinos por defecto de
 *      `npm run preview` y de `build:staging`, no de una sesión.
 *   2. El `OUT_DIR` de la compilación en curso tampoco — el modo `--auto` corre
 *      dentro del `prebuild`, o sea justo antes de escribir ahí.
 *   3. Menos de N días sin tocar (por defecto 3): puede ser de una sesión viva.
 *      La fecha se toma del CONTENIDO, no del directorio: `vite build` reescribe
 *      adentro y el mtime del padre puede quedar viejo.
 *   4. Un proceso vivo la nombra en sus argumentos (`vite preview --outDir X`).
 *      Es el caso caro: borrarle el dist a una sesión que está haciendo QA le
 *      deja la pantalla en 404 sin explicación.
 *
 * USO
 *   node scripts/limpiar-dist.mjs              → lista lo que borraría (dry-run)
 *   node scripts/limpiar-dist.mjs --borrar     → lo borra
 *   node scripts/limpiar-dist.mjs --dias 7     → cambia el umbral
 *   node scripts/limpiar-dist.mjs --auto       → silencioso, borra, NUNCA falla
 *
 * Sin `--borrar` no borra nada: es un script de escritura, y un script de
 * escritura sin freno se corre dos veces.
 */
import { readdirSync, statSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const RAIZ = fileURLToPath(new URL('..', import.meta.url));
const INTOCABLES = new Set(['dist', 'dist-staging']);
const DIAS_POR_DEFECTO = 3;

const args = process.argv.slice(2);
const auto = args.includes('--auto');
const borrar = auto || args.includes('--borrar');
const iDias = args.indexOf('--dias');
const dias = iDias >= 0 ? Number(args[iDias + 1]) : DIAS_POR_DEFECTO;

if (!Number.isFinite(dias) || dias < 0) {
  console.error('--dias necesita un número de días (ej. --dias 7)');
  process.exit(auto ? 0 : 1);
}

/** mtime más reciente entre el directorio y su primer nivel de hijos. */
function tocadaEn(ruta) {
  let ultimo = statSync(ruta).mtimeMs;
  for (const hijo of readdirSync(ruta)) {
    try {
      ultimo = Math.max(ultimo, statSync(join(ruta, hijo)).mtimeMs);
    } catch { /* desapareció mientras mirábamos */ }
  }
  return ultimo;
}

function tamano(ruta) {
  try {
    return execSync(`du -sk ${JSON.stringify(ruta)}`, { encoding: 'utf8' }).split('\t')[0].trim();
  } catch { return '0'; }
}

let procesos = '';
try {
  procesos = execSync('ps -Ao args=', { encoding: 'utf8' });
} catch { /* sin ps, el freno 4 no aplica */ }

const enUso = new Set();
const salvadas = [];
const candidatas = [];
const ahora = Date.now();
const umbral = dias * 24 * 60 * 60 * 1000;

let carpetas;
try {
  carpetas = readdirSync(RAIZ).filter(n => n.startsWith('dist'));
} catch { process.exit(auto ? 0 : 1); }

for (const nombre of carpetas.sort()) {
  const ruta = join(RAIZ, nombre);
  let st;
  try { st = statSync(ruta); } catch { continue; }
  if (!st.isDirectory()) continue;

  if (INTOCABLES.has(nombre)) { salvadas.push([nombre, 'destino por defecto']); continue; }
  if (process.env.OUT_DIR === nombre) { salvadas.push([nombre, 'es el OUT_DIR de esta compilación']); continue; }

  // Freno 4: un proceso vivo la nombra. Se busca la palabra completa para que
  // `dist-cola` no salve a `dist-col`.
  if (new RegExp(`(^|[\\s/=,'"])${nombre.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([\\s/'"]|$)`, 'm').test(procesos)) {
    enUso.add(nombre);
    salvadas.push([nombre, 'la está usando un proceso vivo']);
    continue;
  }

  const edadMs = ahora - tocadaEn(ruta);
  const edadDias = Math.floor(edadMs / 86400000);
  if (edadMs < umbral) { salvadas.push([nombre, `tocada hace ${edadDias}d (< ${dias}d)`]); continue; }

  candidatas.push({ nombre, ruta, edadDias, kb: Number(tamano(ruta)) });
}

const totalMb = Math.round(candidatas.reduce((a, c) => a + c.kb, 0) / 1024);

if (auto) {
  if (!candidatas.length) process.exit(0);
  for (const c of candidatas) {
    try { rmSync(c.ruta, { recursive: true, force: true }); } catch { /* que no frene el build */ }
  }
  console.log(`🧹 limpiar-dist: ${candidatas.length} carpeta(s) de compilación sin tocar hace ${dias}+ días, ~${totalMb} MB liberados.`);
  process.exit(0);
}

if (!candidatas.length) {
  console.log(`Nada que borrar: ninguna carpeta dist-* lleva ${dias}+ días sin tocarse.`);
} else {
  console.log(`${borrar ? 'Borrando' : 'Se borrarían'} ${candidatas.length} carpeta(s) — ~${totalMb} MB:\n`);
  for (const c of candidatas) {
    console.log(`  ${c.nombre.padEnd(26)} ${String(Math.round(c.kb / 1024)).padStart(4)} MB   hace ${c.edadDias}d`);
    if (borrar) rmSync(c.ruta, { recursive: true, force: true });
  }
}

if (salvadas.length) {
  console.log('\nSe quedan:');
  for (const [nombre, motivo] of salvadas) console.log(`  ${nombre.padEnd(26)} ${motivo}`);
}

if (!borrar && candidatas.length) {
  console.log('\nEsto fue una lista, no un borrado. Para borrarlas: npm run limpiar:dist -- --borrar');
}
if (enUso.size) {
  console.log(`\n⚠️  ${enUso.size} carpeta(s) están abiertas por otra sesión y no se tocan.`);
}
