#!/usr/bin/env node
/**
 * Gate de deriva de migraciones: que `supabase/migrations/` siga describiendo prod.
 *
 * Contexto (C2 de PLAN-SUPABASE-CIERRE.md, cerrado el 2026-07-29): el registro de
 * prod tenía 731 migraciones contra 339 archivos locales, y solo 14 de 699 versiones
 * coincidían — el repo no era un subconjunto de la historia real, era un set paralelo
 * mantenido a mano. La causa no fue historia perdida: `apply_migration` (la MCP tool)
 * escribe SOLO en el servidor, así que guardar el archivo local siempre fue un paso
 * manual aparte, hecho de forma inconsistente durante meses. Se cerró generando un
 * baseline del catálogo de prod (`20260101000000_baseline_schema.sql`, verificado con
 * las 15 categorías de la huella en md5 idéntico a prod) y archivando las 339
 * heredadas en `supabase/migrations-legacy/`.
 *
 * Este gate existe porque nada mecánico impedía que la deriva volviera a acumularse:
 * ni olvidar el archivo ni nombrarlo con el viejo `YYYYMMDD_nombre.sql` dan error, y
 * el detector natural quedó ciego — `supabase migration list` y `db push --dry-run`
 * arrancan listando las 731 versiones pre-baseline sin archivo local, así que una
 * migración nueva sin archivo sería la fila 732 de una lista de ruido. Es el mismo
 * razonamiento que `gate:design`: una convención escrita en prosa que nadie chequea
 * es exactamente cómo se acumuló la deuda la primera vez.
 *
 * Uso:
 *   npm run gate:migrations              solo chequeos locales (sin red, sin credenciales)
 *   npm run gate:migrations -- --remote  además cruza contra el registro de prod
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, renameSync } from 'node:fs';

const DIR = 'supabase/migrations';
const LEGACY = 'supabase/migrations-legacy';

/** El baseline generado del catálogo de prod. Lleva una versión deliberadamente
 *  temprana (1-ene-2026) para ordenar ANTES de todo lo aplicado. */
const BASELINE = '20260101000000';

/** Primera migración aplicada después de registrar el baseline
 *  (`drop_overload_muerto_get_puntos_canjeados`, 2026-07-29 22:30:30 UTC).
 *
 *  Es la frontera entre "historia pre-baseline, archivada en migrations-legacy/" y
 *  "migraciones que DEBEN tener archivo local". No alcanza con comparar contra la
 *  versión del baseline: las 731 viejas van de 20260404143525 a 20260729215940, o
 *  sea son MAYORES que el baseline. Hace falta este corte explícito.
 *
 *  ⚠️ NUNCA moverlo hacia adelante para hacer callar un hallazgo: correrlo es
 *  declarar "esta migración no necesita archivo", que es precisamente la deriva
 *  que el gate detecta. Solo cambia si algún día se re-genera el baseline. */
const CORTE = '20260729223030';

/** Filas del registro de prod que son historia pre-baseline (medido al cierre de C2).
 *  Informativo: sirve para notar si el registro cambió de forma inesperada. */
const PRE_BASELINE_ESPERADAS = 731;

const NOMBRE = /^(\d{14})_([a-z0-9_]+)\.sql$/;

const errores = [];
const err = (msg, detalle) => errores.push({ msg, detalle });

// ── Un timestamp de 14 dígitos que no sea una fecha real casi siempre es un
//    `YYYYMMDD_nombre` al que alguien le pegó ceros, no una versión del servidor.
const timestampValido = (v) => {
  const [mes, dia, hora, min, seg] = [4, 6, 8, 10, 12].map(i => +v.slice(i, i + 2));
  return mes >= 1 && mes <= 12 && dia >= 1 && dia <= 31 && hora < 24 && min < 60 && seg < 60;
};

const sqls = (dir) => existsSync(dir)
  ? readdirSync(dir, { withFileTypes: true }).filter(e => e.isFile() && e.name.endsWith('.sql')).map(e => e.name)
  : null;

// ── 1. Los dos directorios existen ──────────────────────────────────────────────
const locales = sqls(DIR);
if (!locales) {
  console.error(`\n  ✗ No existe ${DIR}/.\n`);
  process.exit(1);
}
if (!existsSync(LEGACY)) {
  err(`No existe ${LEGACY}/`,
    ['El baseline solo es fiel si la historia pre-baseline está archivada ahí.',
     'Si desapareció, la arquitectura de C2 se deshizo — ver PLAN-SUPABASE-CIERRE.md.']);
}

// ── 2. Nombres: siempre <versión-de-14-dígitos>_<nombre>.sql ────────────────────
const versiones = new Map(); // versión → archivo
for (const archivo of locales.sort()) {
  const m = archivo.match(NOMBRE);
  if (!m) {
    err(`Nombre inválido: ${archivo}`,
      ['El formato es <versión>_<nombre>.sql, con la versión de 14 dígitos que asignó',
       'el servidor (la devuelve `apply_migration`, o `select max(version) from',
       'supabase_migrations.schema_migrations`). El viejo `YYYYMMDD_nombre.sql` de 8',
       'dígitos es lo que produjo la deriva: no se corresponde con ninguna fila real.']);
    continue;
  }
  const [, version] = m;
  if (!timestampValido(version)) {
    err(`Versión que no es un timestamp real: ${archivo}`,
      ['Los 14 dígitos son YYYYMMDDHHMMSS. Un `YYYYMMDD` rellenado con ceros no es',
       'la versión que asignó el servidor.']);
  }
  if (versiones.has(version)) {
    err(`Versión duplicada ${version}`, [`${versiones.get(version)} y ${archivo}`]);
  }
  versiones.set(version, archivo);
}

