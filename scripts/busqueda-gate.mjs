#!/usr/bin/env node
/**
 * gate:busqueda — ningún buscador nuevo fuera de la regla del portal.
 *
 *   npm run gate:busqueda          (y en el pre-commit cuando el commit toca src/)
 *
 * ── Por qué existe ──────────────────────────────────────────────────────────
 * El 2026-09-25 el usuario reportó que la búsqueda «deja muchas cosas sueltas y
 * muestra resultados incorrectos». La auditoría encontró CINCO mecanismos de
 * búsqueda distintos, con reglas distintas, en unos 100 buscadores: `ilike` de
 * la frase entera que no ignora tildes, `toLowerCase().includes()` escrito a
 * mano, `normSearch` que convertía «2.5» en «25», patrones que exigían el orden
 * de las palabras. Se unificaron en una sola regla con dos gemelos
 * (`src/utils/busqueda.js` y las funciones `busqueda_*` de la base, enfrentados
 * por `npm run busqueda:gemelos`). Plan: docs/PLAN-BUSQUEDA-UNIFICADA-2026-09-25.md.
 *
 * Ninguno de esos defectos daba error: una búsqueda que no encuentra se lee
 * como «no hay». Por eso lo tiene que mirar una máquina.
 *
 * ── Qué cuenta ──────────────────────────────────────────────────────────────
 *   filtro-a-mano     `x.toLowerCase().includes(variable)` — comparar lo escrito
 *                     sin la regla (sin tildes, frase exacta). Se usa `tokenMatch`
 *                     o `smartFilter`. Contra un texto FIJO (`.includes('JEFE')`)
 *                     no es un buscador y no cuenta.
 *   ilike-de-busqueda `.ilike(col, `%${…}%`)` o `col.ilike.${…}` — el texto del
 *                     usuario contra una columna sin normalizar. Se usa la
 *                     función de búsqueda de la base o `patronSinTildes`.
 *   normsearch        `normSearch(…)` fuera de `searchUtils.js`. Es la regla
 *                     VIEJA (borra la puntuación: «2.5» → «25»); mandarle eso a
 *                     la base rompe la búsqueda sin error. La base recibe el
 *                     texto crudo.
 *
 * Bloqueante en CERO. Lo legítimo va en EXCEPCIONES con su motivo y su cuenta.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const RAIZ = process.cwd();
const HOOK = process.argv.includes('--hook');

const DETECTORES = [
    { clave: 'filtro-a-mano',
      re: /\.(?:toLowerCase|toUpperCase|toLocaleLowerCase|toLocaleUpperCase)\(\)\s*\.includes\(\s*(?!['"`])/g },
    { clave: 'ilike-de-busqueda',
      re: /\.ilike\(\s*['"][\w.]+['"]\s*,\s*`[^`]*\$\{|[\w.]+\.ilike\.\$\{/g },
    { clave: 'normsearch',
      re: /\bnormSearch\(/g },
];

/* archivo → { categoría: cuántas se permiten, motivo } */
const EXCEPCIONES = {
    'src/utils/searchUtils.js': {
        normsearch: 2, 'ilike-de-busqueda': 0,
        motivo: 'es donde vive normSearch (el gemelo de norm_search para las columnas *_norm viejas) y likePattern',
    },
    'src/data/inventory.js': {
        'ilike-de-busqueda': 1,
        motivo: 'alternativas por molécula (fetchProductsByPrincipioActivo): la escribe el portal desde el resultado del SRS, no la persona',
    },
    'src/data/requests.js': {
        'ilike-de-busqueda': 1,
        motivo: 'resolver un cargo por un patrón fijo del código (enrutador de aprobadores), no un buscador',
    },
    'src/views/SchedulesView.jsx': {
        normsearch: 1,
        motivo: 'clave de sucursal para cruzar dos listas, no un buscador',
    },
    'src/views/purchases/FacturasCompraView.jsx': {
        normsearch: 2,
        motivo: 'resaltar el fragmento del renglón que coincidió; el filtro es tokenMatch',
    },
};

function archivos(dir) {
    const out = [];
    for (const n of readdirSync(dir)) {
        const p = join(dir, n);
        const st = statSync(p);
        if (st.isDirectory()) out.push(...archivos(p));
        else if (/\.(jsx?|mjs)$/.test(n)) out.push(p);
    }
    return out;
}

/* Los comentarios no cuentan: el gate lee código, no la historia que lo explica. */
function sinComentarios(txt) {
    return txt
        .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
        .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, (m, pre) => pre + ' '.repeat(m.length - pre.length));
}

const hallazgos = [];
const usadas = {};
for (const abs of archivos(join(RAIZ, 'src'))) {
    const rel = relative(RAIZ, abs).split('\\').join('/');
    if (rel === 'src/utils/busqueda.js') continue;
    const txt = sinComentarios(readFileSync(abs, 'utf8'));
    for (const { clave, re } of DETECTORES) {
        const lineas = [];
        for (const m of txt.matchAll(re)) lineas.push(txt.slice(0, m.index).split('\n').length);
        if (!lineas.length) continue;
        const permitidas = EXCEPCIONES[rel]?.[clave] ?? 0;
        (usadas[rel] ||= {})[clave] = lineas.length;
        if (lineas.length > permitidas) {
            hallazgos.push({ rel, clave, lineas, permitidas });
        }
    }
}

// Una excepción que ya no cubre nada es una puerta abierta: se borra.
const sobrantes = [];
for (const [rel, cfg] of Object.entries(EXCEPCIONES)) {
    for (const [clave, n] of Object.entries(cfg)) {
        if (clave === 'motivo' || n === 0) continue;
        const u = usadas[rel]?.[clave] ?? 0;
        if (u < n) sobrantes.push(`${rel} · ${clave}: permite ${n}, hay ${u}`);
    }
}

if (!hallazgos.length && !sobrantes.length) {
    console.log(`  ✓ gate:busqueda — ningún buscador fuera de la regla (${Object.keys(EXCEPCIONES).length} excepciones con motivo).`);
    process.exit(0);
}
for (const h of hallazgos) {
    console.log(`  ✗ ${h.rel}:${h.lineas.join(',')} — ${h.clave} (${h.lineas.length}, se permiten ${h.permitidas})`);
}
for (const s of sobrantes) console.log(`  ✗ excepción sobrante: ${s} — bajarla`);
console.log(`\n  Buscar va por la regla del portal: tokenMatch/smartFilter en memoria,`);
console.log(`  las funciones de búsqueda de la base en el servidor, patronSinTildes para`);
console.log(`  una columna sin normalizar. docs/PLAN-BUSQUEDA-UNIFICADA-2026-09-25.md`);
process.exit(HOOK || hallazgos.length || sobrantes.length ? 1 : 0);
