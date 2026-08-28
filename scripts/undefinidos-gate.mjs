/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Una variable que no existe — el error que nombra otra cosa
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Corre la regla `no-undef` de ESLint sobre `src/` y **bloquea en cero**.
 *
 * ── Por qué hace falta un gate para algo que el linter ya sabe ─────────────
 *
 * Porque nada corría el linter. `npm run lint` existe desde siempre, no está en
 * el hook de pre-commit —el resto del proyecto tiene errores de otras reglas, así
 * que un `eslint .` bloqueante fallaría desde el primer commit— y nadie lo corre
 * a mano al cerrar. O sea: la regla estaba encendida y su hallazgo no llegaba a
 * ninguna pantalla.
 *
 * ── Dos casos en dos días, y los dos con la misma firma ────────────────────
 *
 * Lo que hace a este defecto caro no es que sea difícil: es que **el error
 * nombra otra cosa**, así que manda a mirar donde no está el problema.
 *
 *   · 2026-08-27, `EmployeeFormModal`. `aiResponse` estaba declarada dentro de
 *     un `if (stored)` y la rama del certificado médico anual la lee 40
 *     renglones más abajo, ya fuera del bloque. El `?.` no protege: una
 *     variable de otro ámbito no es «indefinida», directamente no existe. El
 *     `ReferenceError` caía en el `catch` del alta, que dice **«Error al subir
 *     documento»** y hace `updateDoc(url: null)` — o sea que el archivo SÍ se
 *     había subido y el formulario lo soltaba igual. El certificado médico
 *     anual no se podía adjuntar, y el aviso mandaba a revisar la subida, que
 *     era lo único que había funcionado.
 *
 *   · 2026-08-28, `UnifiedModal`. `descargarDocumentoDeBienvenida` se llamaba
 *     sin importarla. El `ReferenceError` caía en el `catch` del alta, que
 *     muestra **«No se pudo guardar la ficha»** — con el empleado YA CREADO. La
 *     persona vuelve a intentar y crea un duplicado, o da por hecho que no pasó
 *     nada. Y de paso se perdían la contraseña temporal (sólo existe en esa
 *     respuesta), el carné de papel, el cierre del diálogo y la limpieza del
 *     borrador.
 *
 * Ninguno de los dos falla al compilar: para el empaquetador un identificador
 * suelto es una variable global que ya aparecerá. Ninguno de los dos aparece en
 * una prueba, porque las dos ramas son de un camino que la prueba no recorre. Y
 * ninguno de los dos aparece en un log: el `catch` de más arriba se los come y
 * escribe un mensaje que habla de otra cosa.
 *
 * ── Por qué SÓLO `no-undef` ────────────────────────────────────────────────
 *
 * Es la única regla de las que hay encendidas que denuncia código que **va a
 * lanzar seguro** al ejecutarse. El resto de lo que reporta el linter hoy son
 * avisos del compilador de React sobre memoización que no se pudo preservar:
 * son reales y valen la pena, pero no rompen nada y hay una docena. Meterlos
 * acá haría fallar el gate desde el primer commit, y un gate que siempre falla
 * enseña a escribir `--no-verify`.
 *
 * Estaba en CERO en todo `src/` el 2026-08-28, con el defecto de arriba ya
 * corregido. Por eso puede ser bloqueante sin baseline: cualquier hallazgo es
 * código nuevo.
 *
 * Uso:
 *   node scripts/undefinidos-gate.mjs          todo `src/` desde el disco
 *   node scripts/undefinidos-gate.mjs --hook   sólo lo que el ÍNDICE conoce
 *
 * `--hook` mira el índice y no el disco por la misma razón que los otros gates:
 * en este árbol trabajan varias sesiones a la vez, y bloquear un commit por el
 * archivo a medio editar de otra persona culpa a quien no lo tocó.
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { archivosIndexados, leerDelIndice } from './lib/git-index.mjs';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const soloIndexado = process.argv.includes('--hook');

// ── Qué se mira ────────────────────────────────────────────────────────────
let archivos;
let leer;
if (soloIndexado) {
  archivos = [...archivosIndexados(RAIZ, ['src'])].filter(f => /\.(js|jsx)$/.test(f));
  const contenido = leerDelIndice(RAIZ, archivos);
  leer = (f) => contenido.get(f) ?? '';
} else {
  archivos = execSync("find src -type f \\( -name '*.js' -o -name '*.jsx' \\)",
    { cwd: RAIZ, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    .trim().split('\n').filter(Boolean);
  leer = (f) => readFileSync(join(RAIZ, f), 'utf8');
}

console.log('');
if (!archivos.length) {
  console.log('  ✓ gate:undefinidos — el commit no toca `src/`, nada que mirar.');
  process.exit(0);
}

// ── El linter, con la config del proyecto ──────────────────────────────────
// Se usa la config real y después se FILTRA a `no-undef`, en vez de correr la
// regla suelta: con la config propia, `globals` y `parserOptions` son los del
// proyecto, así que `window`, `crypto` o el JSX no se denuncian como
// indefinidos. Una regla corrida fuera de su config no mide lo mismo.
const eslint = new ESLint({ cwd: RAIZ });

const hallazgos = [];
for (const archivo of archivos) {
  const texto = leer(archivo);
  if (!texto) continue;
  let resultados;
  try {
    resultados = await eslint.lintText(texto, { filePath: join(RAIZ, archivo), warnIgnored: false });
  } catch {
    // Un archivo que el linter no puede ni parsear NO se da por bueno: se
    // reporta, porque un gate que se calla ante lo que no pudo medir no puede
    // dar verde. (`feedback_un_gate_que_no_pudo_medir_no_puede_dar_verde`)
    hallazgos.push({ archivo, linea: 0, mensaje: 'el linter no pudo leer este archivo' });
    continue;
  }
  for (const r of resultados) {
    for (const m of r.messages) {
      if (m.ruleId === 'no-undef') hallazgos.push({ archivo, linea: m.line, mensaje: m.message });
    }
  }
}

if (!hallazgos.length) {
  console.log(`  ✓ gate:undefinidos — ${archivos.length} archivo(s), ninguna variable inexistente.`);
  process.exit(0);
}

console.log(`  ✗ gate:undefinidos — ${hallazgos.length} variable(s) que no existen\n`);
for (const h of hallazgos) console.log(`      ${h.archivo}:${h.linea}  ${h.mensaje}`);
console.log('');
console.log('    Esto LANZA al ejecutarse. Y el `catch` de más arriba se lo come y');
console.log('    escribe un mensaje que habla de otra cosa: ya pasó dos veces, una');
console.log('    diciendo «Error al subir documento» sobre un archivo que sí se');
console.log('    subió, y otra «No se pudo guardar la ficha» con el empleado ya');
console.log('    creado. Casi siempre es un `import` que falta o una variable');
console.log('    declarada dentro de un bloque y leída fuera.');
console.log('');
process.exit(1);
