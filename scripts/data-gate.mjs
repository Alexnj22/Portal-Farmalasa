#!/usr/bin/env node
/**
 * data-gate — invariantes de la capa de datos. Local, sin red.
 *
 * Nace de la auditoría completa del 2026-07-30
 * (docs/AUDITORIA-COMPLETA-2026-07-30.md). Cada categoría existe porque el
 * bug correspondiente YA ocurrió en este repo, no por higiene teórica:
 *
 *   tipo-booleano   `.eq('recibido_mh', true)` sobre una columna TEXT que guarda
 *                   el sello de Hacienda: la lista "confirmadas por MH" devolvía
 *                   0 filas desde siempre, y el update escribía la cadena 'true'
 *                   encima de un sello fiscal.
 *   cap-1000        PostgREST trunca en 1000 sin avisar. `.limit(1000)` es el
 *                   cap exacto: el día que la tabla lo cruza, trunca en silencio.
 *   sin-paginar     SELECT sobre tabla grande sin range/limit/in/single/count
 *                   ni fetchAllRows.
 *   error-ignorado  `const { data } = await supabase...` sin mirar `error`.
 *                   Un select que falla en silencio deja Maps vacíos (pasó con
 *                   presentaciones.descripcion: un mes sin detectarse).
 *
 * Ratchet, igual que design-gate: falla si una categoría SUBE respecto a
 * scripts/data-gate-baseline.json. Cuando una llega a 0 queda bloqueante para
 * siempre (una categoría ausente del JSON arranca en 0).
 *
 * Al BAJAR deuda: npm run gate:data -- --update-baseline y commitear el JSON.
 * NUNCA regenerar para tapar un hallazgo nuevo.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE = join(RAIZ, 'scripts', 'data-gate-baseline.json');
const SCHEMA = JSON.parse(readFileSync(join(RAIZ, 'scripts', 'db', 'boolean-columns.json'), 'utf8'));

const BOOLEANAS = SCHEMA.tablas;
const GRANDES = Object.keys(SCHEMA.tablas_grandes).filter(k => !k.startsWith('_'));

/**
 * Excepciones con MOTIVO escrito. Una entrada por archivo, con todas sus
 * categorías — igual que design-gate, una clave repetida pisaría a la anterior
 * en silencio (lo verifica assertSinClavesDuplicadas).
 */
const EXCEPTIONS = {
  'src/utils/supabaseUtils.js': {
    'sin-paginar': 'ES el helper de paginación (fetchAllRows). El .range() lo pone él.',
  },
  'supabase/functions/_shared/dteRelatedDoc.ts': {
    'error-ignorado': 'Lookup opcional: la ausencia del documento relacionado es un resultado válido, no un fallo.',
  },
};

function assertSinClavesDuplicadas(src) {
  const claves = [...src.matchAll(/^\s{2}'([^']+)':\s*\{/gm)].map(m => m[1]);
  const vistas = new Set(), dup = new Set();
  for (const k of claves) (vistas.has(k) ? dup : vistas).add(k);
  if (dup.size) {
    console.error(`✗ EXCEPTIONS tiene claves duplicadas (la segunda pisa a la primera en silencio):`);
    for (const d of dup) console.error(`    ${d}`);
    process.exit(2);
  }
}
assertSinClavesDuplicadas(readFileSync(fileURLToPath(import.meta.url), 'utf8'));

const exento = (archivo, cat) => Boolean(EXCEPTIONS[archivo]?.[cat]);

// ── recolección ────────────────────────────────────────────────────────────
const archivos = execSync(
  "find src supabase/functions -type f \\( -name '*.js' -o -name '*.jsx' -o -name '*.ts' \\) ! -name 'version.js'",
  { cwd: RAIZ, encoding: 'utf8' },
).trim().split('\n').filter(Boolean);

const hallazgos = { 'tipo-booleano': [], 'cap-1000': [], 'sin-paginar': [], 'error-ignorado': [] };
const push = (cat, archivo, linea, detalle) => {
  if (exento(archivo, cat)) return;
  hallazgos[cat].push({ archivo, linea, detalle });
};
const lineaDe = (src, idx) => src.slice(0, idx).split('\n').length;

/**
 * Reemplaza comentarios y literales de cadena por espacios del MISMO largo:
 * los índices siguen valiendo (para el número de línea) pero un `.eq('x', true)`
 * citado dentro de un comentario explicativo ya no se cuenta como código.
 * Este archivo tiene comentarios largos que citan queries — sin esto, el gate
 * se delata a sí mismo con falsos positivos y deja de mirarse.
 */
function soloCodigo(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => ' '.repeat(m.length))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length));
}

