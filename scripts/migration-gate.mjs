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
 *
 * `--remote` FALLA si no puede leer prod. Es a propósito: pedir el cruce y que no
 * se haga no puede terminar en el mismo tilde verde que un cruce que sí encontró
 * todo — «sin deriva» es una afirmación sobre prod, no sobre el disco. El hook de
 * pre-commit usa `--hook`, así que esto no bloquea ningún commit.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, renameSync, readFileSync } from 'node:fs';

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

/* Acá vivía PRE_BASELINE_ESPERADAS = 731, las filas de historia pre-baseline
 * medidas al cierre de C2. Se eliminó el 2026-08-12: ese día esas 731 filas se
 * borraron del registro de prod —eran lo que hacía fallar a `create_branch`, que
 * replica el historial del padre y moría en las migraciones de abril— y quedaron
 * respaldadas en `supabase_migrations.schema_migrations_legacy_bak_20260812`.
 * El gate ahora las cuenta en vivo en vez de anunciar una constante. */

const NOMBRE = /^(\d{14})_([a-z0-9_]+)\.sql$/;

const errores = [];
const err = (msg, detalle) => errores.push({ msg, detalle });

// ── Un timestamp de 14 dígitos que no sea una fecha real casi siempre es un
//    `YYYYMMDD_nombre` al que alguien le pegó ceros, no una versión del servidor.
const timestampValido = (v) => {
  const [mes, dia, hora, min, seg] = [4, 6, 8, 10, 12].map(i => +v.slice(i, i + 2));
  return mes >= 1 && mes <= 12 && dia >= 1 && dia <= 31 && hora < 24 && min < 60 && seg < 60;
};

// `--hook`: solo los .sql que el ÍNDICE de git conoce. Mismo motivo que en
// data-gate (2026-08-01): con 2-3 sesiones sobre el mismo árbol, un borrador de
// migración sin commitear de OTRA sesión hacía fallar el commit de ésta —
// nombre inválido, versión que no es timestamp, duplicada— señalando un archivo
// que quien commitea nunca tocó. El índice incluye lo que este commit prepara
// (`git commit -o` prepara antes del hook) y excluye lo ajeno sin commitear.
// En modo manual se sigue viendo todo, que es lo que se quiere al auditar.
const soloIndexado = process.argv.includes('--hook');
const indexados = soloIndexado
  ? new Set(
      execFileSync('git', ['ls-files', '--', 'supabase/migrations', 'supabase/migrations-legacy'], { encoding: 'utf8' })
        .trim().split('\n').filter(Boolean)
        .map(p => p.slice(p.lastIndexOf('/') + 1)),
    )
  : null;

const sqls = (dir) => existsSync(dir)
  ? readdirSync(dir, { withFileTypes: true })
      .filter(e => e.isFile() && e.name.endsWith('.sql'))
      .map(e => e.name)
      .filter(n => !indexados || indexados.has(n))
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

// ── 5.bis. `cron.unschedule` sin guarda: rompe la REPRODUCCIÓN ─────────────────
// `cron.unschedule(nombre)` LANZA si el trabajo no existe. En producción existe
// —porque alguien lo creó antes— así que la migración pasa y nadie se entera.
// En una base VACÍA no existe, la migración aborta, y con ella se cae todo lo
// que venía después.
//
// Medido el 2026-08-24 al rehacer el entorno de pruebas: la creación del branch
// replica la historia sobre una base limpia y **se detuvo en la migración 331 de
// 543**. Las 212 restantes no llegaron. El trabajo que faltaba era
// `cortes-caja-1min`, que **ninguna migración crea**: se programó en producción
// a mano y una migración posterior dio por hecho que estaba.
//
// Y no es un problema del entorno de pruebas: es que el historial no se puede
// reproducir, que es exactamente lo que hace falta el día que haya que
// reconstruir la base desde cero.
//
// El patrón correcto ya se usaba en cinco migraciones de este mismo repo:
//
//     SELECT cron.unschedule('x') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'x');
//
// No mira el `PERFORM cron.unschedule(...)` que vive DENTRO del cuerpo de una
// función: eso corre cuando alguien la llama, no cuando se replica el historial.
for (const archivo of locales) {
  const texto = readFileSync(`${DIR}/${archivo}`, 'utf8');
  const sinComentarios = texto.replace(/^\s*--.*$/gm, '');
  for (const m of sinComentarios.matchAll(/\bSELECT\s+cron\.unschedule\s*\(\s*'([^']+)'\s*\)([\s\S]{0,160}?);/g)) {
    const cola = m[2] || '';
    if (/WHERE\s+EXISTS/i.test(cola)) continue;
    err(`${DIR}/${archivo}: cron.unschedule('${m[1]}') sin guarda`,
      ['`cron.unschedule` LANZA si el trabajo no existe. En una base vacía aborta la',
       'migración y todas las que vienen después dejan de aplicarse — el historial',
       'deja de poder reproducirse. Envolvelo:',
       `  SELECT cron.unschedule('${m[1]}') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = '${m[1]}');`]);
  }
}

