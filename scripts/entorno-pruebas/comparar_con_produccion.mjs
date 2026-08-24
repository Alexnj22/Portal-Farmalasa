#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// ¿Sigue siendo el branch de pruebas una copia de producción?
// ─────────────────────────────────────────────────────────────────────────────
//
//   node scripts/entorno-pruebas/comparar_con_produccion.mjs
//
// ── Por qué existe ──────────────────────────────────────────────────────────
// CLAUDE.md decía —y hasta el 2026-08-24 nadie lo había vuelto a mirar— que el
// esquema del branch era «idéntico al de prod, verificado por huella md5 de
// tablas, funciones, policies e índices». Se verificó UNA vez, en julio.
//
// Medido el 2026-08-24:
//
//     migraciones   413 contra 543   → 130 de atraso
//     tablas        172 contra 181
//     funciones     497 contra 554
//
// O sea que el barrido móvil de las 54 rutas —el instrumento que decide el eje
// `movil` de las 25 áreas— venía midiendo un portal de hace un mes. Y no fallaba
// con un error claro: fallaba en pedazos. `/inventario` mostraba «Error al
// cargar inventario» porque una vista materializada del branch nunca se pobló, y
// el tema del teléfono pedía una columna que en el branch no existe todavía.
//
// Ninguna de esas dos cosas está mal en el portal. Las dos se leían como si lo
// estuvieran.
//
// ── Qué NO hace ─────────────────────────────────────────────────────────────
// No arregla nada. Rehacer o rebasear el branch borra los datos sembrados y la
// corrida de fechas, así que esa decisión es de quien esté trabajando — no de un
// script que corre solo.
import { execSync } from 'node:child_process';

const PROD = 'sacecdkdmsdvgqnrsett';
const PRUEBAS = 'qvctarsqvlhbzgvwbbbt';

const CONSULTA = `select
  (select count(*) from supabase_migrations.schema_migrations) as migraciones,
  (select max(version) from supabase_migrations.schema_migrations) as ultima,
  (select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE') as tablas,
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public') as funciones,
  (select count(*) from information_schema.columns where table_schema='public') as columnas`;

console.log(`
  Compará los dos entornos con el MCP de Supabase y pegá los números:

    execute_sql  project_id=${PROD}      (producción)
    execute_sql  project_id=${PRUEBAS}   (pruebas)

  con esta consulta:

${CONSULTA.split('\n').map(l => '    ' + l).join('\n')}

  Si «migraciones» difiere, el branch está atrasado y CUALQUIER medición hecha
  contra él —el barrido móvil incluido— habla de un portal que ya no existe.
  Para ponerlo al día se lo rehace (pierde los datos sembrados y la corrida de
  fechas), y eso lo decide quien esté trabajando.
`);

// El único chequeo que sí se puede hacer sin red: que el repo y prod coincidan,
// que es lo que ya vigila `gate:migrations`. Se encadena acá para que quien corra
// esto vea las dos mitades juntas.
try {
    execSync('npm run gate:migrations --silent -- --remote', { stdio: 'inherit' });
} catch {
    console.log('  (el cruce contra prod no se pudo hacer)');
}
