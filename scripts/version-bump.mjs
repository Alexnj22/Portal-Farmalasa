#!/usr/bin/env node
/**
 * Sube APP_VERSION y deja la entrada empezada en CHANGELOG.md, en un solo paso.
 *
 *   npm run version:bump                 → patch  (2.334.1 → 2.334.2)
 *   npm run version:bump -- minor        → 2.335.0
 *   npm run version:bump -- major        → 3.0.0
 *   npm run version:bump -- patch "Título de la entrada"
 *
 * ── Por qué existe ──────────────────────────────────────────────────────────
 * Con 2-3 sesiones sobre el mismo árbol, el bump es una carrera: entre leer la
 * versión y escribirla, otra sesión puede haberse llevado ese número. Medido el
 * 2026-08-01 en UNA sola sesión: pasó tres veces (2.330.0 y 2.331.0 tomadas
 * mientras redactaba, y una vez el archivo llegó ya modificado por otra).
 *
 * No elimina la carrera —nada lo hace sin bloqueos— pero la reduce de minutos a
 * milisegundos: lee, calcula y escribe seguido, y **relee justo antes de
 * escribir** para no pisar un número que se movió en el medio. Si detecta que
 * se movió, recalcula sobre el valor nuevo en vez de fallar.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const RUTA_V = 'src/version.js';
const RUTA_C = 'CHANGELOG.md';

const leer = () => (readFileSync(RUTA_V, 'utf8').match(/APP_VERSION\s*=\s*'([^']+)'/) || [])[1];

const subir = (v, tipo) => {
  const [ma, mi, pa] = v.split('.').map(Number);
  if (tipo === 'major') return `${ma + 1}.0.0`;
  if (tipo === 'minor') return `${ma}.${mi + 1}.0`;
  return `${ma}.${mi}.${pa + 1}`;
};

const args = process.argv.slice(2);
const tipo = ['patch', 'minor', 'major'].includes(args[0]) ? args[0] : 'patch';
const titulo = (['patch', 'minor', 'major'].includes(args[0]) ? args[1] : args[0]) || 'TÍTULO PENDIENTE';

const antes = leer();
if (!antes) {
  console.error(`\n  ✗ No se pudo leer APP_VERSION de ${RUTA_V}\n`);
  process.exit(1);
}

// Relectura inmediata antes de escribir: si otra sesión movió el número en el
// medio, se calcula sobre el valor NUEVO. Pisar su bump sería peor que fallar.
const vigente = leer();
const nueva = subir(vigente, tipo);
if (vigente !== antes) {
  console.log(`\n  ⚠ La versión se movió mientras corría esto (${antes} → ${vigente}).`);
  console.log(`    Recalculado sobre el valor nuevo.`);
}

const src = readFileSync(RUTA_V, 'utf8');
writeFileSync(RUTA_V, src.replace(/APP_VERSION\s*=\s*'[^']+'/, `APP_VERSION = '${nueva}'`));
if (leer() !== nueva) {
  console.error('\n  ✗ El reemplazo no ocurrió. No se tocó CHANGELOG.md.\n');
  process.exit(1);
}

const chg = readFileSync(RUTA_C, 'utf8');
const corte = chg.search(/^## v\d+\.\d+\.\d+/m);
if (corte === -1) {
  console.error(`\n  ✗ No se encontró dónde insertar en ${RUTA_C}\n`);
  process.exit(1);
}
const entrada = `## v${nueva} — ${titulo}\n\n_(pendiente de redactar)_\n\n`;
writeFileSync(RUTA_C, chg.slice(0, corte) + entrada + chg.slice(corte));

console.log(`\n  ${vigente} → ${nueva}  (${tipo})`);
console.log(`  Entrada creada en ${RUTA_C}. Redactala antes de commitear:`);
console.log(`  el gate exige que exista, no que esté bien escrita.\n`);
