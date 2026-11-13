// gate:app-nativa — todo módulo del portal tiene su pantalla NATIVA en la app.
//
//   node scripts/app-nativa-gate.mjs          → revisa y falla con lo que falte
//   node scripts/app-nativa-gate.mjs --hook   → igual, para el pre-commit
//
// Por qué existe (2026-10-12): el menú de la app sale de `MODULE_MAP`, y un
// módulo sin pantalla nativa no falla — se abre como el portal web dentro de la
// app (`apps/mobile/pantallas.js`, `PANTALLAS_DE_LA_APP`). Así que cada vista
// nueva que otra sesión agregaba al portal entraba a la app como página web, sin
// que nadie lo notara: el usuario lo preguntó con «¿por qué si agregamos nuevos
// módulos, en la app no la modificas a nativa de un solo?». Ese día faltaban
// `mayoristas` y `chat_clientes`.
//
// Revisa dos cosas:
//   1. Todo módulo con `path` está en PANTALLAS_DE_LA_APP (true o alias a una
//      ruta nativa) o en EXCEPCIONES de este archivo, con su motivo escrito.
//   2. Toda ruta nativa declarada existe como pantalla en apps/mobile/app/
//      (un alias a una pantalla que no existe abre una pantalla en blanco).
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MODULE_MAP } from '../src/constants/moduleMap.js';

const RAIZ = new URL('..', import.meta.url).pathname;
const APP = join(RAIZ, 'apps/mobile/app');

// Módulos que se quedan como portal web dentro de la app, cada uno con su motivo.
// Sin motivo no se declara: se le hace su pantalla nativa.
const EXCEPCIONES = {
  entrevistas: 'el portal muestra «próximamente»: no hay nada que pasar a nativo',
};

const fuente = readFileSync(join(RAIZ, 'apps/mobile/pantallas.js'), 'utf8');
const bloque = fuente.slice(fuente.indexOf('PANTALLAS_DE_LA_APP = {'), fuente.indexOf('\n};', fuente.indexOf('PANTALLAS_DE_LA_APP = {')));
const declaradas = new Map([...bloque.matchAll(/^\s*'(\/[^']*)':\s*(true|'(\/[^']*)')/gm)]
  .map((m) => [m[1], m[2] === 'true' ? m[1] : m[3]]));

// Una ruta de expo-router existe si hay archivo para ella (los grupos `(tabs)` no cuentan en la ruta).
function existePantalla(ruta) {
  const r = ruta.replace(/^\//, '');
  return [`${r}.js`, `${r}/index.js`, `(tabs)/${r}.js`, `(tabs)/${r}/index.js`, ...(r === 'inicio' ? ['(tabs)/index.js', 'index.js'] : [])]
    .some((f) => existsSync(join(APP, f)));
}

const fallas = [];
for (const [clave, m] of Object.entries(MODULE_MAP)) {
  if (!m?.path) continue;
  if (declaradas.has(m.path)) continue;
  if (EXCEPCIONES[clave]) continue;
  fallas.push(`  ✗ ${clave} (${m.path}, «${m.label}») no tiene pantalla nativa en la app: créala en apps/mobile/app/ y regístrala en PANTALLAS_DE_LA_APP, o decláralo en EXCEPCIONES con su motivo.`);
}
for (const [ruta, destino] of declaradas) {
  if (!existePantalla(destino)) fallas.push(`  ✗ PANTALLAS_DE_LA_APP['${ruta}'] apunta a «${destino}», que no existe en apps/mobile/app/.`);
}
for (const clave of Object.keys(EXCEPCIONES)) {
  if (!MODULE_MAP[clave]) fallas.push(`  ✗ EXCEPCIONES nombra «${clave}», que ya no está en MODULE_MAP: quítalo.`);
  else if (declaradas.has(MODULE_MAP[clave].path)) fallas.push(`  ✗ «${clave}» ya es nativo: quítalo de EXCEPCIONES.`);
}

if (fallas.length) {
  console.error(`✗ gate:app-nativa — ${fallas.length} hallazgo(s):\n${fallas.join('\n')}`);
  process.exit(1);
}
console.log(`✓ gate:app-nativa — ${Object.values(MODULE_MAP).filter((m) => m?.path).length} módulos: todos nativos o declarados (${Object.keys(EXCEPCIONES).length} excepción).`);
