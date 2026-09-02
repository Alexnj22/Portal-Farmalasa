/**
 * `npm run portal:lento` — qué mirar cuando el portal no responde.
 *
 * ── Por qué existe ────────────────────────────────────────────────────────────
 * El 2026-09-01 el portal dejó de dejar entrar entre las 16:35 y las 16:44.
 * El reporte fue «Realtime no funciona, no se puede iniciar sesión», y las dos
 * mitades eran falsas: Realtime devolvía 101 y Auth devolvía 200. Lo que estaba
 * roto era UNA consulta de LECTURA que corría cada minuto y ocupaba una de las
 * 20 conexiones del portal durante 13 segundos.
 *
 * Ése es el punto: **el síntoma nunca nombra la causa.** Quien lo sufre dice
 * «no puedo entrar», y quien mira los logs ve «Timed out acquiring connection
 * from connection pool», que manda a mirar las conexiones — donde no está el
 * problema. Este script hace las cuatro preguntas en el orden que las separa,
 * para no volver a perder veinte minutos descartando servicios sanos.
 *
 * Es de SÓLO LECTURA. No arregla nada y no escribe: sólo dice dónde mirar.
 */
import { abrirCanal } from './lib/canal-supabase.mjs';

const N = (v) => Number(v ?? 0);
const fmt = (n) => N(n).toLocaleString('es-SV');
const mb  = (bloques) => `${(N(bloques) * 8192 / 1024 / 1024).toFixed(0)} MB`;

/* ── 1. ¿Está pasando AHORA? ──────────────────────────────────────────────────
 * Lo primero es separar «está pasando» de «pasó». Son diagnósticos distintos:
 * si está pasando, la consulta culpable está viva en `pg_stat_activity` y se
 * puede leer entera; si ya pasó, sólo queda la estadística acumulada. */
const SQL_AHORA = `
SELECT
  (SELECT count(*) FROM pg_stat_activity)                                    AS conexiones,
  (SELECT setting::int FROM pg_settings WHERE name='max_connections')        AS tope,
  (SELECT count(*) FROM pg_stat_activity WHERE usename='authenticator')      AS del_portal,
  (SELECT count(*) FROM pg_stat_activity
     WHERE state='active' AND now()-query_start > interval '3 seconds')      AS lentas_ahora,
  (SELECT count(*) FROM pg_stat_activity WHERE wait_event_type='Lock')       AS esperando_lock,
  date_trunc('second', pg_postmaster_start_time())                           AS arranco,
  date_trunc('second', now() - pg_postmaster_start_time())                   AS lleva_arriba`;

/* Las consultas vivas que ya pasaron los 3 segundos. Si hay alguna, es ella. */
const SQL_VIVAS = `
SELECT pid, usename, state, wait_event_type, wait_event,
       date_trunc('second', now()-query_start)::text AS hace,
       left(regexp_replace(query, '\\s+', ' ', 'g'), 150) AS consulta
FROM pg_stat_activity
WHERE state <> 'idle' AND pid <> pg_backend_pid()
  AND now() - query_start > interval '3 seconds'
  -- El slot de replicación de Realtime vive SIEMPRE 'active' esperando WAL, así
  -- que aparece acá con horas de antigüedad y no es una consulta lenta: es una
  -- conexión haciendo exactamente su trabajo. Un detector que la acusa entrena a
  -- ignorar el listado entero, que es como se desactiva sola una alarma.
  AND backend_type = 'client backend'
  AND wait_event IS DISTINCT FROM 'WalSenderWaitForWal'
ORDER BY query_start`;

/* ── 2. Quién cuesta más POR LLAMADA ──────────────────────────────────────────
 * Se ordena por BLOQUES, no por milisegundos, y ésa es la decisión que hace
 * útil a este listado.
 *
 * Un promedio de milisegundos medido durante un corte dice quién ESPERÓ, no
 * quién estaba lento: bajo saturación todo tarda, así que el ranking se llena
 * de víctimas. Los bloques no dependen de la carga del momento — son el trabajo
 * que la consulta hace, lo mida quien lo mida y esté el servidor ocupado o
 * vacío. La que tumbó el portal el 01-sep leía 1,528,584 bloques (11.7 GB) por
 * llamada para devolver una lista VACÍA; ordenado por tiempo aparecía mezclada
 * entre las que sólo la estaban esperando. */