// ── 5.ter. Un REVOKE que se olvida de `authenticated` no revoca nada ──────────
// Supabase concede EXECUTE por DEFECTO a `anon, authenticated, service_role`
// sobre toda función nueva. El patrón que usa todo este repo —
//
//     REVOKE EXECUTE ON FUNCTION f(...) FROM PUBLIC, anon;
//     GRANT  EXECUTE ON FUNCTION f(...) TO service_role;
//
// — parece cerrar la función a `service_role` y NO lo hace: `authenticated`
// queda adentro por la puerta de atrás, porque nunca se le quitó.
//
// Medido el 2026-08-24 cruzando lo declarado contra el ACL real de producción:
// **131 funciones tienen EXECUTE para `authenticated` sin que ninguna migración
// se lo conceda**, y 14 son SECURITY DEFINER sin guarda de permiso adentro.
// Entre ésas, `notify_employees` acepta título, cuerpo y `push` arbitrarios
// contra cualquier lista de empleados.
//
// Se descubrió reconstruyendo el módulo fiscal en el entorno de pruebas: ahí
// `calc_credito_declarable` quedó abierta a `authenticated` y en producción la
// ejecuta sólo `service_role`. La diferencia entre las dos bases era la prueba.
//
// ── Se mide el ESTADO FINAL, no cada archivo ───────────────────────────────
// La primera versión acusaba por archivo y daba 28 hallazgos sobre 7 funciones:
// una migración que arregla el permiso no borraba las quejas de las anteriores,
// así que el número no bajaba nunca y no había forma de cerrarlo. Postgres no
// funciona así — gana la última sentencia. Acá también.
//
// Y NO mira las funciones de disparador: una `RETURNS trigger` no se puede
// llamar a mano (sin `NEW` lanza), así que su EXECUTE es irrelevante. Acusarlas
// metía 14 de 28 hallazgos que no eran nada.
{
  const devuelveTrigger = new Set();
  for (const archivo of locales) {
    const t = readFileSync(`${DIR}/${archivo}`, 'utf8');
    for (const m of t.matchAll(/FUNCTION\s+(?:public\.)?"?([a-z0-9_]+)"?\s*\([^)]*\)[\s\S]{0,200}?RETURNS\s+trigger/gi))
      devuelveTrigger.add(m[1]);
  }

  // Estado final por función, recorriendo las migraciones EN ORDEN de versión.
  const estado = new Map();   // fn → { authOk: boolean, archivo: string }
  for (const archivo of [...locales].sort()) {
    const texto = readFileSync(`${DIR}/${archivo}`, 'utf8').replace(/^\s*--.*$/gm, '');
    for (const m of texto.matchAll(/REVOKE\s+EXECUTE\s+ON\s+FUNCTION\s+(?:public\.)?"?([a-z0-9_]+)"?\s*\([^;]*?\)\s*FROM\s+([^;]+);/gis))
      estado.set(m[1], { authOk: /\bauthenticated\b/.test(m[2]), archivo });
    for (const m of texto.matchAll(/GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+(?:public\.)?"?([a-z0-9_]+)"?\s*\([^;]*?\)\s*TO\s+([^;]+);/gis))
      if (/\bauthenticated\b/.test(m[2]) && estado.has(m[1]))
        estado.set(m[1], { authOk: true, archivo });   // se le concede a propósito
  }

  for (const [fn, { authOk, archivo }] of [...estado].sort()) {
    if (authOk || devuelveTrigger.has(fn)) continue;
    err(`${fn}(): el REVOKE nunca le quita el EXECUTE a \`authenticated\``,
      [`Última declaración en ${archivo}.`,
       'Supabase se lo concede por defecto, así que revocarle sólo a PUBLIC y anon lo deja adentro.',
       'Si la función no es para el navegador, en una migración nueva:',
       `  REVOKE EXECUTE ON FUNCTION public.${fn}(…) FROM PUBLIC, anon, authenticated;`,
       'Y si SÍ es para el navegador, concedésela explícitamente.']);
  }
}

