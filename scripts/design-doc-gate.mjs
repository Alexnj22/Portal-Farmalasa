#!/usr/bin/env node
/**
 * Pasa los bloques de código de DESIGN.md por el mismo gate que el código.
 *
 * Creado en D4 (2026-07-27). El problema que resuelve es concreto: al auditar
 * el documento había 21 menciones de radios fijos y 10 de `shadow-glow` — es
 * decir, la fuente de verdad enseñaba exactamente los patrones que el gate
 * prohíbe. Quien leía el documento escribía deuda nueva creyendo que seguía el
 * estándar.
 *
 * Un documento no se desactualiza de golpe: se desactualiza porque nada lo
 * revisa. Esto lo revisa.
 */
import { readFileSync, writeFileSync, unlinkSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const DOC = 'DESIGN.md';
const texto = readFileSync(DOC, 'utf8');
const lineas = texto.split('\n');

// Bloques ```jsx / ```html / sin lenguaje que contengan clases de Tailwind.
const bloques = [];
let dentro = null;
lineas.forEach((l, i) => {
  const m = l.match(/^```(\w*)\s*$/);
  if (!m) { if (dentro) dentro.cuerpo.push(l); return; }
  if (dentro) { bloques.push(dentro); dentro = null; }
  // Solo bloques con lenguaje EXPLÍCITO. Los bloques sin etiqueta suelen ser
  // prosa que DESCRIBE cómo está hecho un componente ("ConfirmModal usa
  // z-[99999]"), y describir la realidad no es lo mismo que enseñar a
  // escribirla. Marcar eso sería ruido, y un gate ruidoso no lo mira nadie.
  else if (['jsx', 'js', 'html', 'tsx'].includes(m[1])) dentro = { linea: i + 1, lang: m[1], cuerpo: [] };
});

// Los bloques marcados como "❌" son ejemplos de lo que NO hay que hacer:
// tienen que quedar fuera, o el gate marcaría el contraejemplo.
const candidatos = bloques.filter(b => {
  const c = b.cuerpo.join('\n');
  return /className|class=/.test(c) && !/^\s*\/\/\s*❌|❌/m.test(c);
});

const dir = mkdtempSync(join(tmpdir(), 'designdoc-'));
const archivo = join(dir, 'DESIGN_ejemplos.jsx');
// Se envuelve cada bloque para que sea JSX válido y el gate lo lea como código.
writeFileSync(archivo, candidatos.map(b =>
  `/* DESIGN.md línea ${b.linea} */\nexport const _${b.linea} = () => (<>\n${b.cuerpo.join('\n')}\n</>);\n`
).join('\n'));

let salida = '';
try {
  salida = execFileSync('node', ['scripts/design-gate.mjs', '--file', archivo], { encoding: 'utf8' });
} catch (e) {
  salida = (e.stdout || '') + (e.stderr || '');
}

const hallazgos = salida.split('\n').filter(l => /\[\w[\w-]*\]/.test(l));
console.log(`\n  ${candidatos.length} bloques de código revisados en ${DOC}\n`);
if (!hallazgos.length) {
  console.log('  ✓ El documento no enseña nada que el gate prohíba.\n');
} else {
  console.log(`  ✗ ${hallazgos.length} ejemplo(s) contradicen el gate:\n`);
  hallazgos.forEach(h => console.log('   ', h.trim()));
  console.log('\n  Si el documento tiene razón, la excepción va en el gate.');
  console.log('  Si el gate tiene razón, hay que corregir el ejemplo.\n');
}
try { unlinkSync(archivo); } catch { /* el temporal se va solo */ }
process.exit(hallazgos.length ? 1 : 0);