const SQL_CAROS = `
SELECT calls,
       round((shared_blks_hit + shared_blks_read)::numeric / calls) AS bloq,
       round(mean_exec_time::numeric)                               AS media_ms,
       round(max_exec_time::numeric)                                AS max_ms,
       date_trunc('minute', stats_since)::text                      AS desde,
       coalesce(
         (regexp_match(query, '"public"\\."([a-z0-9_]+)"\\s*\\('))[1],
         (regexp_match(query, 'public\\.([a-z0-9_]+)\\s*\\('))[1],
         left(regexp_replace(query, '\\s+', ' ', 'g'), 55)
       ) AS quien
FROM extensions.pg_stat_statements
WHERE calls >= 3
  -- ── Lo que NO es el portal leyendo ─────────────────────────────────────────
  -- Un bloque \`DO $$\` que llama siete veces a la misma función cuenta como UNA
  -- statement: \`bloques/calls\` le atribuye el trabajo de las siete. O sea que el
  -- listado acusaba a la función del costo de MEDIRLA — medido acá mismo el
  -- 2026-09-01, \`get_faltantes_con_stock_en_otra_sala\` figuraba en 2,720 MB por
  -- llamada y su caller real leía 467. La herramienta que mide ensuciaba lo que
  -- media y después culpaba a otro.
  AND query !~* '^\\s*(DO|EXPLAIN|VACUUM|ANALYZE|CREATE|REINDEX|CLUSTER)\\M'
ORDER BY (shared_blks_hit + shared_blks_read) / calls DESC
LIMIT 12`;

