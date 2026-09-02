/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Leer una variable ANTES de su `const` — el error que nombra una letra
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Bloquea en cero las lecturas que ocurren **de verdad**, y lleva en baseline
 * las que no pueden ocurrir. Es hermano de `gate:undefinidos`: aquél caza la
 * variable que NO EXISTE, éste la que existe pero **todavía no**.
 *
 * ── El caso que lo hizo nacer (2026-09-02, v2.936.2) ───────────────────────
 *
 * Efectivo reventaba entera al entrar. En consola:
 *
 *     ReferenceError: Cannot access 'E' before initialization.
 *         Yv — index-Be4kuNCf.js:9:65023
 *
 * Dos cosas hacen caro a este defecto, y las dos son sobre el AVISO y no sobre
 * el código:
 *
 *  1. **La `E` está minificada.** El nombre real —`nombreSala`— no aparece por
 *     ningún lado, así que el mensaje no dice qué mirar.
 *  2. **El único rastro apunta a React, no al portal.** `9:65023` cae dentro de
 *     `react-dom`, porque quien llama al componente es React. El archivo del
 *     portal no sale en la pila.
 *
 * Se buscó primero donde no estaba: imports circulares (cero en todo `src/`) y
 * avisos del compilador (ninguno). Y era una línea:
 *
 *     useResolverCorte({ nombreSala: { [sala]: nombreSala } })   // linea 241
 *     ...
 *     const nombreSala = useMemo(...)                            // linea 307
 *
 * Ese objeto se arma **al renderizar**, así que no da `undefined` —que habría
 * pasado inadvertido y sólo dejaría un rótulo vacío—: lanza en CADA render y
 * tira la vista entera al ErrorBoundary.
 *
 * ── Por qué NO alcanza con encender `no-use-before-define` ─────────────────
 *
 * Porque la regla sola denuncia 60 y **la enorme mayoría no puede fallar**:
 * son lecturas dentro del cuerpo de una función que se llama después, cuando
 * el `const` ya existe. `conMayuscula` leída dentro de un `useCallback` es
 * correcta; `nombreSala` leída dentro del argumento de un hook, no.
 *
 * Sesenta hallazgos de los cuales uno importa es un gate que se desactiva. Así
 * que acá se separan, y la separación es DECIDIBLE:
 *
 *   **inmediata**  entre la lectura y el ámbito que declara la variable NO hay
 *                  ninguna función. O sea: la lectura corre en la misma pasada
 *                  que la declaración, y por eso llega antes. **Lanza seguro.**
 *
 *   **diferida**   hay al menos una función en el medio. Lo que corre en esa
 *                  pasada es la DEFINICIÓN de la función, no su cuerpo; cuando
 *                  alguien la llame, el `const` ya estará. Va al baseline.
 *
 * El corte no es una heurística: sale del árbol de ámbitos que el propio
 * linter construye (`eslint-scope`), y es exactamente lo que separó el defecto
 * de Efectivo de los otros 59.
 *
 * ⚠️ «Diferida» significa *no puede fallar por llegar temprano*, no *está
 * bien escrita*. El baseline SÓLO BAJA: no se regenera para tapar un hallazgo.
 *
 * Uso:
 *   node scripts/tdz-gate.mjs                    todo `src/` desde el disco
 *   node scripts/tdz-gate.mjs --hook             sólo lo que el ÍNDICE conoce
 *   node scripts/tdz-gate.mjs --update-baseline  después de BAJAR una deuda
 *
 * `--hook` mira el índice y no el disco por lo mismo que los otros gates: en
 * este árbol trabajan varias sesiones a la vez, y bloquear un commit por el
 * archivo a medio editar de otra persona culpa a quien no lo tocó.
 */
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Linter } from 'eslint';
import { archivosIndexados, leerDelIndice } from './lib/git-index.mjs';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE = join(RAIZ, 'scripts', 'tdz-baseline.json');
const soloIndexado   = process.argv.includes('--hook');
const actualizar     = process.argv.includes('--update-baseline');

/* ── La regla ───────────────────────────────────────────────────────────────
 *
 * Escrita acá y no tomada de ESLint porque `no-use-before-define` contesta
 * «¿se lee antes?» y lo que hace falta es «¿se lee antes Y en la misma
 * pasada?». La primera pregunta tiene 60 respuestas y la segunda, una.
 *
 * `var` queda fuera a propósito: se iza con valor `undefined`, así que leerla
 * temprano no lanza. Es un defecto distinto y lo mira otro linter. */
