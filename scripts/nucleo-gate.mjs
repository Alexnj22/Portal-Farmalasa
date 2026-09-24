/**
 * gate:nucleo — la lógica del portal no conoce al navegador.
 *
 * ── Para qué ────────────────────────────────────────────────────────────────
 *
 * Plan `docs/PLAN-NUCLEO-PORTABLE-2026-09-24.md`: el usuario quiere que el
 * portal pueda tener apps que se sientan nativas (React Native/Expo). Eso sólo
 * es barato si la lógica —`data`, `utils`, `store`, `hooks`, `context`,
 * `constants`— se puede llevar a otra plataforma sin reescribirla. Medido el
 * 2026-09-24: de 258 archivos de lógica, 184 ya eran puros y **55 tocaban el
 * navegador**. Detrás de esos 55 hay cinco adaptadores, no 55 arreglos.
 *
 * Este gate no arregla nada: impide que la cuenta SUBA mientras se baja. Sin
 * él, cada semana aparecerían archivos nuevos que habría que volver a limpiar
 * — con 109 commits por semana en `main`, es exactamente lo que pasaría.
 *
 * ── Qué cuenta ──────────────────────────────────────────────────────────────
 *
 *   navegador   `window`, `document.`, `navigator.`, `localStorage`,
 *               `sessionStorage`, `indexedDB` — no existen en el teléfono
 *   env         `import.meta.env` — es de Vite; el núcleo recibe su
 *               configuración de afuera
 *   pantalla    importar de `components/`, `views/`, `react-dom`,
 *               `react-router`, `lucide-react` o `framer-motion` — la lógica
 *               dice el NOMBRE de un ícono, no lo dibuja
 *
 * `react` a secas NO cuenta: un hook de React corre igual en React Native.
 * Tampoco cuentan los comentarios: medido, el conteo con comentarios daba 60
 * archivos y el real 55 — la documentación de por qué NO se usa `window`
 * acusaba al archivo que lo había sacado.
 *
 * ── El trinquete ────────────────────────────────────────────────────────────
 *
 * `scripts/nucleo-baseline.json` guarda, por archivo y por categoría, cuántos
 * usos había. El gate FALLA si un archivo sube en una categoría o si aparece
 * un archivo nuevo con usos. **El baseline sólo BAJA**: `--update-baseline`
 * se niega a subir el total. Si subió, es acoplamiento nuevo — va por el
 * adaptador, no al baseline.
 *
 * Uso:
 *   node scripts/nucleo-gate.mjs                    el disco
 *   node scripts/nucleo-gate.mjs --hook             sólo lo que el índice conoce
 *   node scripts/nucleo-gate.mjs --listar           cada uso, con su renglón
 *   node scripts/nucleo-gate.mjs --update-baseline  después de BAJAR una deuda
 */
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { archivosIndexados, leerDelIndice } from './lib/git-index.mjs';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE = join(RAIZ, 'scripts', 'nucleo-baseline.json');
const soloIndexado = process.argv.includes('--hook');
const listarTodo   = process.argv.includes('--listar');
const actualizar   = process.argv.includes('--update-baseline');

/* El núcleo: lo que un día va a `packages/core`. */
export const NUCLEO = ['src/data', 'src/utils', 'src/store', 'src/hooks', 'src/context', 'src/constants'];

