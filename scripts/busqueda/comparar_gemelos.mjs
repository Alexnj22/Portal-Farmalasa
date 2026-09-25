#!/usr/bin/env node
/**
 * Enfrenta los dos gemelos de la regla de búsqueda: `src/utils/busqueda.js`
 * (navegador) y las funciones `busqueda_*` / `norm_busqueda` de la base.
 * Plan: docs/PLAN-BUSQUEDA-UNIFICADA-2026-09-25.md.
 *
 *   npm run busqueda:gemelos
 *
 * Tres pruebas, las tres contra producción y de sólo lectura:
 *   1. Los casos de `tests/casos-busqueda.json` corridos en SQL.
 *   2. La normalización de TODOS los nombres reales (productos, clientes,
 *      proveedores): JS y SQL tienen que dar el mismo texto. Las columnas
 *      `*_busq` las escribe SQL y el navegador compara con JS: si difieren, una
 *      misma búsqueda encuentra distinto según dónde se filtre.
 *   3. Una batería de búsquedas contra el catálogo: `buscar_productos_ids`
 *      tiene que devolver los mismos productos, en el mismo orden, que
 *      `filtrar` de JS sobre la misma lista.
 *
 * Cambiar un gemelo exige cambiar el otro y volver a correr esto: tiene que dar
 * 0 diferencias. Medido al nacer (2026-09-25): 33,808 nombres, 0 distintos.
 */
import { readFileSync } from 'node:fs';
import { abrirCanal } from '../lib/canal-supabase.mjs';
import { normalizar, compactar, filtrar } from '../../src/utils/busqueda.js';

const casos = JSON.parse(readFileSync('tests/casos-busqueda.json', 'utf8'));
const L = (s) => `'${String(s).replace(/'/g, "''")}'`;
const { consultar, cerrar } = abrirCanal('busqueda-gemelos');
let fallas = 0;

try {
    // ── 1. Los casos en SQL ────────────────────────────────────────────────
    const j = JSON.stringify({
        n: casos.normalizar.map(x => [x.entrada, x.salida]),
        c: casos.coincide.filter(x => x.consulta.trim()).map(x => [x.consulta, x.texto, x.esperado]),
        a: casos.aproximada.map(x => [x.consulta, x.texto, x.esperado]),
    });
    const ev = (q, t) => `public.busqueda_puntaje(public.busqueda_palabras(${q}), ARRAY[public.norm_busqueda(${t})], ARRAY[public.compactar_busqueda(${t})])`;
    const pa = (q, t) => `public.busqueda_parecido(public.busqueda_palabras(${q}), ARRAY[public.norm_busqueda(${t})], ARRAY[public.compactar_busqueda(${t})])`;
    const malos = consultar(`WITH j AS (SELECT ${L(j)}::jsonb j)
        SELECT 'normalizar' k, e->>0 caso FROM j, jsonb_array_elements(j->'n') e WHERE public.norm_busqueda(e->>0) <> e->>1
        UNION ALL SELECT 'coincide', (e->>0)||' / '||(e->>1) FROM j, jsonb_array_elements(j->'c') e WHERE (${ev('e->>0', 'e->>1')} > 0) <> (e->>2)::boolean
        UNION ALL SELECT 'prefiltro', (e->>0)||' / '||(e->>1) FROM j, jsonb_array_elements(j->'c') e
            WHERE (e->>2)::boolean AND NOT ((public.norm_busqueda(e->>1)||' '||public.compactar_busqueda(e->>1)) ~ ALL (public.busqueda_prefiltro(public.busqueda_palabras(e->>0))))
        UNION ALL SELECT 'aproximada', (e->>0)||' / '||(e->>1) FROM j, jsonb_array_elements(j->'a') e WHERE (${pa('e->>0', 'e->>1')} >= 0.75) <> (e->>2)::boolean`);
    console.log(`1 · casos en SQL: ${malos.length} distinto(s)`);
    for (const m of malos) console.log(`    ✗ ${m.k}: ${m.caso}`);
    fallas += malos.length;

    // ── 2. La normalización de los nombres reales ──────────────────────────
    const nombres = consultar(`
        SELECT nombre n, public.norm_busqueda(nombre) sn, public.compactar_busqueda(nombre) sc FROM products
        UNION ALL SELECT name, public.norm_busqueda(name), public.compactar_busqueda(name) FROM customers
        UNION ALL SELECT nombre, public.norm_busqueda(nombre), public.compactar_busqueda(nombre) FROM proveedores_maestro`);
    const difieren = nombres.filter(r => normalizar(r.n) !== r.sn || compactar(r.n) !== r.sc);
    console.log(`2 · nombres reales: ${nombres.length}, distintos ${difieren.length}`);
    for (const r of difieren.slice(0, 10)) {
        console.log(`    ✗ ${JSON.stringify(r.n)}\n        js  ${normalizar(r.n)} | ${compactar(r.n)}\n        sql ${r.sn} | ${r.sc}`);
    }
    fallas += difieren.length;

    // ── 3. La búsqueda de producto, entera ─────────────────────────────────
    const BATERIA = ['sal', 'gel', 'mk', '5', '25', '500', '500mg', '500 mg', 'acetaminofen 500',
        '90 alcohol', 'losartan 100', 'ibuprofeno 400', 'amoxisilina', 'omeprasol', 'dicloefnac',
        'acetaminofem', 'vit c', 'b12', 'complejo b', 'jeringa 5ml', 'cotrimoxazol', 'ssn',
        'neurobion 25000', '74186', 'paracetamol', 'tab'];
    const productos = consultar(`SELECT id, nombre, coalesce(codigo_barras, '') cb FROM products WHERE activo ORDER BY nombre`);
    const respuestas = consultar(`SELECT q, public.buscar_productos_ids(q, 60) r FROM unnest(ARRAY[${BATERIA.map(L).join(',')}]) q`);
    let distintas = 0;
    for (const { q, r } of respuestas) {
        const sql = typeof r === 'string' ? JSON.parse(r) : r;
        const js = filtrar(q, productos, p => [p.nombre, p.cb], { orden: 'relevancia' });
        const a = js.resultados.slice(0, 60).map(p => Number(p.id)).join(',');
        const b = (sql.ids ?? []).map(Number).join(',');
        if (a !== b || js.aproximado !== !!sql.aproximado) {
            distintas++;
            console.log(`    ✗ «${q}»: js ${js.resultados.length}${js.aproximado ? '~' : ''} · sql ${(sql.ids ?? []).length}${sql.aproximado ? '~' : ''}`);
        }
    }
    console.log(`3 · búsquedas de producto: ${BATERIA.length}, distintas ${distintas}`);
    fallas += distintas;
} finally {
    cerrar();
}

console.log(fallas ? `\n✗ los gemelos difieren en ${fallas} punto(s)` : '\n✓ los gemelos dan lo mismo');
process.exit(fallas ? 1 : 0);
