#!/usr/bin/env node
/**
 * nucleo-alias — las importaciones que CRUZAN el borde del núcleo van por
 * alias, nunca por ruta relativa (F7 del plan del núcleo portable,
 * docs/PLAN-NUCLEO-PORTABLE-2026-09-24.md).
 *
 * ── Por qué ──────────────────────────────────────────────────────────────────
 * F7 muda el núcleo a `packages/core`. Si las pantallas lo importan con
 * `../../utils/fecha`, la mudanza reescribe ~1,900 importaciones en ~480
 * archivos de una vez, sobre un árbol que comparten varias sesiones. Con el
 * alias, mudarlo es cambiar a dónde apunta `@nucleo` y nada más.
 *
 *   - de afuera hacia el núcleo:      `@nucleo/<carpeta>/<archivo>`
 *   - del núcleo hacia la plataforma: `@plataforma/<archivo>` — cada app pone
 *     la suya (la web, `src/plataforma`; el teléfono, sus adaptadores nativos).
 *   - adentro del núcleo: relativa, porque se muda entera y junta.
 *
 *   node scripts/nucleo-alias.mjs            # revisa (falla si hay una cruzada)
 *   node scripts/nucleo-alias.mjs --escribir # las reescribe
 *   node scripts/nucleo-alias.mjs --hook     # igual que revisar, para el pre-commit
 *
 * El núcleo es la lista NUCLEO de abajo. Una importación del núcleo hacia
 * cualquier otra parte del portal (una pantalla, `version.js`) es un error de
 * dirección y también se reporta: la app del teléfono no la tendría.
 */
import { readdirSync, readFileSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

const RAIZ = process.cwd();
const SRC = join(RAIZ, 'src');
export const NUCLEO = ['data', 'utils', 'store', 'hooks', 'constants', 'context', 'types', 'supabaseClient'];
const escribir = process.argv.includes('--escribir');

// El especificador de una importación: estática, dinámica, de efecto, re-export
// y las formas de vitest que reciben una ruta.
const IMPORTACION = /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\bvi\.(?:do)?[mM]ock\(\s*|\bvi\.importActual\(\s*|\bvi\.unmock\(\s*)(['"])(\.{1,2}\/[^'"\n]+)\2/g;

function archivos(dir, fuera = []) {
    for (const n of readdirSync(dir)) {
        if (n === 'node_modules' || n.startsWith('.')) continue;
        const p = join(dir, n);
        const s = statSync(p);
        if (s.isDirectory()) archivos(p, fuera);
        else if (/\.(jsx?|mjs|tsx?)$/.test(n)) fuera.push(p);
    }
    return fuera;
}

/** 'data/x.js' → true si esa ruta (relativa a src) cae dentro del núcleo. */
function esNucleo(rel) {
    const primero = rel.split(sep)[0].replace(/\.(js|ts)$/, '');
    return NUCLEO.includes(primero);
}

function revisar() {
    const lista = [...archivos(SRC), ...(existsSync(join(RAIZ, 'tests')) ? archivos(join(RAIZ, 'tests')) : [])]
        .filter((f) => !f.includes(`${sep}e2e${sep}`));
    const cruzadas = [];
    const alReves = [];
    let cambiados = 0;
    for (const f of lista) {
        const desde = relative(SRC, f);
        const desdeNucleo = !desde.startsWith('..') && esNucleo(desde);
        const texto = readFileSync(f, 'utf8');
        let hubo = false;
        const nuevo = texto.replace(IMPORTACION, (todo, antes, q, spec) => {
            const destino = relative(SRC, resolve(dirname(f), spec));
            if (destino.startsWith('..')) return todo; // fuera de src
            const aNucleo = esNucleo(destino);
            const aPlataforma = destino.split(sep)[0] === 'plataforma';
            const ruta = destino.split(sep).join('/');
            if (!desdeNucleo && aNucleo) {
                cruzadas.push(`${relative(RAIZ, f)}: ${spec}`);
                hubo = true;
                return `${antes}${q}@nucleo/${ruta}${q}`;
            }
            if (desdeNucleo && aPlataforma) {
                cruzadas.push(`${relative(RAIZ, f)}: ${spec}`);
                hubo = true;
                return `${antes}${q}@plataforma/${ruta.replace(/^plataforma\//, '')}${q}`;
            }
            if (desdeNucleo && !aNucleo) alReves.push(`${relative(RAIZ, f)}: ${spec}`);
            return todo;
        });
        if (hubo && escribir) { writeFileSync(f, nuevo); cambiados++; }
    }
    return { cruzadas, alReves, cambiados };
}

const { cruzadas, alReves, cambiados } = revisar();
if (escribir) console.log(`✓ ${cruzadas.length} importación(es) reescritas en ${cambiados} archivo(s).`);
if (alReves.length) {
    console.log(`✗ ${alReves.length} importación(es) del núcleo hacia el resto del portal (la app no las tendría):`);
    for (const l of alReves) console.log(`    ${l}`);
    process.exitCode = 1;
}
if (!escribir && cruzadas.length) {
    console.log(`✗ ${cruzadas.length} importación(es) cruzan el borde del núcleo con ruta relativa. Van por @nucleo/… o @plataforma/…:`);
    for (const l of cruzadas.slice(0, 20)) console.log(`    ${l}`);
    console.log('  Corregirlas solo: node scripts/nucleo-alias.mjs --escribir');
    process.exitCode = 1;
}
if (!process.exitCode && !escribir) console.log('✓ nucleo-alias — ninguna importación cruza el borde del núcleo por ruta relativa.');
