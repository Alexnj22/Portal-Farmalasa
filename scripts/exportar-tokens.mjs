#!/usr/bin/env node
/**
 * exportar-tokens — los tokens de diseño de `src/index.css` como JSON (F6 del
 * plan del núcleo portable, docs/PLAN-NUCLEO-PORTABLE-2026-09-24.md).
 *
 * ── Por qué existe ───────────────────────────────────────────────────────────
 * La app nativa no lee CSS. Si copia los colores a mano, el día que el portal
 * cambie un tono la app sigue con el viejo y nadie se entera: es la lista
 * escrita a mano que se desincroniza del registro. Por eso el JSON NO se
 * edita: sale de `index.css`, que sigue siendo la única fuente, y
 * `npm run gate:tokens` falla si el JSON quedó distinto de lo que el CSS dice.
 *
 * ── Qué sale ─────────────────────────────────────────────────────────────────
 * `src/constants/tokens.json`:
 *   temas.<liquid|dark|solid|solid-dark>  — TODAS las variables de ese tema,
 *       ya compuestas (base + bloque del tema, en el orden del documento, que
 *       es como las resuelve el navegador) y con los `var()` resueltos.
 *   variantes.<compacto|ultra|tactil|telefono> — sólo lo que cada consulta de
 *       medios pisa, también resuelto. En el teléfono aplica `tactil`: ahí
 *       viven el blanco de dedo (--tap-min 44px) y el relleno de las fichas.
 *
 * Un valor que no se puede resolver fuera de un navegador (`env()`,
 * `color-mix()`, `calc()` con unidades mezcladas) sale TAL CUAL, como texto: la
 * app decide qué hacer con él. Inventarle un número sería peor.
 *
 *   npm run tokens:exportar     # reescribe el JSON
 *   npm run gate:tokens         # falla si el JSON no es el que sale del CSS
 *
 * El gate además falla si un token apunta a una variable que no existe: el
 * navegador lo calla (el valor queda inválido y la propiedad cae a su
 * inicial), y así vivió `--chart-8` sin color desde v2.139.0 hasta que este
 * export lo encontró.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import postcss from 'postcss';

const RAIZ = process.cwd();
const CSS = join(RAIZ, 'src', 'index.css');
const SALIDA = join(RAIZ, 'src', 'constants', 'tokens.json');
const revisar = process.argv.includes('--revisar');

const TEMAS = ['liquid', 'dark', 'solid', 'solid-dark'];

// Cada consulta de medios con variables en `:root`, por su nombre en la app.
// Una consulta NUEVA en index.css que no esté acá hace fallar el export: así
// no se pierde en silencio una variante que la app debería conocer.
const VARIANTES = [
    ['compacto', /max-width:\s*1439\.98px/],
    ['ultra', /max-width:\s*1151\.98px/],
    ['tactil', /^\(pointer:\s*coarse\)$/],
    ['telefono', /^\(max-width:\s*767\.98px\)$/],
];
// Consultas que no describen un tema sino una preferencia de movimiento o un
// selector de componente; no son tokens.
const IGNORAR_MEDIOS = [/prefers-reduced-motion/];

function mediosDe(nodo) {
    const m = [];
    for (let p = nodo.parent; p && p.type !== 'root'; p = p.parent) {
        if (p.type === 'atrule') m.push(`@${p.name} ${p.params}`);
    }
    return m;
}

function temasDelSelector(selector) {
    const partes = selector.split(',').map((s) => s.trim());
    if (partes.every((s) => s === ':root')) return ['*'];
    const temas = [];
    for (const s of partes) {
        const m = s.match(/^\[data-theme="([a-z-]+)"\]$/);
        if (!m) return null; // selector de componente: no es un token de tema
        temas.push(m[1]);
    }
    return temas;
}

function leer() {
    const raiz = postcss.parse(readFileSync(CSS, 'utf8'));
    const capas = { base: [], variantes: Object.fromEntries(VARIANTES.map(([n]) => [n, {}])) };
    const temas = Object.fromEntries(TEMAS.map((t) => [t, {}]));
    const sinClasificar = [];

    raiz.walkRules((regla) => {
        const decls = regla.nodes.filter((d) => d.type === 'decl' && d.prop.startsWith('--'));
        if (!decls.length) return;
        const medios = mediosDe(regla);
        if (medios.some((m) => m.startsWith('@keyframes'))) return;
        if (medios.some((m) => IGNORAR_MEDIOS.some((re) => re.test(m)))) return;
        const aQuien = temasDelSelector(regla.selector);
        if (!aQuien) return;

        if (medios.length) {
            const params = medios.map((m) => m.replace(/^@media\s+/, '')).join(' and ');
            const v = VARIANTES.find(([, re]) => re.test(params.replace(/\s+/g, ' ')));
            if (!v || aQuien[0] !== '*') {
                sinClasificar.push(`${regla.selector} ${medios.join(' | ')} (línea ${regla.source.start.line})`);
                return;
            }
            for (const d of decls) capas.variantes[v[0]][d.prop] = d.value.trim();
            return;
        }
        // Mismo orden que el navegador: todos los bloques tienen la misma
        // especificidad sobre <html>, gana el último del documento.
        for (const d of decls) {
            const destinos = aQuien[0] === '*' ? TEMAS : aQuien.filter((t) => TEMAS.includes(t));
            for (const t of destinos) temas[t][d.prop] = d.value.trim();
        }
    });

    if (sinClasificar.length) {
        throw new Error(`consultas de medios con variables que el export no conoce:\n  ${sinClasificar.join('\n  ')}\n` +
            '  Agregarlas a VARIANTES (o a IGNORAR_MEDIOS con su motivo) en scripts/exportar-tokens.mjs.');
    }
    return { temas, variantes: capas.variantes };
}

// var(--x) y var(--x, respaldo), recursivo y con guarda contra ciclos.
function resolver(valor, tabla, pila = []) {
    return valor.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*((?:[^()]|\([^()]*\))*))?\)/g, (todo, nombre, respaldo) => {
        if (pila.includes(nombre)) return todo;
        if (nombre in tabla) return resolver(tabla[nombre], tabla, [...pila, nombre]);
        if (respaldo !== undefined) return resolver(respaldo.trim(), tabla, pila);
        return todo;
    });
}

function ordenar(obj) {
    return Object.fromEntries(Object.keys(obj).sort().map((k) => [k.replace(/^--/, ''), obj[k]]));
}

function armar() {
    const { temas, variantes } = leer();
    const salida = {
        _comment: 'GENERADO desde src/index.css por scripts/exportar-tokens.mjs — no editar a mano. npm run tokens:exportar',
        temas: {},
        variantes: {},
    };
    for (const t of TEMAS) {
        const tabla = temas[t];
        salida.temas[t] = ordenar(Object.fromEntries(Object.entries(tabla).map(([k, v]) => [k, resolver(v, tabla)])));
    }
    // Una variante pisa sobre el tema base: sus var() se resuelven con la
    // variante encima de liquid (las variantes no dependen del color).
    for (const [n, tabla] of Object.entries(variantes)) {
        const contexto = { ...temas.liquid, ...tabla };
        salida.variantes[n] = ordenar(Object.fromEntries(Object.entries(tabla).map(([k, v]) => [k, resolver(v, contexto)])));
    }
    // Un var() que sobrevive a la resolución nombra un token que NO EXISTE. El
    // navegador no avisa: el valor queda inválido y la propiedad que lo usa cae
    // a su inicial (un fondo transparente, un texto con el color heredado).
    // Así vivió `--chart-8` desde v2.139.0, apuntando a `--content-3`, que sólo
    // existe como `--color-content-3` del puente de Tailwind.
    const huerfanos = [];
    for (const [grupo, tablas] of [['temas', salida.temas], ['variantes', salida.variantes]]) {
        for (const [n, tabla] of Object.entries(tablas)) {
            for (const [k, v] of Object.entries(tabla)) {
                for (const m of v.matchAll(/var\(\s*(--[\w-]+)/g)) huerfanos.push(`${grupo}.${n}: --${k} → ${m[1]}`);
            }
        }
    }
    if (huerfanos.length) {
        throw new Error(`tokens que apuntan a una variable que no existe:\n  ${[...new Set(huerfanos)].join('\n  ')}`);
    }
    return JSON.stringify(salida, null, 1) + '\n';
}

try {
    const nuevo = armar();
    if (revisar) {
        let actual = '';
        try { actual = readFileSync(SALIDA, 'utf8'); } catch { /* no existe */ }
        if (actual !== nuevo) {
            console.log('✗ gate:tokens — src/constants/tokens.json no es el que sale de src/index.css.');
            console.log('  Alguien cambió un token en el CSS (o editó el JSON a mano). Correr `npm run tokens:exportar`.');
            process.exitCode = 1;
        } else {
            const d = JSON.parse(nuevo);
            console.log(`✓ gate:tokens — ${TEMAS.length} temas × ${Object.keys(d.temas.liquid).length} tokens, al día con index.css.`);
        }
    } else {
        writeFileSync(SALIDA, nuevo);
        const d = JSON.parse(nuevo);
        console.log(`✓ ${SALIDA.replace(RAIZ + '/', '')}: ${TEMAS.map((t) => `${t} ${Object.keys(d.temas[t]).length}`).join(' · ')}`);
        console.log(`  variantes: ${Object.entries(d.variantes).map(([n, v]) => `${n} ${Object.keys(v).length}`).join(' · ')}`);
    }
} catch (e) {
    console.log(`✗ No pude exportar los tokens: ${e.message}`);
    process.exitCode = 1;
}
