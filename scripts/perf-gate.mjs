#!/usr/bin/env node
/**
 * gate:perf — lo que se midió una vez, se sigue midiendo.
 *
 * ── Por qué existe ────────────────────────────────────────────────────────────
 *
 * El 2026-08-18 llegó un reporte de sala: «el sistema está lento en la consulta
 * de inventario, al buscar se traba». Midiendo salieron siete cosas, y ninguna
 * era nueva:
 *
 *   · el buscador del tablero salía a consultar con la PRIMERA tecla, y «a»
 *     devolvía 16,722 filas / 4.8 MB / 12,746 tarjetas
 *   · abrir Inventario hacía un Parallel Seq Scan de 775,868 filas para
 *     devolver 30 — media de 2,099 ms y pico de 7,818 ms
 *   · la búsqueda de esa vista normalizaba fila por fila, y dos veces: 720 ms
 *   · `sales_invoices` (340 MB, la tabla más grande) era la única de las
 *     calientes sin VACUUM programado: 8,879 heap fetches de 11,299 filas
 *   · `customers` no tenía índice sobre `name`, así que el sync de cada minuto
 *     barría 27,860 filas — y eso CRECÍA con cada ficha nueva
 *   · `purchase_sync_log` no tenía índice por fecha y la pantalla de
 *     sincronización lo barría entero cada 30 segundos
 *   · el arreglo de patrones de la búsqueda se recalculaba una vez POR PRODUCTO
 *
 * Todas vivieron meses. Ninguna dio error, ninguna apareció en un log, ninguna
 * falló un gate — porque **este proyecto no tenía ningún gate de velocidad**.
 * Se enteró un usuario antes que el repo.
 *
 * Este gate existe para que la próxima la encuentre una máquina.
 *
 * ── Tres decisiones de diseño, y por qué ──────────────────────────────────────
 *
 * 1. **La protección REAL es estructural, no temporal.** Un índice existe o no
 *    existe; un plan usa Seq Scan o no lo usa. Eso es determinista y no depende
 *    de cuánta gente esté usando el portal en ese momento. Los chequeos de las
 *    secciones A, B y C son los que de verdad frenan una regresión.
 *
 * 2. **Los tiempos son ruidosos, así que su techo es generoso.** Medir contra
 *    producción compartida da números que varían con la carga del momento. Un
 *    gate que falla al azar se termina ignorando —o peor, se le sube el número
 *    hasta que calle—, y entonces deja de proteger. Por eso los presupuestos de
 *    la sección D están puestos ~5× sobre lo medido: no vigilan una mejora de
 *    10 ms, vigilan que algo no vuelva a costar 700. Se toma el MEJOR de cinco
 *    corridas, que es el estimador más estable contra un servidor compartido.
 *
 * 3. **No toca el `.env` del repo.** El gate de migraciones lo mueve a un lado
 *    para que el CLI no se lo trague, y lo restaura al salir. Funciona, pero con
 *    dos o tres sesiones sobre el mismo árbol —que es la norma acá— esa ventana
 *    le puede tumbar el `npm run dev` a otra. Este usa `--workdir` sobre una
 *    copia mínima de la configuración, así que no toca ningún archivo compartido.
 *
 * ── Cómo se cierra un hallazgo ────────────────────────────────────────────────
 *
 * Arreglando lo que se rompió. El presupuesto NO se sube para que calle: si una
 * consulta cruzó su techo, o volvió un barrido secuencial o creció algo que hay
 * que mirar. `--update-baseline` es para BAJAR números después de una mejora
 * medida, y sólo eso.
 *
 * Uso:
 *   npm run gate:perf                     mide contra producción
 *   npm run gate:perf -- --update-baseline  baja los presupuestos a lo medido
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, cpSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASELINE_FILE = 'scripts/perf-gate-baseline.json';
const CORRIDAS = 5;            // de cuántas se toma la mejor
const MARGEN = 5;              // cuántas veces lo medido es el techo, al regenerar

/* ── A. Chequeos de código (locales, sin base) ───────────────────────────────
 *
 * Son constantes que alguien puede mover «un poquito» sin querer. El techo de
 * productos y el largo mínimo son literalmente lo que evita que la pestaña se
 * cuelgue; el filtro de `is_vencidos` es lo que separa un índice de un barrido
 * de 775,868 filas. */
