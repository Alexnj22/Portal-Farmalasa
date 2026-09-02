#!/usr/bin/env node
/**
 * Enfrenta los DOS gemelos que calculan la diferencia de un corte de caja.
 *
 *   JavaScript  `diferenciaDelCorte`      (src/utils/cortesDiagnostico.js)
 *   SQL         `corte_diferencia(...)`   (producción)
 *
 * ── Por qué existe ─────────────────────────────────────────────────────────
 * El de JavaScript decide lo que se VE; el de SQL decide cuánto se le COBRA a
 * alguien (`resolver_diferencia_corte` → `corte_tramo` → `corte_diferencia`).
 * Que digan lo mismo no es un detalle de estilo: el 2026-09-02 el SQL estaba
 * dos arreglos atrás y en dos cortes confirmados de ese día la pantalla decía
 * $0.00 mientras la base creía que sobraban $88.25 y $25.35.
 *
 * Es el mismo patrón que `turno_del_dia` y que `comparar_matcher.mjs`: dos
 * implementaciones de la misma regla sólo son confiables si alguien las
 * enfrenta sobre los datos reales. **Cambiar cualquiera de los dos lados exige
 * volver a correr esto.**
 *
 * ── Cómo ───────────────────────────────────────────────────────────────────
 *     npx vite-node scripts/comparar-diferencia-de-corte.mjs
 *
 * `vite-node` y no `node` a secas: el módulo de JavaScript importa sin
 * extensión, que es lo que resuelve Vite y no Node.
 *
 * Lee producción con el CLI de Supabase. Es de SÓLO LECTURA.
 *
 * ── El único que queda fuera, y por qué ────────────────────────────────────
 * El corte SIN CONTEO (`noContoEfectivo`). En JavaScript devuelve `null` —«no
 * se contó» no es «cuadró»— y en SQL lo ataja `corte_tramo` con un error antes
 * de llamar a la función, así que no hay dos números que comparar. Se cuenta
 * aparte para que el total no mienta por omisión.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { diferenciaDelCorte, noContoEfectivo } from '../src/utils/cortesDiagnostico.js';

const COLUMNAS = 'id, total_declarado, diferencia_erp, tk_subtotal, tk_vales,'
    + ' tk_cobros_credito, tk_total_caja, cobros_portal_efectivo';

/* El CLI lee el `.env` del WORKDIR, y el del repo tiene un nombre de variable
 * con guión que lo hace abortar. Un directorio vacío con un enlace a
 * `supabase/` evita mover el `.env` de su lugar — que le rompe el build a otra
 * sesión. Ver la memoria `reference_edge_function_deploy_workaround`. */
function consultar(sql) {
    const dir = mkdtempSync(join(tmpdir(), 'cortes-'));
    execFileSync('ln', ['-sfn', join(process.cwd(), 'supabase'), join(dir, 'supabase')]);
    const salida = execFileSync('supabase',
        ['db', 'query', '--linked', '--workdir', dir, '-o', 'json', sql],
        { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
    return JSON.parse(salida).rows;
}

const datos = consultar(`select ${COLUMNAS}, tipo, estado from public.cortes_caja where tipo='C' order by id`);
const sql = new Map(consultar(
    'select id, public.corte_diferencia(total_declarado, diferencia_erp, tk_total_caja,'
    + ' tk_subtotal, tk_vales, tk_cobros_credito, cobros_portal_efectivo) as dif'
    + " from public.cortes_caja where tipo='C' order by id",
).map((r) => [r.id, Number(r.dif)]));

let iguales = 0;
let sinConteo = 0;
const distintas = [];
for (const c of datos) {
    if (noContoEfectivo(c)) { sinConteo++; continue; }
    const js = diferenciaDelCorte(c).valor;
    const s = sql.get(c.id);
    if (Math.abs(js - s) < 0.005) iguales++;
    else distintas.push({ id: c.id, js, sql: s, se_apartan: Math.round((js - s) * 100) / 100 });
}

console.log('');
console.log(`  comparados: ${iguales + distintas.length}   ·   sin conteo (fuera): ${sinConteo}`);
console.log(`  iguales:    ${iguales}`);
console.log(`  distintas:  ${distintas.length}`);
console.log('');
if (distintas.length) {
    console.table(distintas.slice(0, 30));
    console.log('  ✗ Los dos gemelos no dicen lo mismo. El de SQL es el que cobra.');
    process.exit(1);
}
console.log('  ✓ Los dos gemelos dicen lo mismo sobre todos los cortes capturados.');
