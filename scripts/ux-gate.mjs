#!/usr/bin/env node
// gate:ux — el ratchet del barrido de ESCRITORIO.
//
// Hermano de `design-gate.mjs` y `mobile-gate.mjs`, con la misma forma: una
// categoría por regla, un baseline, y ninguna categoría puede subir.
//
// ── En qué se diferencia de los otros dos ────────────────────────────────────
// Aquéllos leen el FUENTE y corren en cada commit. Éste lee el informe de un
// barrido que hay que correr con el navegador, así que **no puede ir en
// pre-commit**: si no hay informe, no falla — avisa que no lo hay. Un gate que
// exige una corrida de 20 minutos antes de cada commit se desactiva a la
// semana, y un gate desactivado es peor que ninguno.
//
// Su lugar es el trabajo nocturno, junto al barrido móvil.
//
//   npm run gate:ux                      lee test-results/barrido-escritorio/informe.json
//   npm run gate:ux -- --update-baseline SÓLO al bajar deuda
//
// El informe lo escribe `tests/e2e/barrido-escritorio.spec.js`.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const INFORME  = join(RAIZ, 'test-results/barrido-escritorio/informe.json');
const BASELINE = join(RAIZ, 'scripts/ux-gate-baseline.json');

// Una vista larga no es un defecto por sí misma —una lista scrollea, y está
// bien— pero pasado cierto punto deja de ser una lista y es una vista que no
// decidió qué mostrar primero. El corte sale de lo medido, no de un número
// redondo: Inicio pedía 7 pantallas para su primera lectura y ahí el problema
// era real.
const TOPE_PANTALLAS = Number(process.env.TOPE_PANTALLAS || 7);

if (!existsSync(INFORME)) {
    console.log('\n  Sin informe de barrido de escritorio.');
    console.log(`  Correr:  npx playwright test tests/e2e/barrido-escritorio.spec.js --project=chromium\n`);
    process.exit(0);
}

const informe = JSON.parse(readFileSync(INFORME, 'utf8'));
const anchos = informe.anchos || [];

const porCategoria = {
    'columna-fuera-del-marco': 0,
    'carril-recortado': 0,
    'texto-cortado': 0,
    'error-js': 0,
    'vista-larga': 0,
};
const porRuta = {};

for (const [ruta, datos] of Object.entries(informe.rutas || {})) {
    const n = { cols: 0, car: 0, txt: 0, err: 0, larga: 0 };
    for (const a of anchos) {
        const d = datos[a];
        if (!d || d.murio) continue;
        n.cols += d.columnasFuera?.length || 0;
        n.car  += d.carrilesRecortados?.length || 0;
        n.txt  += d.textosCortados?.length || 0;
        n.err  += d.erroresJs?.length || 0;
    }
    if ((datos.movil?.pantallas ?? 0) >= TOPE_PANTALLAS) n.larga = 1;

    porCategoria['columna-fuera-del-marco'] += n.cols;
    porCategoria['carril-recortado']        += n.car;
    porCategoria['texto-cortado']           += n.txt;
    porCategoria['error-js']                += n.err;
    porCategoria['vista-larga']             += n.larga;
    if (n.cols || n.car || n.txt || n.err || n.larga) porRuta[ruta] = { ...n, pantallas: datos.movil?.pantallas };
}

if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ porCategoria, porRuta }, null, 2));
    process.exit(0);
}

if (process.argv.includes('--update-baseline')) {
    writeFileSync(BASELINE, JSON.stringify({
        _comment: 'Ratchet de gate:ux (barrido de escritorio). Falla si una categoría SUBE. Regenerar SOLO al bajar deuda. Nunca para tapar un hallazgo nuevo: si subió, es código nuevo que hay que arreglar.',
        updated: new Date().toISOString().slice(0, 10),
        medido: informe.fecha,
        anchos,
        categories: porCategoria,
    }, null, 2) + '\n');
    console.log(`✓ Baseline actualizado en scripts/ux-gate-baseline.json`);
    process.exit(0);
}

let baseline = {};
try { baseline = JSON.parse(readFileSync(BASELINE, 'utf8')).categories || {}; } catch { /* sin baseline: todo es deuda nueva */ }

const categorias = [...new Set([...Object.keys(porCategoria), ...Object.keys(baseline)])].sort();
const subieron = categorias.filter(c => (porCategoria[c] || 0) > (baseline[c] ?? 0));

if (Object.keys(porRuta).length) {
    console.log('\n── Por vista ' + '─'.repeat(46));
    console.log('  ruta                  columna  carril  texto  errJS  pantallas');
    for (const [r, n] of Object.entries(porRuta).sort((a, b) => (b[1].cols - a[1].cols) || ((b[1].pantallas || 0) - (a[1].pantallas || 0)))) {
        console.log(`  ${r.padEnd(22)}${String(n.cols).padStart(7)}${String(n.car).padStart(8)}${String(n.txt).padStart(7)}${String(n.err).padStart(7)}${String(n.pantallas ?? '—').padStart(11)}`);
    }
}

console.log('\n── Estado por categoría ' + '─'.repeat(34));
for (const c of categorias) {
    const ahora = porCategoria[c] || 0;
    const tope = baseline[c] ?? 0;
    const marca = ahora > tope ? '✗' : ahora < tope ? '↓' : ahora === 0 ? '✓' : '·';
    const nota = ahora > tope ? `SUBIÓ +${ahora - tope}`
        : ahora < tope ? `bajó -${tope - ahora} (correr --update-baseline)` : '';
    console.log(`  ${marca} ${c.padEnd(26)} ${String(ahora).padStart(4)} / ${String(tope).padEnd(4)} ${nota}`);
}
console.log(`\n  medido: ${informe.fecha?.slice(0, 16) ?? '?'} · anchos: ${anchos.join(', ')} · tope de pantallas: ${TOPE_PANTALLAS}`);

if (subieron.length) {
    console.log(`\n✗ ${subieron.length} categoría(s) con deuda nueva: ${subieron.join(', ')}\n`);
    process.exit(1);
}
console.log(`\n✓ Sin deuda nueva.\n`);
