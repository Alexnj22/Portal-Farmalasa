/**
 * gate:consultas — las pantallas no le hablan a la base.
 *
 * Fase F3 de `docs/PLAN-NUCLEO-PORTABLE-2026-09-24.md`. Una consulta escrita
 * dentro de una pantalla (`src/views`, `src/components`) es una consulta que
 * la app del teléfono no puede reutilizar: tendría que volver a escribirla, y
 * dos copias de la misma consulta terminan pidiendo cosas distintas. Su lugar
 * es `src/data` (las consultas) o `src/hooks` (lo que una pantalla carga y
 * mantiene), que son el núcleo.
 *
 * Medido el 2026-09-26: 35 archivos de pantallas importaban el cliente de la
 * base, con ~100 usos. Este gate no los arregla: impide que SUBAN mientras se
 * mudan. Cuenta, fuera de comentarios, cada `supabase.<algo>` —consultas,
 * funciones, almacenamiento, tiempo real, sesión— por archivo.
 *
 * El trinquete vive en `scripts/consultas-baseline.json` y **sólo baja**:
 * `--update-baseline` se niega a subir el total, y un archivo nuevo con usos
 * falla. Si subió, la consulta va a `src/data`.
 *
 * Uso:
 *   node scripts/consultas-gate.mjs                    el disco
 *   node scripts/consultas-gate.mjs --hook             sólo lo que el índice conoce
 *   node scripts/consultas-gate.mjs --listar           cada uso, con su renglón
 *   node scripts/consultas-gate.mjs --update-baseline  después de BAJAR una deuda
 */
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { archivosIndexados, leerDelIndice } from './lib/git-index.mjs';
import { sinComentarios } from './lib/sin-comentarios.mjs';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE = join(RAIZ, 'scripts', 'consultas-baseline.json');
const soloIndexado = process.argv.includes('--hook');
const listarTodo   = process.argv.includes('--listar');
const actualizar   = process.argv.includes('--update-baseline');

export const PANTALLAS = ['src/views', 'src/components'];
// `supabase` seguido de `.` —en el mismo renglón o en el siguiente, que es como
// se encadena en este repo—. Sobre el código sin comentarios ni cadenas.
const USO = /\bsupabase\s*\n?\s*\./g;

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
    ? [...archivosIndexados(RAIZ, PANTALLAS)].filter((f) => /\.(jsx?|tsx?|mjs)$/.test(f) && !/\.test\./.test(f))
    : PANTALLAS.flatMap(listar).map((f) => relative(RAIZ, join(RAIZ, f)));
const delIndice = soloIndexado ? leerDelIndice(RAIZ, archivos) : null;

const hoy = {};
for (const ruta of archivos.sort()) {
    const texto = soloIndexado ? delIndice.get(ruta) : readFileSync(join(RAIZ, ruta), 'utf8');
    if (texto == null) continue;
    const codigo = sinComentarios(texto, { blanquearCadenas: true });
    const n = (codigo.match(USO) || []).length;
    if (!n) continue;
    hoy[ruta] = n;
    if (listarTodo) {
        codigo.split('\n').forEach((l, i) => { if (/\bsupabase\s*(\.|$)/.test(l)) console.log(`${ruta}:${i + 1}  ${texto.split('\n')[i].trim().slice(0, 120)}`); });
    }
}
const total = Object.values(hoy).reduce((a, b) => a + b, 0);

let base = null;
try { base = JSON.parse(readFileSync(BASELINE, 'utf8')); } catch { /* primera vez */ }

if (actualizar) {
    if (base && total > base.total) {
        console.log(`\n  ✗ --update-baseline sólo BAJA: hay ${total} usos y el baseline dice ${base.total}.`);
        console.log('    Si subió, la consulta va a src/data (o a un hook de src/hooks), no al baseline.\n');
        process.exit(1);
    }
    writeFileSync(BASELINE, `${JSON.stringify({ total, archivos: Object.keys(hoy).length, porArchivo: hoy }, null, 2)}\n`);
    console.log(`\n  ✓ baseline ${base ? `${base.total} → ` : 'creado: '}${total} uso(s) en ${Object.keys(hoy).length} archivo(s).\n`);
    process.exit(0);
}
if (!base) { console.log('\n  ✗ Falta scripts/consultas-baseline.json — crearlo con --update-baseline.\n'); process.exit(1); }

const subieron = Object.entries(hoy).filter(([r, n]) => n > (base.porArchivo[r] || 0));
if (subieron.length) {
    console.log('\n  ✗ gate:consultas — una pantalla le habla a la base más que antes:\n');
    for (const [r, n] of subieron) console.log(`    ${r}: ${base.porArchivo[r] || 0} → ${n}`);
    console.log('\n    La consulta va a src/data (o a un hook de src/hooks): es lo que la app del teléfono');
    console.log('    va a reutilizar. `--listar` muestra cada uso.\n');
    process.exit(1);
}
const bajo = total < base.total ? `  Bajó ${base.total - total}: correr --update-baseline para fijarlo.` : '';
console.log(`\n  ✓ gate:consultas — ${total} uso(s) en ${Object.keys(hoy).length} archivo(s) (baseline ${base.total}).${bajo}\n`);