const REGLAS = [
    ['navegador', /\bwindow\b|\bdocument\s*\.|\bnavigator\s*\.|\blocalStorage\b|\bsessionStorage\b|\bindexedDB\b/],
    ['env',       /\bimport\.meta\.env\b/],
    ['pantalla',  /\bfrom\s+['"](?:(?:\.\.?\/)+(?:components|views)\/|react-dom|react-router|lucide-react|framer-motion)/],
];

/* Quita comentarios conservando los saltos de línea, para que los renglones
 * reportados sigan siendo los del archivo. Respeta cadenas, plantillas
 * ANIDADAS (`…${ x ? `…` : '' }…`, que en este repo arma todo el HTML de lo
 * que se imprime) y expresiones regulares literales (`/['"]/`). La primera
 * versión no llevaba la pila de plantillas y se desfasaba a mitad de
 * `bitacoraPapel.js`: acusaba a un comentario que explicaba `window.print()`. */
function sinComentarios(texto, { blanquearCadenas = false } = {}) {
    let out = '', i = 0;
    // El texto de una cadena no es código: `'window'` no toca al navegador.
    const txt = (ch) => (blanquearCadenas && ch !== '\n' ? ' ' : ch);
    const pila = [];          // 'tpl' = dentro de una plantilla; número = llaves abiertas en un ${…}
    let cadena = null;        // ' o " mientras se está dentro de una
    const enPlantilla = () => pila[pila.length - 1] === 'tpl';
    while (i < texto.length) {
        const c = texto[i], s = texto[i + 1];
        if (cadena) {
            if (c === '\\') { out += txt(c) + txt(s ?? ''); i += 2; continue; }
            if (c === cadena || c === '\n') { cadena = null; out += c; i++; continue; }
            out += txt(c); i++; continue;
        }
        if (enPlantilla()) {
            if (c === '\\') { out += txt(c) + txt(s ?? ''); i += 2; continue; }
            if (c === '`') { pila.pop(); out += c; i++; continue; }
            if (c === '$' && s === '{') { pila.push(0); out += '${'; i += 2; continue; }
            out += txt(c); i++; continue;
        }
        // código (el nivel de arriba, o dentro de un ${…})
        if (c === '"' || c === "'") { cadena = c; out += c; i++; continue; }
        if (c === '`') { pila.push('tpl'); out += c; i++; continue; }
        if (c === '{' && pila.length) { pila[pila.length - 1]++; out += c; i++; continue; }
        if (c === '}' && pila.length && typeof pila[pila.length - 1] === 'number') {
            if (pila[pila.length - 1] === 0) { pila.pop(); out += c; i++; continue; }   // cierra el ${…}
            pila[pila.length - 1]--; out += c; i++; continue;
        }
        if (c === '/' && s === '/') { while (i < texto.length && texto[i] !== '\n') i++; continue; }
        if (c === '/' && s === '*') {
            i += 2;
            while (i < texto.length && !(texto[i] === '*' && texto[i + 1] === '/')) { if (texto[i] === '\n') out += '\n'; i++; }
            i += 2; continue;
        }
        // Una expresión regular literal: el `/` llega donde se espera un valor.
        if (c === '/' && /(^|[(,=:[!&|?{};+\-*%<>~^]|\breturn)\s*$/.test(out.slice(-12))) {
            let k = i + 1, clase = false;
            while (k < texto.length && texto[k] !== '\n') {
                if (texto[k] === '\\') { k += 2; continue; }
                if (texto[k] === '[') clase = true;
                else if (texto[k] === ']') clase = false;
                else if (texto[k] === '/' && !clase) break;
                k++;
            }
            out += texto.slice(i, k + 1); i = k + 1; continue;
        }
        out += c; i++;
    }
    return out;
}

export function usos(texto) {
    const hallazgos = [];
    // `pantalla` mira la RUTA de un import, que es una cadena: se lee sobre el
    // texto con cadenas. Las otras dos, sobre el código con las cadenas en blanco.
    const conCadenas = sinComentarios(texto).split('\n');
    const soloCodigo = sinComentarios(texto, { blanquearCadenas: true }).split('\n');
    const original = texto.split('\n');
    soloCodigo.forEach((l, i) => {
        for (const [cat, re] of REGLAS) {
            if (re.test(cat === 'pantalla' ? conCadenas[i] : l)) hallazgos.push({ cat, linea: i + 1, fuente: (original[i] || '').trim().slice(0, 140) });
        }
    });
    return hallazgos;
}

function listar(dir) {
    const out = [];
    if (!existsSync(join(RAIZ, dir))) return out;
    for (const n of readdirSync(join(RAIZ, dir))) {
        const r = join(dir, n);
        if (statSync(join(RAIZ, r)).isDirectory()) out.push(...listar(r));
        else if (/\.(jsx?|tsx?|mjs)$/.test(n) && !/\.test\./.test(n)) out.push(r);
    }
    return out;
}

const archivos = soloIndexado
    ? [...archivosIndexados(RAIZ, NUCLEO)].filter((f) => /\.(jsx?|tsx?|mjs)$/.test(f) && !/\.test\./.test(f))
    : NUCLEO.flatMap(listar).map((f) => relative(RAIZ, join(RAIZ, f)));
const delIndice = soloIndexado ? leerDelIndice(RAIZ, archivos) : null;

const hoy = {};
const detalle = {};
for (const ruta of archivos.sort()) {
    const texto = soloIndexado ? delIndice.get(ruta) : readFileSync(join(RAIZ, ruta), 'utf8');
    if (texto == null) continue;
    const h = usos(texto);
    if (!h.length) continue;
    detalle[ruta] = h;
    hoy[ruta] = {};
    for (const x of h) hoy[ruta][x.cat] = (hoy[ruta][x.cat] || 0) + 1;
}
const suma = (m) => Object.values(m).reduce((t, cats) => t + Object.values(cats).reduce((a, b) => a + b, 0), 0);
const totalHoy = suma(hoy);

if (listarTodo) {
    for (const [ruta, lista] of Object.entries(detalle)) {
        for (const x of lista) console.log(`${ruta}:${x.linea}  [${x.cat}]  ${x.fuente}`);
    }
    console.log('');
}

let base = null;
try { base = JSON.parse(readFileSync(BASELINE, 'utf8')); } catch { /* primera vez */ }

if (actualizar) {
    if (base && totalHoy > base.total) {
        console.log(`\n  ✗ --update-baseline sólo BAJA: hay ${totalHoy} usos y el baseline dice ${base.total}.`);
        console.log('    Si subió, es acoplamiento nuevo: va por el adaptador, no al baseline.\n');
        process.exit(1);
    }
    const nuevo = { total: totalHoy, archivos: Object.keys(hoy).length, porArchivo: hoy };
    writeFileSync(BASELINE, `${JSON.stringify(nuevo, null, 2)}\n`);
    console.log(`\n  ✓ baseline ${base ? `${base.total} → ` : 'creado: '}${totalHoy} uso(s) en ${Object.keys(hoy).length} archivo(s).\n`);
    process.exit(0);
}

if (!base) {
    console.log('\n  ✗ Falta scripts/nucleo-baseline.json — crearlo con --update-baseline.\n');
    process.exit(1);
}

const subieron = [];
const bajaron = [];
for (const ruta of new Set([...Object.keys(hoy), ...Object.keys(base.porArchivo)])) {
    const ahora = hoy[ruta] || {};
    const antes = base.porArchivo[ruta] || {};
    for (const cat of new Set([...Object.keys(ahora), ...Object.keys(antes)])) {
        const a = ahora[cat] || 0, b = antes[cat] || 0;
        if (a > b) subieron.push({ ruta, cat, a, b });
        else if (a < b) bajaron.push({ ruta, cat, a, b });
    }
}

if (subieron.length) {
    console.log('\n  ✗ gate:nucleo — la lógica ganó usos del navegador o de pantalla:\n');
    for (const s of subieron) {
        console.log(`    ${s.ruta}  [${s.cat}] ${s.b} → ${s.a}`);
        for (const x of (detalle[s.ruta] || []).filter((d) => d.cat === s.cat)) console.log(`        :${x.linea}  ${x.fuente}`);
    }
    console.log('\n    El núcleo tiene que poder correr fuera del navegador. En vez de');
    console.log('    usar `window`/`localStorage`/`import.meta.env` acá, pedírselo al');
    console.log('    adaptador de la plataforma; y en vez de importar un ícono o un');
    console.log('    componente, devolver su NOMBRE y que la pantalla lo resuelva.');
    console.log('    El baseline sólo BAJA — ver docs/PLAN-NUCLEO-PORTABLE-2026-09-24.md.\n');
    process.exit(1);
}

console.log(`\n  ✓ gate:nucleo — ${totalHoy} uso(s) en ${Object.keys(hoy).length} archivo(s) (baseline ${base.total}).`);
if (bajaron.length) {
    console.log(`    Bajó en ${bajaron.length} lugar(es): correr --update-baseline para fijarlo.`);
}
console.log('');