// ── 3. El baseline: exactamente uno, y ordena primero ───────────────────────────
if (!versiones.has(BASELINE)) {
  err(`Falta el baseline ${BASELINE}_baseline_schema.sql`,
    ['Es el único archivo que reproduce el esquema de prod. Sin él, `migrations/`',
     'describe solo lo aplicado después del 2026-07-29.']);
} else if ([...versiones.keys()].some(v => v < BASELINE)) {
  err('Hay una migración con versión anterior al baseline',
    ['El baseline tiene que ser el primero en aplicarse; una versión menor correría antes',
     'de que exista el esquema.']);
}

// ── 4. Todo lo que no es el baseline es post-corte ──────────────────────────────
for (const [version, archivo] of versiones) {
  if (version !== BASELINE && version < CORTE) {
    err(`${archivo} es anterior al corte post-baseline (${CORTE})`,
      ['La historia pre-baseline va en migrations-legacy/: aplicarla sobre el baseline',
       'falla por construcción (espera el esquema de abril, ej. employees.is_admin).']);
  }
}

// ── 5. Que nadie archive una migración nueva por error ──────────────────────────
for (const archivo of sqls(LEGACY) ?? []) {
  const version = (archivo.match(NOMBRE) || [])[1];
  if (version && version >= CORTE) {
    err(`${LEGACY}/${archivo} es post-baseline y está archivado`,
      ['Va en supabase/migrations/. Esto ya pasó una vez: un archivo recién escrito por',
       'otra sesión casi quedó archivado como "historia previa" mientras se creaba.']);
  }
}

const post = [...versiones.keys()].filter(v => v !== BASELINE).sort();
console.log(`\n  ${DIR}/: baseline + ${post.length} migración(es) post-baseline`);
console.log(`  ${LEGACY}/: ${(sqls(LEGACY) ?? []).length} archivo(s) de historia pre-baseline`);

// ── 6. Cruce contra el registro de prod (--remote) ──────────────────────────────
if (process.argv.includes('--remote')) {
  // El CLI se traga el .env del repo si tiene un nombre de variable con `-` y aborta.
  // Workaround conocido (ver reference_edge_function_deploy_workaround): moverlo.
  const HOLD = '.env.gate-hold';
  const mover = (de, a) => { if (existsSync(de)) renameSync(de, a); };
  const restaurar = () => mover(HOLD, '.env');

  if (existsSync(HOLD) && !existsSync('.env')) {
    console.log(`  ↻ ${HOLD} quedó de una corrida interrumpida; restaurado.`);
    restaurar();
  }

  let filas;
  process.on('exit', restaurar);
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { restaurar(); process.exit(130); });
  try {
    mover('.env', HOLD);
    const sql = `select version, name from supabase_migrations.schema_migrations
                 where version = '${BASELINE}' or version >= '${CORTE}' order by version`;
    const out = execFileSync('supabase', ['db', 'query', '--linked', '--agent', 'no', '-o', 'json', sql],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    filas = JSON.parse(out);
  } catch (e) {
    console.log(`\n  ⚠ No pude leer el registro de prod (${e.message.split('\n')[0]}).`);
    console.log('    Los chequeos locales de arriba sí corrieron. Para el cruce hace falta');
    console.log('    el CLI de Supabase logueado y el proyecto linkeado.');
  } finally {
    restaurar();
  }

  if (filas) {
    const remotas = new Map(filas.map(f => [f.version, f.name]));
    console.log(`  registro de prod: ${remotas.size} fila(s) desde el corte (+ ${PRE_BASELINE_ESPERADAS} pre-baseline ignoradas)`);

    for (const [version, name] of remotas) {
      if (!versiones.has(version)) {
        err(`Aplicada en prod y sin archivo local: ${version}_${name}`,
          ['Ésta es la deriva original: `apply_migration` escribió en el servidor y el',
           'archivo nunca se guardó. Recuperable — el SQL está en la columna `statements`:',
           `  select array_to_string(statements, E';\\n') from supabase_migrations.schema_migrations where version = '${version}';`,
           `Guardarlo como ${DIR}/${version}_${name}.sql.`]);
      }
    }
    for (const [version, archivo] of versiones) {
      if (!remotas.has(version)) {
        err(`Archivo local que no existe en el registro de prod: ${archivo}`,
          ['O la migración no se aplicó todavía, o el archivo se nombró con una versión',
           'inventada en vez de la que asignó el servidor.']);
      }
    }
  }
}

// ── Veredicto ───────────────────────────────────────────────────────────────────
if (!errores.length) {
  console.log('\n  ✓ Sin deriva.\n');
  process.exit(0);
}
console.log(`\n  ✗ ${errores.length} hallazgo(s):\n`);
for (const { msg, detalle } of errores) {
  console.log(`  • ${msg}`);
  for (const linea of detalle) console.log(`      ${linea}`);
  console.log('');
}
process.exit(1);
