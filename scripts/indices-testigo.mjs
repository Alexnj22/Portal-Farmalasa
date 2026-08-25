#!/usr/bin/env node
/**
 * El testigo de uso de índices — la ventana que le faltaba al hallazgo.
 *
 * ── Por qué existe ─────────────────────────────────────────────────────────
 * La auditoría del 2026-08-23 marcó **10 índices «que nunca se usaron»**, ~8 MB,
 * y proponía borrarlos. Al medirlo el 2026-08-24 resultó que la etiqueta afirma
 * tres cosas y dos no se sostienen:
 *
 *   · `pg_stat_user_indexes.idx_scan` **empieza a contar en el último arranque**
 *     del servidor, no cuando se creó el índice. Ese día llevaba 4 días y 1 hora,
 *     así que el dato real era «sin lecturas en cuatro días»;
 *   · el índice **sí se usa** cuando la consulta llega: un `EXPLAIN (COSTS OFF)`
 *     sobre `inventory_grouped_mv WHERE descripcion_norm ILIKE '%amoxi%'` entra
 *     por `idx_igmv_desc_norm_trgm`;
 *   · y el contador funciona: se leyó en 0, se hizo UNA búsqueda real, volvió a
 *     leerse en 1.
 *
 * O sea que el cero no dice «este índice no acelera nada»: dice **«en esta
 * ventana nadie ejecutó esa consulta»**, que es un dato sobre el USO del portal.
 * Y la acción que la etiqueta insinuaba habría hecho daño — borrar el trigram
 * deja al buscador de inventario haciendo un barrido completo la próxima vez que
 * alguien lo abra.
 *
 * El hallazgo quedó entonces sin poder juzgarse, que es peor que estar abierto:
 * se hereda de sesión en sesión sin que nadie pueda cerrarlo. **Esto es lo que
 * le faltaba: un testigo con fecha.**
 *
 * ── Cómo se usa ────────────────────────────────────────────────────────────
 *   node scripts/indices-testigo.mjs            compara contra el testigo guardado
 *   node scripts/indices-testigo.mjs --marcar   guarda el testigo de hoy
 *
 * Se marca UNA vez y se vuelve semanas después. Si un índice sigue en cero
 * después de un mes de uso real **y el servidor no reinició en el medio**, ahí
 * sí la pregunta «¿lo borramos?» tiene respuesta. Antes, no.
 *
 * ── El reinicio invalida la comparación, y hay que detectarlo ──────────────
 * `idx_scan` se reinicia con el servidor. Si `pg_postmaster_start_time()` cambió
 * entre el testigo y hoy, los contadores no son comparables: el delta podría ser
 * negativo o, peor, positivo pero incompleto. Por eso el testigo guarda esa
 * marca y este script se niega a concluir cuando no coincide — es la misma
 * lección que `gate:eficiencia` aprendió midiendo escrituras.
 *
 * Sólo LEE. No toca producción.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { abrirCanal } from './lib/canal-supabase.mjs';

const TESTIGO = 'scripts/indices-testigo.json';
const MARCAR = process.argv.includes('--marcar');

// Los diez que la auditoría marcó. La lista se deja EXPLÍCITA y no se calcula
// con `idx_scan = 0`: lo que hay que seguir es si ESTOS diez cambian, no
// descubrir diez nuevos cada vez que corre.
const VIGILADOS = [
    'idx_igmv_desc_trgm', 'idx_igmv_desc_norm_trgm', 'idx_conteo_items_source_sync_key',
    'idx_mv_stock_analysis_sucursal', 'idx_customers_erp_id', 'idx_products_pa_trgm',
    'idx_products_pactivo_norm_trgm', 'idx_product_precios_history_pres',
    'idx_psr_sucursal_producto', 'idx_changelog_branch_detected',
];

const SQL = `
SELECT json_build_object(
  'arranque', (SELECT pg_postmaster_start_time()),
  'medido_en', now(),
  'indices', (
    SELECT coalesce(json_agg(json_build_object(
             'indice', s.indexrelname, 'tabla', s.relname,
             'lecturas', s.idx_scan, 'bytes', pg_relation_size(s.indexrelid))
           ORDER BY s.indexrelname), '[]'::json)
    FROM pg_stat_user_indexes s
    WHERE s.indexrelname = ANY(ARRAY['${VIGILADOS.join("','")}'])
  )
) AS r;`.trim();

/* El canal es el mismo que usan `gate:perf` y `gate:eficiencia`
 * (`scripts/lib/canal-supabase.mjs`): el CLI lee el `.env` del directorio de
 * trabajo y aborta con los nombres de variable que tienen `-`, que es el caso de
 * este repo, así que se le da un directorio propio con lo mínimo. No se
 * reimplementa acá — dos copias del manejo del ruido del CLI se separan solas. */
