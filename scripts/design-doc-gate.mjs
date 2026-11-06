#!/usr/bin/env node
/**
 * Revisa DESIGN.md contra el código. Tres chequeos:
 *
 *   1. Ejemplos — TODO bloque ```jsx / ```js / ```tsx / ```html pasa por el
 *      mismo gate que el código (`design-gate.mjs`). Los contraejemplos se
 *      marcan con «❌» dentro del bloque y quedan fuera.
 *   2. Referencias — todo «§N» citado en la prosa tiene que existir como
 *      encabezado. Una referencia a OTRO documento nombra el archivo en la
 *      misma línea (`index.css` §1.5, `PLAN-X.md` §4) y se saltea.
 *   3. Anexo — toda categoría de `design-gate.mjs` aparece en la tabla del
 *      §35. Una regla que sólo vive en el gate no la conoce nadie hasta que
 *      el commit rebota.
 *
 * Creado en D4 (2026-07-27) con el chequeo 1, pero sólo leía los bloques con
 * `className` y sin ❌: revisaba 16 de 92. El 2026-11-06 pasó a leerlos todos
 * y se sumaron el 2 y el 3, después de una auditoría que encontró diecisiete
 * contradicciones y una docena de «§N» que apuntaban a secciones inexistentes.
 *
 * Un documento no se desactualiza de golpe: se desactualiza porque nada lo
 * revisa. Esto lo revisa.
 */
import { readFileSync, writeFileSync, unlinkSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const DOC = 'DESIGN.md';
const GATE = 'scripts/design-gate.mjs';
const texto = readFileSync(DOC, 'utf8');
const lineas = texto.split('\n');
const errores = [];

// ── Bloques de código ───────────────────────────────────────────────────
const bloques = [];
const enBloque = new Array(lineas.length).fill(false);
{
  let dentro = null;
  lineas.forEach((l, i) => {
    const m = l.match(/^\s*```(\w*)\s*$/);
    if (!m) {
      if (dentro) { dentro.cuerpo.push(l); enBloque[i] = true; }
      return;
    }
    enBloque[i] = true;
    if (dentro) { bloques.push(dentro); dentro = null; }
    else dentro = { linea: i + 1, lang: m[1], cuerpo: [] };
  });
  if (dentro) errores.push(`L${dentro.linea}: bloque de código sin cerrar`);
}

// ── 1. Ejemplos ─────────────────────────────────────────────────────────
// Sólo bloques con lenguaje EXPLÍCITO de código. Los bloques sin etiqueta son
// prosa que DESCRIBE cómo está hecho algo, y describir la realidad no es lo
// mismo que enseñar a escribirla.
const deCodigo = bloques.filter(b => ['jsx', 'js', 'html', 'tsx'].includes(b.lang));
const candidatos = deCodigo.filter(b => !b.cuerpo.some(l => l.includes('❌')));

const dir = mkdtempSync(join(tmpdir(), 'designdoc-'));
const archivo = join(dir, 'DESIGN_ejemplos.jsx');
// Cada bloque va CRUDO (sin envolver: el gate lee texto, no un AST) y se
// anota de qué línea del documento salió cada línea del temporal.
const origen = [];
const salidaTmp = [];
for (const b of candidatos) {
  salidaTmp.push(`/* DESIGN.md línea ${b.linea} */`); origen.push(b.linea);
  b.cuerpo.forEach((l, k) => { salidaTmp.push(l); origen.push(b.linea + 1 + k); });
  salidaTmp.push(''); origen.push(b.linea);
}
writeFileSync(archivo, salidaTmp.join('\n'));

let json = { byFile: {} };
try {
  json = JSON.parse(execFileSync('node', [GATE, '--file', archivo, '--json'],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
} catch (e) {
  errores.push(`no se pudo correr ${GATE}: ${(e.stderr || e.message || '').slice(0, 300)}`);
}
try { unlinkSync(archivo); } catch { /* el temporal se va solo */ }

// `import` no aplica a un documento: un ejemplo muestra CÓMO se usa un
// componente, no un archivo completo, y pedirle sus imports lo llena de ruido.
const ejemplos = (json.byFile[archivo] || []).filter(f => f.category !== 'import');
for (const f of ejemplos) {
  errores.push(`L${origen[f.line - 1] ?? '?'} [${f.category}] ${f.label}`);
}

// ── 2. Referencias «§N» ─────────────────────────────────────────────────
const ID = String.raw`\d+(?:\.(?:\d+|bis|ter|quater)(?:-(?:bis|ter|quater))?)*`;
const secciones = new Set();
lineas.forEach((l, i) => {
  if (enBloque[i]) return;
  const m = l.match(new RegExp(String.raw`^#{2,4}\s+§?(${ID})\.?(?:\s|$)`));
  if (m) secciones.add(m[1]);
});
// Una línea que nombra otro documento (o index.css) cita SUS secciones.
const OTRO_DOC = /(?<!DESIGN)\.md\b|index\.css|PLAN-[A-Z]|AUDITORIA-|RTS\b|Art\./;
lineas.forEach((l, i) => {
  if (enBloque[i] || OTRO_DOC.test(l)) return;
  const sinCodigo = l.replace(/`[^`]*`/g, '');
  for (const m of sinCodigo.matchAll(new RegExp(String.raw`§\s?(${ID})`, 'g'))) {
    const id = m[1].replace(/\.$/, '');
    if (!secciones.has(id)) errores.push(`L${i + 1}: cita §${id}, que no existe como encabezado`);
  }
  if (/§[a-zñáéíóú]/.test(sinCodigo)) errores.push(`L${i + 1}: «§» seguido de letra — ¿errata?`);
});

// ── 3. Anexo: toda categoría del gate tiene su fila ─────────────────────
const gate = readFileSync(GATE, 'utf8');
const categorias = [...new Set([...gate.matchAll(/category:\s*'([a-z0-9-]+)'/g)].map(m => m[1]))];
const ini = lineas.findIndex(l => /^## 35\./.test(l));
const anexo = ini < 0 ? '' : lineas.slice(ini).join('\n');
if (ini < 0) errores.push('falta el «## 35. Anexo» con la tabla de categorías del gate');
const faltan = categorias.filter(c => !anexo.includes('`' + c + '`'));
for (const c of faltan) errores.push(`§35: la categoría \`${c}\` del gate no tiene fila en el anexo`);

// ── Informe ─────────────────────────────────────────────────────────────
console.log(`\n  ${candidatos.length} de ${deCodigo.length} bloques de código revisados `
  + `(${deCodigo.length - candidatos.length} contraejemplos ❌), ${secciones.size} secciones, `
  + `${categorias.length} categorías del gate — ${DOC}\n`);
if (!errores.length) {
  console.log('  ✓ El documento no enseña nada que el gate prohíba, no cita secciones que no');
  console.log('    existen, y toda categoría del gate tiene su regla escrita.\n');
  process.exit(0);
}
console.log(`  ✗ ${errores.length} problema(s):\n`);
errores.forEach(e => console.log('   ', e));
console.log('\n  Si el documento tiene razón, la excepción va en el gate.');
console.log('  Si el gate tiene razón, hay que corregir el documento.\n');
process.exit(1);
