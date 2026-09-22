#!/usr/bin/env node
/**
 * npm run medir:como-usuario — lo que cuesta cada lectura del portal COMO USUARIO.
 *
 * ── Por qué existe ──────────────────────────────────────────────────────────
 * El 2026-09-22 la búsqueda de Ventas se «arregló» midiéndola como `postgres`:
 * 4.7 s → 10 ms. Como usuario seguía en 15,143 ms. `postgres` se salta el RLS,
 * y bajo una policy un `LIKE` (que no es leakproof) no puede entrar al índice.
 * El mismo día, el detalle de producto —medido «sano» el 4-sep con literales—
 * leía 5.3 GB por llamada en producción, por la trampa 4 de CLAUDE.md.
 *
 * Los dos se ven de una sola manera: llamando a la FUNCIÓN, con los permisos de
 * quien la llama de verdad. Este instrumento hace eso con cada llamada de
 * `LLAMADAS`, bajo tres identidades:
 *
 *   · postgres         — sin RLS; es lo que miden los otros gates.
 *   · usuario · todas  — la cuenta de QA (alcance total en todo).
 *   · usuario · sala   — un empleado ACTIVO de Salud 1 con Ventas en alcance de sala.
 *
 * y por cada una anota bloques (8 kB), milisegundos, filas y la huella md5 del
 * resultado. Dos lecturas salen de ahí:
 *
 *   · `rls×N` — el usuario de alcance total lee N veces lo que lee `postgres`.
 *     Con el MISMO resultado, esa diferencia es puro costo del RLS: el plan
 *     cambió. Es la firma del defecto de la búsqueda.
 *   · `distinto` — el usuario de alcance total NO ve lo mismo que `postgres`.
 *     A veces es correcto (una función que responde por quien la llama), pero
 *     hay que saber cuál es cuál: es la forma de ver que una policy recorta algo
 *     que no debería.
 *
 * ── Sólo lectura, por construcción ──────────────────────────────────────────
 * Corre contra producción. Antes de medir, cada llamada se revisa: toda función
 * que invoque tiene que ser STABLE/IMMUTABLE (Postgres le prohíbe escribir) o
 * estar en `VOLATILES_REVISADAS` con su motivo, y esa revisión se REPITE acá en
 * cada corrida buscando INSERT/UPDATE/DELETE en el cuerpo. Si alguien le agrega
 * una escritura mañana, el instrumento se niega a medirla.
 *
 * Mide, no juzga: no falla por un número. Es la herramienta con la que se
 * decide qué arreglar; el techo de cada función vive en `gate:perf`.
 *
 * Uso:  npm run medir:como-usuario [-- --solo clave1,clave2] [-- --json salida.json]
 */
import { writeFileSync } from 'node:fs';
import { abrirCanal } from './lib/canal-supabase.mjs';

const MES = `date_trunc('month', current_date)::date`;
const ANIO = `date_trunc('year', current_date)::date`;
// El producto más vendido (3856) y Salud 1 (branch 4 · erp 1): el caso caro y
// una sala real. El producto va fijo a propósito: elegirlo en cada corrida
// cambiaría el caso y los números dejarían de compararse entre corridas.
const PRODUCTO = 3856;