const post = [...versiones.keys()].filter(v => v !== BASELINE).sort();
console.log(`\n  ${DIR}/: baseline + ${post.length} migración(es) post-baseline`);
console.log(`  ${LEGACY}/: ${(sqls(LEGACY) ?? []).length} archivo(s) de historia pre-baseline`);

// ── 6. Cruce contra el registro de prod (--remote) ──────────────────────────────
let cruceHecho = false;
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

  let filas, preBaseline;
  process.on('exit', restaurar);
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { restaurar(); process.exit(130); });
  try {
    mover('.env', HOLD);
    const consultar = (sql) => JSON.parse(execFileSync(
      'supabase', ['db', 'query', '--linked', '--agent', 'no', '-o', 'json', sql],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));

    filas = consultar(`select version, name from supabase_migrations.schema_migrations
                       where version = '${BASELINE}' or version >= '${CORTE}' order by version`);

    // Se CUENTAN, no se asumen. Hasta el 2026-08-12 este número era la constante
    // PRE_BASELINE_ESPERADAS (731) impresa a ciegas; ese día las filas legacy se
    // borraron del registro para que `create_branch` pudiera replicar el esquema,
    // y el gate siguió anunciando 731 ignoradas cuando ya no quedaba ninguna. Un
    // gate que reporta un número que no midió miente incluso estando en verde.
    preBaseline = Number(consultar(
      `select count(*) as n from supabase_migrations.schema_migrations
       where version <> '${BASELINE}' and version < '${CORTE}'`)[0]?.n ?? 0);
  } catch (e) {
    // Que el cruce no se pueda hacer es un HALLAZGO, no una nota al pie.
    //
    // Hasta el 2026-08-17 esto imprimía un ⚠ y seguía: `filas` quedaba
    // undefined, el bloque de comparación se salteaba entero y el veredicto de
    // abajo igual anunciaba «✓ Sin deriva» con salida 0. O sea que pedir
    // `--remote` con el CLI deslogueado devolvía la MISMA respuesta que un
    // cruce que sí encontró todo — y «sin deriva» es una afirmación sobre prod,
    // no sobre el disco. Lo levantó otra sesión, cuyo `supabase db query` falló
    // y aun así vio el tilde verde.
    //
    // Es el mismo criterio que ya está escrito veinte líneas más abajo para el
    // conteo pre-baseline: un gate que reporta un número que no midió miente
    // incluso estando en verde. El hook de pre-commit corre `--hook`, no
    // `--remote`, así que fallar acá no bloquea ningún commit: sólo hace que
    // quien pidió el cruce se entere de que no hubo cruce.
    err(`No pude leer el registro de prod: ${e.message.split('\n')[0]}`,
      ['Los chequeos LOCALES de arriba sí corrieron y pasaron; lo que no se hizo es',
       'el cruce contra prod, que es lo único que `--remote` agrega.',
       'Hace falta el CLI de Supabase logueado y el proyecto linkeado:',
       '  supabase login && supabase link --project-ref sacecdkdmsdvgqnrsett',
       'Si sólo querías los chequeos locales, corré `npm run gate:migrations` sin --remote.']);
  } finally {
    restaurar();
  }

  if (filas) {
    cruceHecho = true;
    const remotas = new Map(filas.map(f => [f.version, f.name]));
    const nota = preBaseline === 0
      ? 'sin filas pre-baseline'
      : `+ ${preBaseline} pre-baseline ignoradas`;
    console.log(`  registro de prod: ${remotas.size} fila(s) desde el corte (${nota})`);

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
//
// El tilde dice QUÉ se verificó. «Sin deriva» a secas es una afirmación sobre
// prod, y sin el cruce no se puede sostener: el mismo texto para las dos
// corridas es lo que dejó pasar el hueco de arriba durante dos semanas.
if (!errores.length) {
  console.log(cruceHecho
    ? '\n  ✓ Sin deriva: los archivos locales y el registro de prod coinciden.\n'
    : '\n  ✓ Sin deriva local. El cruce contra prod NO se hizo — pedilo con `-- --remote`.\n');
  process.exit(0);
}
console.log(`\n  ✗ ${errores.length} hallazgo(s):\n`);
for (const { msg, detalle } of errores) {
  console.log(`  • ${msg}`);
  for (const linea of detalle) console.log(`      ${linea}`);
  console.log('');
}
process.exit(1);
