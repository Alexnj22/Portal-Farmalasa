#!/usr/bin/env node
/**
 * gate:tipos — la base como CONTRATO del núcleo (F5 del plan del núcleo
 * portable, docs/PLAN-NUCLEO-PORTABLE-2026-09-24.md).
 *
 * ── Por qué existe ───────────────────────────────────────────────────────────
 * El plan lo pedía así: «si una columna cambia, el teléfono no compila en vez de
 * mostrar un cero». Hasta hoy una tabla, una columna o un parámetro de función
 * mal escrito no daba error en ningún lado: la consulta devolvía cero filas, o
 * `null`, y la pantalla lo mostraba como un dato. El día que se escribió esto
 * cazó uno así: la entrada de bitácora de CREAR_COTIZACION leía
 * `cliente_nombre`, que no existe (es `customer_name`), y el cliente salía
 * vacío desde siempre.
 *
 * ── Cómo ─────────────────────────────────────────────────────────────────────
 * `src/types/database.ts` son los tipos de producción (`npm run tipos:base`) y
 * `supabaseClient.js` declara el cliente con ellos. `tsc -p tsconfig.nucleo.json`
 * revisa el núcleo (src/data, utils, store, hooks, constants) con `checkJs` y
 * sin emitir nada. Medido al fabricar las regresiones: una columna mal escrita
 * en un `.eq()` suma un aviso en esa línea, y un parámetro mal escrito en un
 * `.rpc()` lo nombra («Did you mean 'p_q'?»).
 *
 * El núcleo es JavaScript sin tipos y la revisión arranca con miles de avisos de
 * forma (un objeto por defecto `{}`, un JSON sin forma). Por eso el gate es un
 * TRINQUETE, como los demás: cuenta por archivo contra
 * `scripts/tipos-baseline.json` y falla si un archivo SUBE o aparece uno nuevo
 * con avisos. Así lo que ya está bien no puede empeorar, y lo nuevo nace
 * revisado. El baseline sólo baja (`--fijar` después de una mejora).
 *
 * `--remoto` además regenera los tipos de producción y los compara con los del
 * repo: si difieren, alguien cambió la base y los tipos quedaron viejos.
 *
 *   npm run gate:tipos
 *   npm run gate:tipos -- --fijar     # baja el baseline tras una mejora
 *   npm run gate:tipos -- --remoto    # también compara con producción
 *
 * No va en el pre-commit: tarda ~20 s. Se corre al cerrar trabajo que toque el
 * núcleo o la base.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const RAIZ = process.cwd();
const BASELINE = join(RAIZ, 'scripts', 'tipos-baseline.json');
const NUCLEO = ['src/data/', 'src/utils/', 'src/store/', 'src/hooks/', 'src/constants/', 'src/supabaseClient.js'];
const fijar = process.argv.includes('--fijar');
const remoto = process.argv.includes('--remoto');

function contar() {
    const r = spawnSync('npx', ['tsc', '-p', 'tsconfig.nucleo.json'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    const salida = (r.stdout || '') + (r.stderr || '');
    if (!/error TS\d+/.test(salida) && r.status !== 0) {
        throw new Error(`tsc no pudo revisar: ${salida.split('\n').slice(0, 5).join(' ')}`);
    }
    const porArchivo = {};
    const lineas = {};
    for (const l of salida.split('\n')) {
        const m = l.match(/^(src\/[^(]+)\((\d+),\d+\): error (TS\d+): (.*)$/);
        if (!m || !NUCLEO.some((p) => m[1].startsWith(p))) continue;
        porArchivo[m[1]] = (porArchivo[m[1]] || 0) + 1;
        (lineas[m[1]] ||= []).push(`${m[2]}: ${m[3]} ${m[4].slice(0, 140)}`);
    }
    return { porArchivo, lineas };
}

function compararConProduccion() {
    const dir = mkdtempSync(join(tmpdir(), 'tipos-'));
    const nuevo = execFileSync('supabase',
        ['gen', 'types', 'typescript', '--project-id', 'sacecdkdmsdvgqnrsett', '--schema', 'public'],
        { cwd: dir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
    const actual = readFileSync(join(RAIZ, 'src/types/database.ts'), 'utf8');
    return nuevo.trim() === actual.trim();
}

function main() {
    const { porArchivo, lineas } = contar();
    const total = Object.values(porArchivo).reduce((s, n) => s + n, 0);

    if (fijar) {
        const previo = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')).archivos : null;
        if (previo) {
            const suben = Object.entries(porArchivo).filter(([f, n]) => n > (previo[f] ?? 0));
            if (suben.length) {
                console.log('✗ --fijar sólo BAJA el baseline. Suben:');
                for (const [f, n] of suben) console.log(`    ${f}: ${previo[f] ?? 0} → ${n}`);
                process.exitCode = 1;
                return;
            }
        }
        const ordenado = Object.fromEntries(Object.entries(porArchivo).sort(([a], [b]) => a.localeCompare(b)));
        writeFileSync(BASELINE, JSON.stringify({
            _comment: 'Avisos de tsc por archivo del núcleo (gate:tipos). Sólo BAJA: npm run gate:tipos -- --fijar tras una mejora.',
            actualizado: new Date().toISOString().slice(0, 10),
            total,
            archivos: ordenado,
        }, null, 1) + '\n');
        console.log(`✓ baseline fijado: ${total} aviso(s) en ${Object.keys(ordenado).length} archivo(s).`);
        return;
    }

    const base = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')).archivos : {};
    const suben = [];
    const bajan = [];
    for (const f of new Set([...Object.keys(base), ...Object.keys(porArchivo)])) {
        const antes = base[f] ?? 0;
        const ahora = porArchivo[f] ?? 0;
        if (ahora > antes) suben.push([f, antes, ahora]);
        else if (ahora < antes) bajan.push([f, antes, ahora]);
    }

    console.log(`  núcleo: ${total} aviso(s) de tipos (baseline ${Object.values(base).reduce((s, n) => s + n, 0)})`);
    if (bajan.length) console.log(`  ↓ ${bajan.length} archivo(s) bajaron — fijarlo con --fijar`);

    if (remoto) {
        const igual = compararConProduccion();
        console.log(`  contra producción: ${igual ? 'los tipos están al día' : 'los tipos quedaron VIEJOS'}`);
        if (!igual) {
            console.log('    La base cambió y src/types/database.ts no. Correr `npm run tipos:base` y volver a este gate.');
            process.exitCode = 1;
        }
    }

    if (suben.length) {
        console.log(`\n✗ ${suben.length} archivo(s) con avisos de tipos NUEVOS:`);
        for (const [f, antes, ahora] of suben) {
            console.log(`  • ${f}: ${antes} → ${ahora}`);
            // Primero los de CONTRATO (parámetro, columna o tabla que no existe):
            // son los que el gate existe para cazar. Después, los de forma.
            const CONTRATO = /TS(2561|2353|2345|2769|2589)/;
            const orden = [...(lineas[f] || [])].sort((x, y) => CONTRATO.test(y) - CONTRATO.test(x));
            for (const l of orden.slice(0, 6)) console.log(`      ${l}`);
        }
        console.log('\n  Una tabla, columna o parámetro que no existe en la base aparece acá. Si es un');
        console.log('  aviso de forma y no de contrato, corregirlo igual: el baseline no se sube.');
        process.exitCode = 1;
        return;
    }
    if (!process.exitCode) console.log('\n✓ gate:tipos — ningún archivo del núcleo empeoró.');
}

try { main(); } catch (e) {
    console.log(`\n✗ No pude revisar los tipos: ${String(e.message).split('\n')[0]}`);
    process.exitCode = 1;
}