/** Cada llamada es un SELECT que devuelve filas. `nota` dice qué pantalla es. */
const LLAMADAS = [
  // ── Ventas ──
  { clave: 'ventas-buscar-anio',       nota: 'Ventas · buscar un producto en el año',
    sql: `SELECT * FROM public.get_ventas_con_receta(${ANIO}, current_date, NULL, 'todas', 'losartan', 'fecha', 'desc', 50, 0, false)` },
  { clave: 'ventas-buscar-totales',    nota: 'Ventas · encabezado de esa búsqueda',
    sql: `SELECT * FROM public.get_ventas_receta_stats(${ANIO}, current_date, NULL, 'todas', 'losartan', false)` },
  { clave: 'ventas-stats-mes',         nota: 'Ventas · tarjetas del mes',
    sql: `SELECT * FROM public.get_ventas_stats(${MES}, current_date, NULL, NULL)` },
  { clave: 'ventas-lista-mes',         nota: 'Ventas · lista (lectura directa de la tabla)',
    sql: `SELECT id, fecha, hora, total FROM public.sales_invoices WHERE fecha >= ${MES} ORDER BY fecha DESC, hora DESC LIMIT 50` },
  { clave: 'productos-del-mes',        nota: 'Ventas › Productos',
    sql: `SELECT public.get_product_sales_agg_jsonb(${MES}, current_date, NULL, NULL)` },
  { clave: 'producto-detalle-mes',     nota: 'Ventas › abrir un producto (totales)',
    sql: `SELECT public.get_product_drill_summary(${PRODUCTO}, ${MES}, current_date, NULL)` },
  { clave: 'producto-lineas-mes',      nota: 'Ventas › abrir un producto (renglones)',
    sql: `SELECT * FROM public.get_product_drill_lines(${PRODUCTO}, ${MES}, current_date, NULL)` },
  { clave: 'producto-tendencia',       nota: 'Ventas › abrir un producto (tendencia)',
    sql: `SELECT * FROM public.get_product_trend(${PRODUCTO}, NULL, ${MES}, current_date)` },
  { clave: 'top-productos-mes',        nota: 'Inicio · top productos',
    sql: `SELECT * FROM public.get_top_productos_mes(${MES}, current_date, 10)` },
  { clave: 'metas-mes',                nota: 'Metas · mes en curso',
    sql: `SELECT public.get_metas_mes_en_curso(4)` },
  // ── Inventario y traslados ──
  { clave: 'faltantes-otra-sala',      nota: 'Inicio · faltantes con stock en otra sala',
    sql: `SELECT * FROM public.get_faltantes_con_stock_en_otra_sala(1, 40)` },
  { clave: 'donde-hay',                nota: 'Traslados · dónde hay un producto',
    sql: `SELECT public.get_donde_hay(187, 1)` },
  { clave: 'traslado-disponibilidad',  nota: 'Traslados · aprobar una solicitud',
    sql: `SELECT public.get_traslado_disponibilidad((SELECT id FROM public.approval_requests WHERE type = 'INVENTORY_TRANSFER_REQUEST' ORDER BY created_at DESC LIMIT 1))` },
  { clave: 'traslados-por-recibir',    nota: 'Traslados · por recibir',
    sql: `SELECT public.get_traslados_por_recibir(NULL)` },
  { clave: 'envios-vivos',             nota: 'Envíos · vivos',
    sql: `SELECT * FROM public.get_envios_vivos()` },
  { clave: 'envios-historial',         nota: 'Envíos · historial',
    sql: `SELECT * FROM public.get_envios_historial(100)` },
  { clave: 'buscar-inventario',        nota: 'Inicio · buscador de inventario',
    sql: `SELECT public.buscar_inventario_global_v2('amoxicilina', 60)` },
  { clave: 'inventario-agrupado',      nota: 'Inventario · vista con búsqueda',
    sql: `SELECT * FROM public.inventory_grouped(p_erp_id => 1, p_search => 'amoxicilina', p_limit => 25)` },
  { clave: 'costo-inventario',         nota: 'Inventario · costo de la sala',
    sql: `SELECT * FROM public.get_inventory_cost_summary(1)` },
  { clave: 'stock-analysis',           nota: 'Mín·Máx · análisis de la sala',
    sql: `SELECT public.get_stock_analysis_jsonb(1)` },
  { clave: 'conteo-productos',         nota: 'Conteo cíclico · página de productos',
    sql: `SELECT * FROM public.get_conteo_products_page((SELECT id FROM public.conteos_inventario ORDER BY created_at DESC LIMIT 1), NULL, 'TODOS', 25, 0, NULL, NULL, 'asc', NULL)` },
  { clave: 'conteos-30d',              nota: 'Conteo cíclico · lista',
    sql: `SELECT * FROM public.get_conteos(current_date - 30, current_date)` },
  // ── Pedidos ──
  { clave: 'pedido-generar',           nota: 'Pedidos · tablero de generar',
    sql: `SELECT * FROM public.get_pedido_generar_dashboard()` },
  { clave: 'pedido-costo-borrador',    nota: 'Pedidos · costo del borrador',
    sql: `SELECT * FROM public.get_draft_cost_estimate(1)` },
  { clave: 'pedido-resumen-ingreso',   nota: 'Pedidos · resumen de ingreso (20 pedidos)',
    sql: `SELECT * FROM public.resumen_ingreso_pedidos(ARRAY(SELECT id FROM public.pedidos ORDER BY created_at DESC LIMIT 20))` },
  { clave: 'pedido-items',             nota: 'Pedidos · renglones (lectura directa)',
    sql: `SELECT * FROM public.pedido_items WHERE pedido_id = (SELECT id FROM public.pedidos ORDER BY created_at DESC LIMIT 1)` },
  // ── Caja, facturación, solicitudes ──
  { clave: 'caja-estado',              nota: 'Mi caja · estado',
    sql: `SELECT public.caja_estado(4)` },
  { clave: 'pendiente-mh',             nota: 'Facturación · Pendiente MH',
    sql: `SELECT public.get_pending_mh_invoices(NULL)` },
  { clave: 'solicitudes-pendientes',   nota: 'Solicitudes · bandeja (lectura directa)',
    sql: `SELECT id, type, status, created_at FROM public.approval_requests WHERE status = 'PENDING' ORDER BY created_at DESC LIMIT 50` },
];

