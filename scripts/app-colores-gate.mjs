#!/usr/bin/env node
// gate:app-colores — en la app del personal, el color de la marca y los del
// sistema se LEEN al pintar, nunca se escriben a mano ni se congelan al cargar.
//
// Por qué existe (2026-11-14): en Android la app toma el color del sistema
// (Material You) a través de `MARCA.azul` / `MARCA.azulClaro` y de
// `colorSistema.*`, que son getters (`componentes/inicio/marca.js`,
// `componentes/Formulario.js`). Había 25 sitios con el azul escrito a mano
// (`'rgba(0,82,204,0.35)'`) y seguían azules con cualquier tema; el barrido
// visual del día anterior no los vio porque casi todos sólo aparecen al elegir
// algo (un filtro, un día, una sala). Y la regla «no se escribe un color a mano»
// estaba escrita en AGENTS.md, pero nada la vigilaba.
//
// Dos cosas caza:
//   A. El azul de la marca escrito a mano: `#0052CC`, `#3B82F6` o su `rgba(…)`.
//      Se escribe `${MARCA.azul}4D` (el sufijo es la opacidad en hex).
//   B. Un color vivo leído al CARGAR el módulo: `MARCA.azul`, `MARCA.azulClaro`
//      o `colorSistema.x` fuera de toda función — p. ej.
//      `const TONO = { info: MARCA.azulClaro }`. Eso se evalúa una vez y queda
//      congelado: no sigue al cambio de tema ni al color nuevo del sistema. Se
//      escribe con getter (`get info() { return MARCA.azulClaro; }`) o se lee
//      dentro del componente.
//
// Excepción en la misma línea o la anterior: `// color-fijo: <motivo>`.
//
//   node scripts/app-colores-gate.mjs          → informe; falla con hallazgos
//   node scripts/app-colores-gate.mjs --hook   → igual, para el pre-commit
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { parse } = require('@babel/parser');

const RAIZ = 'apps/mobile';
const CARPETAS = ['app', 'componentes'];
// Donde los colores SE DEFINEN (la marca, la tabla de respaldo del sistema) o
// un fondo decorativo que es la marca a propósito en los dos sistemas.
const DEFINICIONES = new Set([
  'apps/mobile/componentes/inicio/marca.js',
  'apps/mobile/componentes/Formulario.js',
  'apps/mobile/componentes/Aurora.js',
]);
const LITERAL = /#0052cc|#3b82f6|rgba\(\s*0\s*,\s*82\s*,\s*204|rgba\(\s*59\s*,\s*130\s*,\s*246/i;
const VIVO = new Set(['azul', 'azulClaro']);

function archivos(dir) {
  const out = [];
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) { if (n !== 'node_modules') out.push(...archivos(p)); }
    else if (/\.(js|jsx)$/.test(n)) out.push(p);
  }
  return out;
}

const exento = (lineas, i) => /color-fijo:/.test(lineas[i] ?? '') || /color-fijo:/.test(lineas[i - 1] ?? '');
const FUNCION = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression', 'ObjectMethod', 'ClassMethod', 'ClassPrivateMethod']);

function colorVivo(n) {
  if (n.type !== 'MemberExpression' || n.computed || n.object.type !== 'Identifier') return null;
  if (n.object.name === 'MARCA' && VIVO.has(n.property.name)) return `MARCA.${n.property.name}`;
  if (n.object.name === 'colorSistema') return `colorSistema.${n.property.name}`;
  return null;
}

// Recorre el árbol sin entrar en funciones: lo que encuentra se evalúa al cargar.
function alCargar(nodo, encontrados) {
  if (!nodo || typeof nodo.type !== 'string') return;
  if (FUNCION.has(nodo.type)) return;
  const c = colorVivo(nodo);
  if (c) { encontrados.push({ linea: nodo.loc.start.line, que: c }); return; }
  for (const k of Object.keys(nodo)) {
    if (k === 'loc' || k === 'start' || k === 'end' || k === 'leadingComments' || k === 'trailingComments') continue;
    const v = nodo[k];
    if (Array.isArray(v)) v.forEach((x) => alCargar(x, encontrados));
    else if (v && typeof v.type === 'string') alCargar(v, encontrados);
  }
}

const hallazgos = [];
for (const c of CARPETAS) {
  for (const f of archivos(join(RAIZ, c))) {
    const rel = relative('.', f);
    const texto = readFileSync(f, 'utf8');
    const lineas = texto.split('\n');
    if (!DEFINICIONES.has(rel)) {
      lineas.forEach((l, i) => {
        if (LITERAL.test(l) && !/^\s*\/\//.test(l) && !exento(lineas, i)) hallazgos.push({ f: rel, linea: i + 1, que: 'azul de la marca escrito a mano', texto: l.trim() });
      });
      let ast;
      try { ast = parse(texto, { sourceType: 'module', plugins: ['jsx'] }); } catch (e) { hallazgos.push({ f: rel, linea: 0, que: `no se pudo leer: ${e.message}`, texto: '' }); continue; }
      const enc = [];
      for (const s of ast.program.body) alCargar(s, enc);
      for (const { linea, que } of enc) {
        if (!exento(lineas, linea - 1)) hallazgos.push({ f: rel, linea, que: `${que} leído al cargar el módulo (queda congelado)`, texto: lineas[linea - 1].trim() });
      }
    }
  }
}

if (!hallazgos.length) {
  console.log('✓ gate:app-colores — sin colores de la marca a mano ni colores vivos congelados al cargar.');
  process.exit(0);
}
console.log(`✗ gate:app-colores — ${hallazgos.length} hallazgo(s):`);
for (const h of hallazgos) console.log(`  ${h.f}:${h.linea}  ${h.que}\n      ${h.texto.slice(0, 140)}`);
console.log('\n  A mano → `${MARCA.azul}4D` (opacidad en hex). Al cargar → getter (`get x() { return MARCA.azulClaro; }`) o leerlo dentro del componente.');
console.log('  Si es a propósito: `// color-fijo: <motivo>` en la línea o la anterior.');
process.exit(1);