function main() {
  const canal = abrirCanal('portal-lento');
  try {
    const a = canal.consultar(SQL_AHORA)[0];

    console.log('\n── ¿Está pasando ahora? ──────────────────────────────────');
    const holgura = N(a.tope) - N(a.conexiones);
    console.log(`  conexiones      ${fmt(a.conexiones)} de ${fmt(a.tope)}   (${fmt(a.del_portal)} son del portal)`);
    console.log(`  consultas >3 s  ${fmt(a.lentas_ahora)}`);
    console.log(`  esperando lock  ${fmt(a.esperando_lock)}`);
    console.log(`  Postgres arrancó ${a.arranco} — lleva ${a.lleva_arriba}`);

    /* Un reinicio reciente NO es la causa, es una consecuencia, y decirlo acá
     * evita el rato que se pierde buscándole explicación propia. */
    if (String(a.lleva_arriba).startsWith('00:0') || String(a.lleva_arriba).startsWith('00:1')) {
      console.log('\n  ⚠ Postgres se reinició hace menos de 20 minutos.');
      console.log('    Un reinicio reciente suele ser CONSECUENCIA de la saturación, no su causa:');
      console.log('    seguí con el listado de abajo antes de buscarle explicación aparte.');
    }
    if (holgura < 10) {
      console.log(`\n  ⚠ Quedan ${holgura} conexiones libres de ${fmt(a.tope)}.`);
    }

    const vivas = canal.consultar(SQL_VIVAS);
    if (vivas.length === 0) {
      console.log('\n  Ninguna consulta lleva más de 3 segundos. Si el portal está lento AHORA,');
      console.log('  el problema no está en la base — mirá Auth, Realtime o la red del navegador.');
    } else {
      console.log(`\n  ${vivas.length} consulta(s) viva(s) de más de 3 s — la culpable suele ser la más vieja:\n`);
      for (const v of vivas) {
        const espera = v.wait_event_type ? `${v.wait_event_type}/${v.wait_event}` : v.state;
        console.log(`    hace ${String(v.hace).padStart(8)}  pid ${v.pid}  ${espera}`);
        console.log(`      ${v.consulta}`);
      }
    }

    console.log('\n── Quién cuesta más por llamada ──────────────────────────');
    console.log('  Ordenado por BLOQUES leídos, no por milisegundos: bajo saturación');
    console.log('  todo tarda, así que el reloj ordena a las víctimas junto al culpable.\n');
    const caros = canal.consultar(SQL_CAROS);
    console.log(`    ${'por llamada'.padStart(11)}  ${'bloques'.padStart(10)}  ${'media'.padStart(7)}  ${'peor'.padStart(8)}  ${'veces'.padStart(6)}  ${'total leído'.padStart(11)}  quién`);
    for (const c of caros) {
      /* Los umbrales son DOS y están lejos a propósito. Con el ✗ en 10,000 se
       * marcaban 11 de las 12 filas — y un listado donde casi todo está en rojo
       * no ordena nada, sólo enseña a saltearlo. La que tumbó el portal leía
       * 1,528,584 bloques por llamada: dos órdenes de magnitud por encima de
       * las que trabajan mucho y están bien. */
      const alerta = N(c.bloq) >= 100_000 ? '✗' : N(c.bloq) >= 25_000 ? '⚠' : '·';
      console.log(`  ${alerta} ${mb(c.bloq).padStart(11)}  ${fmt(c.bloq).padStart(10)}  ${(c.media_ms+' ms').padStart(7)}  ${(c.max_ms+' ms').padStart(8)}  ${String(c.calls).padStart(6)}  ${mb(N(c.bloq)*N(c.calls)).padStart(11)}  ${c.quien}`);
    }
    if (caros.length) console.log(`\n  Medido desde ${caros[0].desde} (la estadística se borra en cada reinicio).`);

    console.log(`
── Qué hacer con eso ─────────────────────────────────────────────

  ✗ = 780 MB o más por llamada. ⚠ = 195 MB o más. Ninguno de los dos es
  por sí solo un defecto —un barrido de sincronización puede costar eso—:
  lo que convierte a una en candidata es el costo por llamada JUNTO con
  cuántas veces corre, que es la última columna. La que tumbó el portal
  leía 11.7 GB por vuelta, cada minuto, para devolver una lista vacía.

  El orden que funciona:

  1. Mirá el plan de verdad, con bloques y sin reloj:

       EXPLAIN (ANALYZE, TIMING OFF, BUFFERS) SELECT public.<funcion>(<args>);

     El reloj miente bajo carga y la instrumentación del timing inventa
     tiempo en los nested loops. Los bloques no.

  2. En el plan, buscá el nodo donde \`rows\` estimadas y \`actual rows\`
     se separan por mucho. Ahí está el defecto — casi nunca en el SQL.
     Si estimaba miles y devuelve cero o uno, el planificador eligió el
     camino al revés por una ESTADÍSTICA vieja, no por estar mal escrita.

  3. Si el filtro va sobre una columna de pocos valores distintos:

       ANALYZE public.<tabla>;

     y volvé a medir. Si eso lo arregla, la corrección DEFINITIVA es un
     índice parcial sobre la condición rara — dejarlo en el ANALYZE es
     apoyar el portal en que alguien lo repita a tiempo.

  4. Después de corregir, borrá SÓLO su estadística para poder verificar
     sin esperar a que el promedio viejo se diluya:

       SELECT extensions.pg_stat_statements_reset(userid, dbid, queryid)
       FROM extensions.pg_stat_statements WHERE query LIKE '%<funcion>%';

  Y si hay que parar la sangre YA, sin haber entendido nada todavía:

       UPDATE cron.job SET active = false WHERE jobname = '<el cron>';

  Se vuelve a encender con \`active = true\`. Apagar un cron un rato es
  reversible; un portal caído en horario de sala, no.
`);
  } finally {
    canal.cerrar();
  }
}

try { main(); } catch (e) {
  console.log(`\n✗ No pude medir contra producción: ${String(e.message).split('\n')[0]}`);
  if (e.detalleCli) {
    console.log('\n  Lo que contestó:');
    for (const l of e.detalleCli.split('\n').slice(-8)) console.log(`    ${l}`);
  }
  console.log('\n  Suele ser el CLI sin login o el proyecto sin linkear:');
  console.log('    supabase login && supabase link --project-ref sacecdkdmsdvgqnrsett\n');
  process.exitCode = 1;
}