/* Funciones VOLATILE que se leyeron a mano y no escriben. Se vuelven a revisar
 * en cada corrida (ver `SQL_REVISION`): la lista dice «se miró», no «es seguro
 * para siempre». */
const VOLATILES_REVISADAS = {
  get_draft_cost_estimate:      'sólo SELECT; revisado 2026-09-22',
  get_pedido_generar_dashboard: 'sólo SELECT; revisado 2026-09-22',
  inventory_grouped:            'sólo SELECT; revisado 2026-09-22',
};

const IDENTIDADES = `
  SELECT 'postgres'::text AS ident, 'postgres'::text AS rol, ''::text AS claims
  UNION ALL
  (SELECT 'usuario · todas', 'authenticated',
          json_build_object('sub', l.auth_user_id, 'role', 'authenticated')::text
     FROM public.employee_auth_accounts l
     JOIN public.employees e ON e.id = l.employee_id
     JOIN public.roles r ON r.id = e.role_id
    WHERE r.name = 'QA / Testing (CI)' AND e.status = 'ACTIVO'
    ORDER BY l.auth_user_id LIMIT 1)
  UNION ALL
  (SELECT 'usuario · sala', 'authenticated',
          json_build_object('sub', l.auth_user_id, 'role', 'authenticated')::text
     FROM public.employee_auth_accounts l
     JOIN public.employees e ON e.id = l.employee_id
     JOIN public.role_permissions rp ON rp.role_id = e.role_id
                                    AND rp.module_key = 'ventas' AND rp.can_view AND rp.scope <> 'ALL'
    -- Salud 1 (branch 4): la misma sala que usan las llamadas de abajo.
    WHERE e.status = 'ACTIVO' AND e.branch_id = 4
    ORDER BY e.id LIMIT 1)`;