const CODIGO = [
  {
    clave: 'minimo-3-letras',
    archivo: 'src/views/dashboard/WidgetInventorySearch.jsx',
    prueba: (t) => {
      const m = t.match(/const\s+MIN_LETRAS_BUSQUEDA\s*=\s*(\d+)/);
      if (!m) return 'no encontré la constante MIN_LETRAS_BUSQUEDA';
      return Number(m[1]) >= 3 ? null : `está en ${m[1]}; con menos de 3 el buscador sale con la primera tecla`;
    },
    porque: 'Con una sola letra la consulta devolvía 16,722 filas y 12,746 tarjetas.',
  },
  {
    clave: 'techo-de-productos',
    archivo: 'src/data/inventory.js',
    prueba: (t) => {
      const m = t.match(/MAX_PRODUCTOS_BUSQUEDA\s*=\s*(\d+)/);
      if (!m) return 'no encontré la constante MAX_PRODUCTOS_BUSQUEDA';
      return Number(m[1]) <= 100 ? null : `está en ${m[1]}; arriba de 100 el navegador vuelve a pintar de más`;
    },
    porque: 'El techo por producto es lo que acota el payload a ~126 kB en el peor caso.',
  },
  {
    clave: 'selector-filtra-vencidos',
    archivo: 'src/data/inventarioTab.js',
    prueba: (t) => /fetchInventorySyncLog[\s\S]{0,400}?\.eq\(\s*['"]is_vencidos['"]/.test(t)
      ? null
      : 'fetchInventorySyncLog dejó de filtrar is_vencidos',
    porque: 'Sin ese filtro no hay índice que sirva: vuelve el Seq Scan de 775,868 filas.',
  },
];

/* ── B. Estructura en producción ─────────────────────────────────────────────
 *
 * Cada fila es una pregunta con respuesta sí/no. Van todas en UNA consulta para
 * no pagar cinco arranques del CLI. */
const SQL_ESTRUCTURA = `
SELECT * FROM (
  SELECT 'indice-customers-name' AS clave,
         EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_customers_name') AS ok,
         'sin él, el sync de cada minuto barre las fichas de cliente (89 ms por corrida, y crece)' AS porque
  UNION ALL
  SELECT 'indice-purchase-sync-log',
         EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_purchase_sync_log_synced_at'),
         'sin él, la pantalla de sincronización barre 24,617 filas cada 30 segundos'
  UNION ALL
  -- Por \`pg_attribute\` y NO por \`information_schema.columns\`: el catálogo
  -- estándar cubre tablas y vistas, pero **no vistas materializadas**. Con
  -- information_schema este chequeo daba "ya no está" sobre una columna que sí
  -- existe — o sea, un gate en rojo por un defecto del propio gate, que es la
  -- peor clase de hallazgo: enseña a ignorarlo.
  SELECT 'columna-descripcion-norm',
         EXISTS (SELECT 1 FROM pg_attribute a
                 WHERE a.attrelid = 'public.inventory_grouped_mv'::regclass
                   AND a.attname = 'descripcion_norm' AND NOT a.attisdropped),
         'sin ella la búsqueda de Inventario vuelve a normalizar fila por fila (720 ms)'
  UNION ALL
  SELECT 'cron-vacuum-ventas',
         EXISTS (SELECT 1 FROM cron.job WHERE jobname='vacuum-sales-invoices' AND active),
         'sin él vuelven los heap fetches y toda consulta de ventas se encarece'
  UNION ALL
  SELECT 'patrones-materializados',
         (SELECT position('MATERIALIZED' in pg_get_functiondef(oid)) > 0
          FROM pg_proc WHERE proname='buscar_inventario_global_v2' AND pronamespace='public'::regnamespace),
         'sin MATERIALIZED el arreglo de patrones se recalcula una vez por producto'
  UNION ALL
  SELECT 'inventory-grouped-usa-la-columna',
         (SELECT position('norm_search(m.descripcion)' in pg_get_functiondef(oid)) = 0
          FROM pg_proc WHERE proname='inventory_grouped' AND pronamespace='public'::regnamespace),
         'si volvió a llamar norm_search sobre la vista, perdió la columna precalculada'
  UNION ALL
  -- El factor de una fila de inventario se resuelve en UN solo lugar
  -- (\`v_inventario_lotes\`). El día que alguien lo vuelva a derivar dentro de
  -- otra consulta, vuelven los dos números distintos del 2026-08-18 — y esa
  -- copia además se paga por fila.
  SELECT 'factor-en-un-solo-lugar',
         (SELECT position('v_inventario_lotes' in definition) > 0
             AND position('product_precios'    in definition) = 0
          FROM pg_views WHERE schemaname='public' AND viewname='v_inventario_disponible'),
         'si la existencia disponible volvió a cruzar el catálogo por su cuenta, hay dos reglas otra vez'
  UNION ALL
  SELECT 'busqueda-manda-el-factor',
         (SELECT position('v_inventario_lotes' in pg_get_functiondef(oid)) > 0
          FROM pg_proc WHERE proname='buscar_inventario_global_v2' AND pronamespace='public'::regnamespace),
         'sin eso la búsqueda no manda el factor y el navegador vuelve a deducirlo de detalle'
  UNION ALL
  SELECT 'busqueda-vieja-con-techo',
         (SELECT position('buscar_inventario_global_v2' in pg_get_functiondef(oid)) > 0
          FROM pg_proc WHERE proname='buscar_inventario_global' AND pronamespace='public'::regnamespace
            AND pg_get_function_identity_arguments(oid) = 'p_search text'),
         'la v1 sigue viva para las pestañas viejas, pero tiene que delegar en la v2 para no quedar sin techo'
) t ORDER BY clave`;

/* ── C. Forma del plan ───────────────────────────────────────────────────────
 *
 * `EXPLAIN` SIN `ANALYZE`: no ejecuta nada, no depende de la carga del momento,
 * y contesta la única pregunta que importa —¿está entrando por índice o está
 * barriendo la tabla?—. Es el chequeo más valioso del gate: los cuatro
 * problemas más caros del 2026-08-18 se veían acá antes que en ningún reloj. */
const PLANES = [
  {
    clave: 'plan-selector-sucursal',
    sql: `SELECT erp_sucursal_id, is_vencidos, synced_at, success, items_count
          FROM public.inventory_sync_log WHERE is_vencidos = false
          ORDER BY synced_at DESC LIMIT 30`,
    prohibido: 'Seq Scan',
    porque: 'Un Seq Scan acá son 775,868 filas para devolver 30, y se lleva los 2 workers paralelos de la instancia.',
  },
  {
    clave: 'plan-nombre-de-cliente',
    sql: `SELECT name FROM public.customers
          WHERE name = ANY (ARRAY(SELECT c.name FROM public.customers c ORDER BY c.id LIMIT 80))`,
    prohibido: 'Seq Scan on customers',
    porque: 'Lo corre el sync de facturas cada minuto por sucursal, y encarece con cada ficha nueva.',
  },
  {
    clave: 'plan-estado-sincronizacion',
    sql: `SELECT domain, checked_at FROM public.v_sync_health
          WHERE domain IN ('products','minmax','purchases','backup')
          ORDER BY checked_at DESC LIMIT 200`,
    prohibido: 'Seq Scan',
    porque: 'La pantalla repregunta cada 30 segundos por cada persona que la tenga abierta.',
  },
  {
    clave: 'plan-venta-por-hora',
    sql: `SELECT sale_hour, transaction_count, sale_date FROM public.branch_hourly_sales
          WHERE branch_id = 2 AND sale_date >= (CURRENT_DATE - 90)`,
    exigido: 'Index Only Scan',
    porque: 'Es el rango que pide el tablero. Sin Index Only Scan volvieron los heap fetches: 219.7 ms contra 8.8.',
  },
  {
    clave: 'plan-existencia-disponible',
    sql: `SELECT sum(unidades) FROM public.v_inventario_disponible`,
    exigido: 'Memoize',
    porque: 'Resolver el factor cuesta un lateral por fila; el Memoize lo cobra una vez por '
          + '(producto, presentación, detalle) y es lo que deja el barrido en 97 ms. Sin él, '
          + 'son 17,719 laterales — la primera forma de esto llevó los faltantes de 122 a 692 ms.',
  },
];

/* ── D. Presupuestos de tiempo ───────────────────────────────────────────────
 *
 * El techo, no la meta. Ver la decisión 2 del encabezado. */
const TIEMPOS = [
  { clave: 'busqueda-del-tablero',      sql: `SELECT public.buscar_inventario_global_v2('amoxicilina', 60)` },
  { clave: 'busqueda-vista-inventario', sql: `SELECT count(*) FROM public.inventory_grouped(p_erp_id=>NULL,p_vencidos=>false,p_proximos=>false,p_area_vencidos=>false,p_lab_id=>NULL,p_categoria=>NULL,p_search=>'amoxicilina',p_sort=>'descripcion',p_sort_dir=>'asc',p_limit=>25,p_offset=>0)` },
  { clave: 'abrir-inventario',          sql: `SELECT count(*) FROM (SELECT erp_sucursal_id FROM public.inventory_sync_log WHERE is_vencidos=false ORDER BY synced_at DESC LIMIT 30) z` },
  { clave: 'venta-por-hora-90d',        sql: `SELECT count(*) FROM public.branch_hourly_sales WHERE branch_id=2 AND sale_date >= CURRENT_DATE-90` },
  { clave: 'nombre-de-cliente',         sql: `SELECT count(*) FROM public.customers WHERE name = ANY (ARRAY(SELECT c.name FROM public.customers c ORDER BY c.id LIMIT 80))` },
  { clave: 'estado-sincronizacion',     sql: `SELECT count(*) FROM (SELECT checked_at FROM public.v_sync_health WHERE domain IN ('products','minmax','purchases','backup') ORDER BY checked_at DESC LIMIT 200) z` },
  // Las dos que faltaban, y se notó tarde: el 2026-08-18 un cambio en
  // `v_inventario_disponible` llevó los faltantes de 122 a 692 ms y ningún
  // gate lo vio, porque nadie medía esta vista. La llaman las cuatro puertas
  // de traslados —el widget del tablero al entrar, la consulta de inventario,
  // la pantalla de aprobar y el trigger que valida la solicitud—.
  //
  // Techos más ajustados que el resto a propósito: acá el modo de falla
  // conocido es 5x, así que un techo de 5x no lo atajaría. Medido en 6
  // corridas: 163–186 ms.
  { clave: 'faltantes-en-otra-sala',    sql: `SELECT count(*) FROM public.get_faltantes_con_stock_en_otra_sala(6, 20)` },
  { clave: 'donde-hay-un-producto',     sql: `SELECT public.get_donde_hay(187, 5)` },
];

/* ── El canal hacia producción ────────────────────────────────────────────────
 *
 * `supabase db query` lee el `.env` del directorio de trabajo y aborta si tiene
 * una variable con `-` en el nombre — que es el caso de este repo. En vez de
 * mover ese archivo (ver decisión 3), se le da un directorio propio con lo
 * mínimo para que sepa a qué proyecto apunta. */
/* Lo que el CLI escribe SIEMPRE, salga bien o mal. Si al filtrarlo no queda
 * nada, el fallo no vino de él y el mensaje de `execFileSync` es todo lo que
 * hay. */
const RUIDO_DEL_CLI = [
  /^Using workdir/,
  /^Initialising login role/,
  /^A new version of Supabase CLI/,
  /^We recommend updating/,
];
const sinRuidoDelCli = (txt) => String(txt ?? '')
  .split('\n')
  .map(l => l.trimEnd())
  .filter(l => l && !RUIDO_DEL_CLI.some(r => r.test(l)))
  .join('\n');

function abrirCanal() {
  const dir = join(tmpdir(), `perf-gate-${process.pid}`);
  mkdirSync(join(dir, 'supabase'), { recursive: true });
  for (const f of ['config.toml', '.temp']) {
    const origen = join('supabase', f);
    if (existsSync(origen)) cpSync(origen, join(dir, 'supabase', f), { recursive: true });
  }
  if (!existsSync(join(dir, 'supabase', '.temp'))) {
    rmSync(dir, { recursive: true, force: true });
    throw new Error('el proyecto no está linkeado (falta supabase/.temp)');
  }
  /* El stderr se CAPTURA, no se descarta.
   *
   * Descartarlo tenía su motivo: el CLI escribe «Using workdir…»,
   * «Initialising login role…» y el aviso de versión nueva en CADA llamada, o
   * sea nueve párrafos de ruido por corrida. Pero cuando la llamada falla, ese
   * mismo canal es lo ÚNICO que dice por qué, y el gate quedaba anunciando «no
   * pude medir» sin poder decir de qué. Pasó el 2026-08-19: hubo que
   * reproducir la corrida a mano, con el stderr a la vista, para descubrir que
   * había sido transitorio — y la conclusión «transitorio» tampoco se podía
   * sostener sin haber visto el mensaje.
   *
   * Capturado y mostrado SÓLO al fallar, el ruido sigue sin aparecer y el
   * diagnóstico deja de exigir una segunda corrida. */
  const consultar = (sql) => {
    let salida;
    try {
      salida = execFileSync('supabase',
        ['db', 'query', '--workdir', dir, '--linked', '--agent', 'no', '-o', 'json', sql],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 32 * 1024 * 1024 });
    } catch (e) {
      e.detalleCli = sinRuidoDelCli(e.stderr);
      throw e;
    }
    const i = salida.indexOf('[');
    if (i < 0) throw new Error('la respuesta no traía filas');
    return JSON.parse(salida.slice(i));
  };
  return { consultar, cerrar: () => rmSync(dir, { recursive: true, force: true }) };
}

// Mide una consulta CORRIDAS veces del lado del servidor y devuelve la mejor.
// Todo adentro de un viaje: el arranque del CLI cuesta más que las consultas.
const sqlMedir = (sql) => `
CREATE TEMP TABLE _pg_m(ms numeric);
DO $$ DECLARE t0 timestamptz; i int; BEGIN
  FOR i IN 1..${CORRIDAS} LOOP
    t0 := clock_timestamp();
    PERFORM (${sql});
    INSERT INTO _pg_m VALUES (EXTRACT(epoch FROM clock_timestamp()-t0)*1000);
  END LOOP;
END $$;
SELECT round(min(ms), 2) AS ms FROM _pg_m`;

/* En el hook de pre-commit corre SÓLO la sección A.
 *
 * El resto habla con producción, y un gate de commit que necesita red falla en
 * un avión y enseña a usar `--no-verify`, que es peor que no tenerlo. Es el
 * mismo criterio por el que `gate:migrations --remote` tampoco está en el hook.
 *
 * Los tres chequeos de código no son el corazón del gate, pero sí son los que
 * protegen contra el cambio más fácil de hacer sin querer: mover una constante. */
function soloCodigo() {
  const fallas = [];
  for (const c of CODIGO) {
    if (!existsSync(c.archivo)) { fallas.push({ ...c, detalle: `no existe ${c.archivo}` }); continue; }
    const detalle = c.prueba(readFileSync(c.archivo, 'utf8'));
    if (detalle) fallas.push({ ...c, detalle });
  }
  if (fallas.length === 0) {
    console.log(`\n✓ velocidad: ${CODIGO.length} constante(s) de la búsqueda en su sitio.\n`);
    return;
  }
  console.log(`\n✗ ${fallas.length} hallazgo(s) de velocidad:\n`);
  for (const f of fallas) {
    console.log(`  • ${f.clave} — ${f.detalle}`);
    console.log(`      ${f.porque}`);
  }
  console.log('\n  El resto del gate (índices, planes y tiempos) NO corre en el hook porque');
  console.log('  necesita producción. Antes de cerrar: `npm run gate:perf`.\n');
  process.exitCode = 1;
}

function main() {
  if (process.argv.includes('--hook')) return soloCodigo();
  const actualizar = process.argv.includes('--update-baseline');
  const baseline = existsSync(BASELINE_FILE)
    ? JSON.parse(readFileSync(BASELINE_FILE, 'utf8'))
    : { _comment: '', updated: '', presupuestos: {} };
  const fallas = [];

  console.log('\n── Velocidad ─────────────────────────────────────────────');

  // ── A. Código ──────────────────────────────────────────────────────────────
  for (const c of CODIGO) {
    if (!existsSync(c.archivo)) { fallas.push({ ...c, detalle: `no existe ${c.archivo}` }); continue; }
    const detalle = c.prueba(readFileSync(c.archivo, 'utf8'));
    if (detalle) fallas.push({ ...c, detalle });
  }
  console.log(`  código:      ${CODIGO.length - fallas.length}/${CODIGO.length} constantes en su sitio`);

  const canal = abrirCanal();
  const medidos = {};
  try {
    // ── B. Estructura ────────────────────────────────────────────────────────
    const estructura = canal.consultar(SQL_ESTRUCTURA);
    for (const f of estructura) {
      if (f.ok !== true) fallas.push({ clave: f.clave, porque: f.porque, detalle: 'ya no está' });
    }
    console.log(`  estructura:  ${estructura.filter(f => f.ok === true).length}/${estructura.length} índices, columnas y crons vivos`);

    // ── C. Planes ────────────────────────────────────────────────────────────
    // `EXPLAIN (FORMAT JSON)` se puede capturar con EXECUTE ... INTO, así que
    // los cuatro planes entran en un solo viaje.
    const sqlPlanes = `
CREATE TEMP TABLE _pg_p(clave text, plan text);
DO $$ DECLARE p json; BEGIN
${PLANES.map(p => `  EXECUTE 'EXPLAIN (FORMAT JSON) ${p.sql.replace(/'/g, "''").replace(/\s+/g, ' ')}' INTO p;
  INSERT INTO _pg_p VALUES ('${p.clave}', p::text);`).join('\n')}
END $$;
SELECT clave, plan FROM _pg_p`;
    const planes = new Map(canal.consultar(sqlPlanes).map(r => [r.clave, r.plan]));
    let planesOk = 0;
    for (const p of PLANES) {
      const plan = planes.get(p.clave) ?? '';
      const mal = (p.prohibido && plan.includes(p.prohibido))
        || (p.exigido && !plan.includes(p.exigido));
      if (mal) {
        fallas.push({ clave: p.clave, porque: p.porque,
          detalle: p.prohibido ? `el plan volvió a usar «${p.prohibido}»` : `el plan ya no usa «${p.exigido}»` });
      } else planesOk++;
    }
    console.log(`  planes:      ${planesOk}/${PLANES.length} entrando por índice`);

    // ── D. Tiempos ───────────────────────────────────────────────────────────
    for (const t of TIEMPOS) medidos[t.clave] = Number(canal.consultar(sqlMedir(t.sql))[0].ms);
  } finally {
    canal.cerrar();
  }

  if (actualizar) {
    const nuevos = {};
    for (const [clave, ms] of Object.entries(medidos)) {
      const techo = Math.max(Math.ceil(ms * MARGEN), 10);
      const previo = baseline.presupuestos?.[clave];
      // Sólo BAJA. Ver el encabezado: subir un techo para que calle es
      // exactamente lo que convierte un gate en un adorno.
      nuevos[clave] = previo != null ? Math.min(previo, techo) : techo;
    }
    writeFileSync(BASELINE_FILE, JSON.stringify({
      ...baseline,
      updated: new Date().toISOString().slice(0, 10),
      presupuestos: nuevos,
    }, null, 2) + '\n');
    console.log(`\n  Presupuestos actualizados (sólo hacia abajo) en ${BASELINE_FILE}.\n`);
    return;
  }

  console.log('\n  medido / techo');
  for (const t of TIEMPOS) {
    const ms = medidos[t.clave];
    const techo = baseline.presupuestos?.[t.clave];
    if (techo == null) {
      fallas.push({ clave: t.clave, porque: 'Toda consulta vigilada necesita su techo escrito.',
        detalle: `sin presupuesto en ${BASELINE_FILE} — corré con --update-baseline` });
      continue;
    }
    const cruzo = ms > techo;
    if (cruzo) fallas.push({ clave: t.clave, porque: 'Cruzó su techo: o volvió un barrido, o creció algo que hay que mirar.',
      detalle: `${ms} ms contra un techo de ${techo} ms` });
    console.log(`    ${cruzo ? '✗' : '·'} ${t.clave.padEnd(28)} ${String(ms).padStart(8)} ms  /  ${techo} ms`);
  }

  if (fallas.length === 0) {
    console.log('\n✓ Velocidad en su sitio: índices, planes y tiempos dentro de lo medido.\n');
    return;
  }

  console.log(`\n✗ ${fallas.length} hallazgo(s):\n`);
  for (const f of fallas) {
    console.log(`  • ${f.clave} — ${f.detalle}`);
    console.log(`      ${f.porque}`);
  }
  console.log('\n  El presupuesto NO se sube para que calle. `--update-baseline` sólo BAJA');
  console.log('  números después de una mejora medida.');
  console.log('  El detalle de qué se arregló el 2026-08-18 y por qué: CHANGELOG.md v2.658.3.\n');
  process.exitCode = 1;
}

try { main(); } catch (e) {
  // Que no se pueda medir es un HALLAZGO, no una nota al pie — mismo criterio
  // que `gate:migrations --remote`. Un gate que no pudo medir no puede dar verde.
  console.log(`\n✗ No pude medir contra producción: ${String(e.message).split('\n')[0]}`);
  // Lo que contestó el CLI. Sin esto, «no pude medir» obliga a reproducir la
  // corrida a mano para saber si fue un login vencido, una consulta rota o un
  // tropiezo de red — tres cosas que se arreglan distinto.
  if (e.detalleCli) {
    console.log('\n  Lo que contestó:');
    for (const l of e.detalleCli.split('\n').slice(-8)) console.log(`    ${l}`);
  }
  console.log('\n  Si no dijo nada más, suele ser el CLI sin login o el proyecto sin linkear:');
  console.log('    supabase login && supabase link --project-ref sacecdkdmsdvgqnrsett\n');
  process.exitCode = 1;
}