function consultar() {
    const canal = abrirCanal('indices-testigo');
    try {
        const filas = canal.consultar(SQL);
        return filas[0]?.r ?? filas[0];
    } finally {
        canal.cerrar();
    }
}

const gris = (t) => `\x1b[90m${t}\x1b[0m`;
const verde = (t) => `\x1b[32m${t}\x1b[0m`;
const amarillo = (t) => `\x1b[33m${t}\x1b[0m`;

let hoy;
try {
    hoy = consultar();
} catch (e) {
    console.error('\n  No se pudo consultar producción:', e?.message?.split('\n')[0] || e);
    console.error(gris('  (necesita `supabase` enlazado — es sólo lectura)\n'));
    process.exit(2);
}

const dias = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

if (MARCAR) {
    writeFileSync(TESTIGO, JSON.stringify(hoy, null, 2) + '\n');
    console.log(`\n  ✓ Testigo guardado en ${TESTIGO}`);
    console.log(gris(`    servidor arrancado el ${hoy.arranque}`));
    console.log(gris('    volvé en unas semanas y corré el script sin --marcar.\n'));
    process.exit(0);
}

if (!existsSync(TESTIGO)) {
    console.log('\n  No hay testigo todavía. Para empezar a medir:');
    console.log('    node scripts/indices-testigo.mjs --marcar\n');
    process.exit(0);
}

const antes = JSON.parse(readFileSync(TESTIGO, 'utf8'));
const ventana = dias(antes.medido_en, hoy.medido_en);

console.log(`\n  Testigo de índices — ventana de ${ventana} día(s)`);
console.log(gris(`  desde ${antes.medido_en.slice(0, 16)} hasta ${hoy.medido_en.slice(0, 16)}\n`));

// El reinicio del servidor pone los contadores en cero: comparar contra un
// testigo anterior a él daría un delta inventado.
if (antes.arranque !== hoy.arranque) {
    console.log(amarillo('  ⚠ El servidor reinició entre las dos lecturas, así que los contadores'));
    console.log(amarillo('    no son comparables: `idx_scan` volvió a empezar de cero.'));
    console.log(gris(`      antes: ${antes.arranque}`));
    console.log(gris(`      ahora: ${hoy.arranque}`));
    console.log('\n  Volvé a marcar el testigo y esperá otra ventana:');
    console.log('    node scripts/indices-testigo.mjs --marcar\n');
    process.exit(0);
}

const previo = new Map(antes.indices.map((i) => [i.indice, i.lecturas]));
const usados = [], quietos = [];
for (const i of hoy.indices) {
    const delta = i.lecturas - (previo.get(i.indice) ?? 0);
    (delta > 0 ? usados : quietos).push({ ...i, delta });
}

for (const i of usados)
    console.log(`  ${verde('usado')}   ${i.indice.padEnd(34)} ${String(i.delta).padStart(8)} lecturas en la ventana`);
for (const i of quietos)
    console.log(`  ${gris('quieto')}  ${gris(i.indice.padEnd(34))} ${gris('sin una sola lectura')}  ${gris(`${Math.round(i.bytes / 1024)} kB`)}`);

const kb = quietos.reduce((n, i) => n + i.bytes, 0) / 1024;
console.log('');
if (!quietos.length) {
    console.log(verde(`  ✓ Los ${hoy.indices.length} se usaron. El hallazgo del 23-ago queda cerrado.\n`));
} else if (ventana < 30) {
    console.log(gris(`  ${quietos.length} sin lecturas, ${Math.round(kb)} kB — pero la ventana es de ${ventana} día(s).`));
    console.log(gris('  Hacen falta ~30 para que un cero signifique algo: un índice de cierre'));
    console.log(gris('  mensual puede pasar tres semanas quieto y ser imprescindible.\n'));
} else {
    console.log(`  ${quietos.length} sin una sola lectura en ${ventana} días (${Math.round(kb)} kB).`);
    console.log(gris('  Ahora sí la pregunta tiene respuesta. Antes de borrar ninguno, comprobar'));
    console.log(gris('  con `EXPLAIN (COSTS OFF)` que su consulta no exista, y no sólo que nadie'));
    console.log(gris('  la haya corrido: si el planificador entra por él, el cero es de uso.\n'));
}