// Toda función que aparezca en las llamadas, con su volatilidad y si su cuerpo
// escribe algo. Una sola consulta para toda la corrida.
const nombresDeFunciones = (sql) =>
  [...sql.matchAll(/public\.([a-z_0-9]+)\s*\(/g)].map(m => m[1]);

const SQL_REVISION = (nombres) => `
  SELECT p.proname AS nombre, p.provolatile AS vol,
         p.prosrc ~* '\\m(insert\\s+into|update\\s+\\w|delete\\s+from|merge\\s+into|truncate|refresh\\s+materialized)\\M' AS escribe
    FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
     AND p.proname = ANY (ARRAY[${nombres.map(n => `'${n}'`).join(',')}])`;

function sqlDeUnaLlamada(sql) {
  const q = sql.replaceAll('$Q$', '');   // el delimitador no puede aparecer adentro
  return `
CREATE TEMP TABLE IF NOT EXISTS _m (ident text, bloques bigint, ms numeric, filas bigint, huella text, error text);
GRANT ALL ON _m TO authenticated;
DO $do$
DECLARE idn record; pv json; n bigint; h text;
BEGIN
  FOR idn IN ${IDENTIDADES} LOOP
    PERFORM set_config('request.jwt.claims', idn.claims, true);
    BEGIN
      IF idn.rol = 'authenticated' THEN EXECUTE 'SET LOCAL ROLE authenticated'; END IF;
      EXECUTE 'EXPLAIN (ANALYZE, BUFFERS, TIMING OFF, FORMAT JSON) ' || $Q$${q}$Q$ INTO pv;
      EXECUTE format('SELECT count(*), md5(coalesce(string_agg(t::text, %L ORDER BY t::text), %L)) FROM (%s) t',
                     '|', '', $Q$${q}$Q$) INTO n, h;
      EXECUTE 'RESET ROLE';
      INSERT INTO _m VALUES (idn.ident,
        coalesce((pv->0->'Plan'->>'Shared Hit Blocks')::bigint, 0) + coalesce((pv->0->'Plan'->>'Shared Read Blocks')::bigint, 0),
        (pv->0->>'Execution Time')::numeric, n, h, NULL);
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO _m VALUES (idn.ident, NULL, NULL, NULL, NULL, left(SQLERRM, 140));
    END;
  END LOOP;
END $do$;
SELECT * FROM _m;`;
}

// ── main ──
const args = process.argv.slice(2);
const soloIdx = args.indexOf('--solo');
const solo = soloIdx >= 0 ? new Set(args[soloIdx + 1].split(',')) : null;
const jsonIdx = args.indexOf('--json');
const salidaJson = jsonIdx >= 0 ? args[jsonIdx + 1] : null;
const llamadas = LLAMADAS.filter(l => !solo || solo.has(l.clave));

const canal = abrirCanal('medir-como-usuario');
const gris = (s) => `\x1b[90m${s}\x1b[0m`;
const rojo = (s) => `\x1b[31m${s}\x1b[0m`;
const amarillo = (s) => `\x1b[33m${s}\x1b[0m`;
const MB = (b) => b == null ? '—' : `${Math.round(b * 8 / 1024).toLocaleString('es')} MB`;
const ms = (x) => x == null ? '—' : `${Math.round(Number(x)).toLocaleString('es')} ms`;
// md5 de una fila con un solo NULL ('()') y de ninguna fila (''), tal como las
// arma `string_agg(t::text …)`.
const HUELLA_FILA_NULA = 'bcd8b0c2eb1fce714eab6cef0d771acc';   // md5('()')
const HUELLA_VACIA = 'd41d8cd98f00b204e9800998ecf8427e';
const fl = (x) => x?.filas == null ? '' : gris(`${x.filas}f`);

try {
  const todas = [...new Set(llamadas.flatMap(l => nombresDeFunciones(l.sql)))];
  const revision = canal.consultar(SQL_REVISION(todas));
  const porNombre = Object.fromEntries(revision.map(f => [f.nombre, f]));
  const resultados = [];

  /* ── 1 · Lo que producción ya midió, llamada por llamada y por rol ──────────
   * `pg_stat_statements` guarda el costo de CADA consulta con el rol que la
   * ejecutó: para `authenticated` es exactamente «como usuario», para todas las
   * llamadas del portal y sin manifiesto. Es la lista completa; el manifiesto de
   * abajo sirve para explicar las que destacan (¿es el RLS o es el plan?). */
  if (!solo) {
    const ranking = canal.consultar(`
      SELECT r.rolname AS rol,
             coalesce(substring(s.query from '"public"\\."([a-z_0-9]+)"\\('),
                      substring(s.query from 'FROM "public"\\."([a-z_0-9]+)"'),
                      left(regexp_replace(s.query, '\\s+', ' ', 'g'), 40)) AS objeto,
             sum(s.calls)::bigint AS llamadas,
             round(sum(s.shared_blks_hit + s.shared_blks_read) * 8 / 1024.0 / 1024.0, 1) AS gb,
             round(sum(s.shared_blks_hit + s.shared_blks_read)::numeric / greatest(sum(s.calls), 1)) AS bloques_llamada,
             round((sum(s.total_exec_time) / greatest(sum(s.calls), 1))::numeric, 1) AS ms_media
        FROM extensions.pg_stat_statements s JOIN pg_roles r ON r.oid = s.userid
       WHERE r.rolname IN ('authenticated', 'anon', 'service_role')
         AND s.query !~* '^\\s*(DO|EXPLAIN|VACUUM|ANALYZE|CREATE)'
       GROUP BY 1, 2
       ORDER BY gb DESC LIMIT 20`);
    const desde = canal.consultar(`SELECT to_char(min(stats_reset), 'YYYY-MM-DD HH24:MI') AS d FROM extensions.pg_stat_statements_info`)[0]?.d;
    console.log(`\n  1 · Lo que ya costó en producción, por rol ${gris(`(desde ${desde ?? 'el último reinicio'})`)}\n`);
    for (const f of ranking)
      console.log(`  ${String(f.gb).padStart(8)} GB  ${String(f.llamadas).padStart(8)} llamadas  `
                + `${MB(f.bloques_llamada).padStart(9)}/llamada  ${ms(f.ms_media).padStart(8)}  ${gris(f.rol.padEnd(13))} ${f.objeto}`);
  }

  console.log(`\n  2 · Medido ahora, como postgres y como usuario — ${llamadas.length} llamadas × 3 identidades\n`);
  for (const l of llamadas) {
    const peligrosas = nombresDeFunciones(l.sql).filter(n => {
      const f = porNombre[n];
      if (!f) return false;                                   // no es una función (p. ej. una tabla)
      if (f.escribe === true || f.escribe === 't') return true;
      return f.vol === 'v' && !VOLATILES_REVISADAS[n];
    });
    if (peligrosas.length) {
      console.log(`  ${rojo('✗ no se mide')} ${l.clave} — ${peligrosas.join(', ')} puede escribir`);
      resultados.push({ ...l, omitida: `puede escribir: ${peligrosas.join(', ')}` });
      continue;
    }
    let filas;
    try { filas = canal.consultar(sqlDeUnaLlamada(l.sql)); }
    catch (e) {
      console.log(`  ${rojo('✗')} ${l.clave} — no se pudo medir: ${(e.detalleCli || e.message).split('\n')[0]}`);
      resultados.push({ ...l, omitida: 'no se pudo medir' });
      continue;
    }
    const por = Object.fromEntries(filas.map(f => [f.ident, f]));
    const pg = por['postgres'], tot = por['usuario · todas'], sala = por['usuario · sala'];
    const marcas = [];
    const bPg = Number(pg?.bloques), bTot = Number(tot?.bloques);
    /* Sin JWT, una función con compuerta de permiso propia (`IF NOT
     * auth_has_module_permission(...)`) devuelve NULL o nada: `postgres` no
     * midió el trabajo y cualquier comparación con él es falsa. Pasó en la
     * primera corrida con `get_conteos`, que salió «rls×14» sin tener nada que
     * ver con el RLS. */
    const pgNoMidio = pg?.huella && (pg.huella === HUELLA_FILA_NULA || pg.huella === HUELLA_VACIA)
                      && tot?.huella && tot.huella !== pg.huella;
    if (pgNoMidio) marcas.push(gris('pg sin permiso'));
    else {
      if (pg?.bloques != null && tot?.bloques != null && bTot >= 5000 && bTot >= 3 * Math.max(bPg, 1))
        marcas.push(rojo(`rls×${Math.round(bTot / Math.max(bPg, 1))}`));
      if (pg?.huella && tot?.huella && pg.huella !== tot.huella) marcas.push(amarillo('distinto'));
    }
    const peor = Math.max(...[pg, tot, sala].map(x => Number(x?.bloques ?? 0)));
    if (peor >= 25000) marcas.push(amarillo('pesada'));
    const peorMs = Math.max(...[pg, tot, sala].map(x => Number(x?.ms ?? 0)));
    if (peorMs >= 500) marcas.push(amarillo('lenta'));
    for (const x of [tot, sala]) if (x?.error) marcas.push(gris(`${x.ident}: ${x.error}`));

    console.log(`  ${l.clave.padEnd(24)} ${gris('pg')} ${MB(pg?.bloques).padStart(9)} ${ms(pg?.ms).padStart(8)} ${fl(pg)}`
              + `  ${gris('todas')} ${MB(tot?.bloques).padStart(9)} ${ms(tot?.ms).padStart(8)} ${fl(tot)}`
              + `  ${gris('sala')} ${MB(sala?.bloques).padStart(9)} ${ms(sala?.ms).padStart(8)} ${fl(sala)}  ${marcas.join(' ')}`);
    resultados.push({ ...l, postgres: pg, usuario_todas: tot, usuario_sala: sala });
  }

  if (salidaJson) {
    writeFileSync(salidaJson, JSON.stringify({ medido: new Date().toISOString(), resultados }, null, 2));
    console.log(gris(`\n  guardado en ${salidaJson}`));
  }
  console.log(gris(`
  rls×N    el usuario de alcance total lee N veces lo que lee postgres (≥5,000 bloques)
  distinto el usuario de alcance total no ve lo mismo que postgres
  pesada   ≥195 MB por llamada en alguna identidad · lenta ≥500 ms`));
} finally {
  canal.cerrar();
}