/** Tabla del `.from('X')` que gobierna la posición idx (el más cercano hacia atrás). */
function tablaEnContexto(src, idx) {
  const antes = src.slice(0, idx);
  const m = [...antes.matchAll(/\.from\(\s*['"](\w+)['"]\s*\)/g)].pop();
  return m ? m[1] : null;
}

for (const archivo of archivos) {
  const src = soloCodigo(readFileSync(join(RAIZ, archivo), 'utf8'));

  // 1. tipo-booleano — .eq/.neq/.is(col, true|false) y {col: true|false} en escrituras,
  //    contra el snapshot de columnas realmente BOOLEAN.
  for (const m of src.matchAll(/\.(eq|neq|is)\(\s*['"](\w+)['"]\s*,\s*(true|false)\s*\)/g)) {
    const col = m[2];
    const tabla = tablaEnContexto(src, m.index);
    if (!tabla || !(tabla in BOOLEANAS)) continue;      // tabla desconocida → no opinar
    if (BOOLEANAS[tabla].includes(col)) continue;       // correcto
    push('tipo-booleano', archivo, lineaDe(src, m.index),
      `.${m[1]}('${col}', ${m[3]}) sobre ${tabla}: la columna NO es boolean`);
  }
  for (const m of src.matchAll(/\.(update|upsert|insert)\(\s*\{([^}]{0,400})\}/g)) {
    const tabla = tablaEnContexto(src, m.index);
    if (!tabla || !(tabla in BOOLEANAS)) continue;
    for (const p of m[2].matchAll(/(\w+)\s*:\s*(true|false)\s*(?:,|$)/g)) {
      if (BOOLEANAS[tabla].includes(p[1])) continue;
      push('tipo-booleano', archivo, lineaDe(src, m.index),
        `.${m[1]}({ ${p[1]}: ${p[2]} }) sobre ${tabla}: la columna NO es boolean`);
    }
  }

  // 2. cap-1000
  for (const m of src.matchAll(/\.limit\(\s*1000\s*\)/g)) {
    push('cap-1000', archivo, lineaDe(src, m.index),
      '.limit(1000) es el cap exacto de PostgREST — usar fetchAllRows o un límite explícito menor');
  }

  // 3. sin-paginar
  for (const m of src.matchAll(/\.from\(\s*['"](\w+)['"]\s*\)([\s\S]{0,450})/g)) {
    const tabla = m[1];
    if (!GRANDES.includes(tabla)) continue;
    const frag = m[2].split(/\.from\(/)[0];
    if (!/\.select\(/.test(frag)) continue;
    if (/head:\s*true/.test(frag)) continue;                              // solo count
    if (/\.range\(|\.limit\(|\.single\(|\.maybeSingle\(|\.in\(/.test(frag)) continue;
    if (/\.eq\(\s*['"]id['"]/.test(frag)) continue;                       // por PK
    if (/\.(update|upsert|insert|delete)\(/.test(frag.split('.select(')[0])) continue; // select de retorno
    const ctx = src.slice(Math.max(0, m.index - 260), m.index);
    if (/fetchAllRows\s*\(/.test(ctx.split('\n').slice(-7).join('\n'))) continue;
    push('sin-paginar', archivo, lineaDe(src, m.index),
      `select sobre ${tabla} sin paginar — envolver en fetchAllRows()`);
  }

  // 4. error-ignorado
  for (const m of src.matchAll(/const\s*\{\s*data(?:\s*:\s*\w+)?\s*\}\s*=\s*await\s+supabase/g)) {
    push('error-ignorado', archivo, lineaDe(src, m.index),
      'destructurar solo `data`: el error del query se descarta');
  }
}

// ── reporte + ratchet ──────────────────────────────────────────────────────
const conteos = Object.fromEntries(Object.entries(hallazgos).map(([k, v]) => [k, v.length]));

if (process.argv.includes('--update-baseline')) {
  writeFileSync(BASELINE, JSON.stringify(conteos, null, 2) + '\n');
  console.log('✓ baseline de data-gate actualizado:', JSON.stringify(conteos));
  process.exit(0);
}

const baseline = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : {};
let falla = false;

for (const [cat, lista] of Object.entries(hallazgos)) {
  const tope = baseline[cat] ?? 0;            // categoría ausente ⇒ bloqueante en cero
  const n = lista.length;
  const estado = n > tope ? '✗ SUBIÓ' : n < tope ? '↓ bajó' : n === 0 ? '✓' : '· igual';
  console.log(`\n${estado}  ${cat}: ${n} (tope ${tope})`);
  if (n > tope) {
    falla = true;
    for (const h of lista) console.log(`     ${h.archivo}:${h.linea}\n       ${h.detalle}`);
  } else if (n > 0 && n <= tope) {
    for (const h of lista.slice(0, 4)) console.log(`     ${h.archivo}:${h.linea} — ${h.detalle}`);
    if (lista.length > 4) console.log(`     … y ${lista.length - 4} más`);
  }
}

if (falla) {
  console.error('\n✗ data-gate: una categoría subió. Es código nuevo que hay que arreglar,');
  console.error('  no un baseline que regenerar.\n');
  process.exit(1);
}
console.log('\n✓ data-gate en verde\n');