const regla = {
  create(context) {
    const sc = context.sourceCode ?? context.getSourceCode();

    const revisar = (scope) => {
      for (const ref of scope.references) {
        const v = ref.resolved;
        if (!v || !v.defs.length || !ref.identifier?.range) continue;
        const def = v.defs[0];
        if (def.type !== 'Variable' || def.parent?.kind === 'var') continue;

        const decl = def.name;
        if (!decl?.range || ref.identifier.range[0] >= decl.range[0]) continue;

        /* ¿Hay una función entre quien lee y quien declara? Se sube por el
         * árbol de ámbitos desde la lectura hasta el ámbito de la variable.
         * Un bloque (`if`, `for`) NO difiere nada: corre en la misma pasada.
         * Sólo una función lo hace. */
        let diferida = false;
        for (let s = ref.from; s && s !== v.scope; s = s.upper) {
          if (s.type === 'function' || s.type === 'class-field-initializer'
              || s.type === 'class-static-block') { diferida = true; break; }
        }

        context.report({
          node: ref.identifier,
          messageId: diferida ? 'diferida' : 'inmediata',
          data: { nombre: v.name, linea: String(decl.loc.start.line) },
        });
      }
      scope.childScopes.forEach(revisar);
    };

    return { 'Program:exit'() { revisar(sc.scopeManager.globalScope); } };
  },
  meta: {
    messages: {
      inmediata: "'{{nombre}}' se lee acá y su `const` está en la línea {{linea}} — LANZA en cada pasada",
      diferida: "'{{nombre}}' se lee antes de su `const` de la línea {{linea}}, pero dentro de una función",
    },
  },
};

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
  console.log('  ✓ gate:tdz — el commit no toca `src/`, nada que mirar.');
  process.exit(0);
}

const linter = new Linter();
const config = [{
  files: ['**/*.{js,jsx}'],
  languageOptions: {
    ecmaVersion: 'latest', sourceType: 'module',
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
  plugins: { tdz: { rules: { 'antes-del-const': regla } } },
  rules: { 'tdz/antes-del-const': 'error' },
}];

const inmediatas = [];
const diferidas  = [];
const ilegibles  = [];

for (const archivo of archivos) {
  const texto = leer(archivo);
  if (!texto) continue;
  let mensajes;
  try {
    mensajes = linter.verify(texto, config, archivo);
  } catch {
    // Un archivo que no se pudo parsear NO se da por bueno: un gate que se
    // calla ante lo que no pudo medir no puede dar verde.
    ilegibles.push(archivo);
    continue;
  }
  for (const m of mensajes) {
    if (m.fatal) { ilegibles.push(`${archivo}:${m.line}`); continue; }
    const h = { archivo, linea: m.line, mensaje: m.message };
    (m.messageId === 'inmediata' ? inmediatas : diferidas).push(h);
  }
}

// ── El baseline: sólo las diferidas, y sólo baja ───────────────────────────
let base = { total: 0, porArchivo: {} };
try { base = JSON.parse(readFileSync(BASELINE, 'utf8')); } catch { /* primera vez */ }

const porArchivo = {};
for (const d of diferidas) porArchivo[d.archivo] = (porArchivo[d.archivo] || 0) + 1;

if (actualizar) {
  const nuevo = { total: diferidas.length, porArchivo };
  // La primera vez no hay de dónde bajar: el baseline nace con la deuda del día
  // que se escribió el gate. Después, sólo baja.
  const primeraVez = !existsSync(BASELINE);
  if (!primeraVez && !soloIndexado && diferidas.length > base.total) {
    console.log(`  ✗ --update-baseline sólo BAJA: hay ${diferidas.length} y el baseline dice ${base.total}.`);
    console.log('    Si subió, es deuda nueva que hay que arreglar — no anotar.\n');
    process.exit(1);
  }
  writeFileSync(BASELINE, `${JSON.stringify(nuevo, null, 2)}\n`);
  console.log(`  ✓ baseline actualizado: ${base.total} → ${diferidas.length} diferida(s).\n`);
  process.exit(0);
}

// ── Veredicto ──────────────────────────────────────────────────────────────
const subieron = Object.entries(porArchivo)
  .filter(([f, n]) => n > (base.porArchivo?.[f] ?? 0));

if (!inmediatas.length && !ilegibles.length && !subieron.length) {
  console.log(`  ✓ gate:tdz — ${archivos.length} archivo(s), ninguna lectura que lance.`);
  if (diferidas.length) {
    console.log(`    ${diferidas.length} lectura(s) antes del \`const\` pero dentro de una función `
      + '(no pueden fallar; bajo baseline).');
  }
  console.log('');
  process.exit(0);
}

if (ilegibles.length) {
  console.log(`  ✗ gate:tdz — ${ilegibles.length} archivo(s) que no se pudieron leer\n`);
  for (const f of ilegibles) console.log(`      ${f}`);
  console.log('');
}

if (inmediatas.length) {
  console.log(`  ✗ gate:tdz — ${inmediatas.length} lectura(s) que LANZAN\n`);
  for (const h of inmediatas) console.log(`      ${h.archivo}:${h.linea}  ${h.mensaje}`);
  console.log('');
  console.log('    Esto NO da `undefined`: da «Cannot access … before initialization»,');
  console.log('    y si pasa al renderizar se lleva la vista entera al ErrorBoundary.');
  console.log('    El aviso trae el nombre MINIFICADO y una pila que apunta a React,');
  console.log('    así que no dice dónde. Mover la declaración arriba, o el uso abajo.');
  console.log('');
}

if (subieron.length) {
  console.log(`  ✗ gate:tdz — deuda diferida nueva en ${subieron.length} archivo(s)\n`);
  for (const [f, n] of subieron) console.log(`      ${f}: ${n} (baseline ${base.porArchivo?.[f] ?? 0})`);
  console.log('');
  console.log('    Hoy no puede fallar, pero mover ese uso fuera de la función lo');
  console.log('    convierte en el de arriba. El baseline sólo BAJA.');
  console.log('');
}

process.exit(1);
