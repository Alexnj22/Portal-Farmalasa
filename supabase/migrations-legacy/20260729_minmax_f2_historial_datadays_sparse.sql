-- F2 — Integridad de datos: historial de una sola fuente, denominador real de
-- velocidad, y limpieza de los sparse_data zombis.
--
-- ══ F2.1 · El historial se escribia por DOS caminos ══
--
-- 1. trg_psp_capture_history (BEFORE UPDATE FOR EACH ROW) inserta el estado
--    VIEJO cada vez que cambia min_units/max_units/daily_velocity.
-- 2. publish_stock_params, calculate_stock_params y approve_minmax_request
--    insertaban ADEMAS el estado NUEVO.
--
-- Resultado: 13,198 pares en el mismo segundo sobre 41,766 filas, y como
-- fetchStockParamsHistory ordenaba solo por captured_at, el "antes" podia
-- pintarse despues del "despues".
--
-- Se elige UNA fuente: el trigger. Es el unico que captura TODO cambio venga de
-- donde venga (incluido un UPDATE por PostgREST directo, que ninguna RPC ve).
-- El invariante queda: el historial son los estados SUPERADOS, y el estado
-- actual es la fila viva. No se pierde informacion — cada estado se registra
-- cuando deja de ser cierto.
--
-- Las 13,198 duplicadas NO se borran: son historia real, solo redundante. El
-- corte es esta migracion; de aca en adelante una fila por cambio. El
-- desempate por `id DESC` en el cliente las ordena bien igual (el trigger es
-- BEFORE, asi que su fila siempre tiene id menor que la del insert de la RPC).
--
-- ══ F2.3 · data_days: el denominador real de la velocidad ══
--
-- `velocidad = unidades / cfg.analysis_days` usaba la CONSTANTE de config (180)
-- como divisor, no los dias en que el producto existio. Un producto que se
-- empezo a vender hace 30 dias y lleva 30 unidades daba 30/180 = 0.17/dia en
-- vez de 1/dia: su MIN/MAX salia ~6x mas bajo que su demanda real. Afecta a 270
-- de 3,902 productos con ventas (7%) — 147 arrancaron en los ultimos 90 dias.
--
-- Nota sobre el plan: justificaba esto como guardarrail por si subian
-- analysis_days por encima de los datos disponibles. Esa premisa era falsa —
-- hay ventas completas y uniformes desde 2025-05-01 (454 dias, ~22 mil facturas
-- por mes), asi que analysis_days puede subir a ~450 sin quedarse sin datos.
-- Lo que se implementa (decision de Alex, 2026-07-29) es lo que si arregla algo:
-- el divisor POR PRODUCTO.
--
--   data_days = LEAST(analysis_days,
--                     GREATEST(30, dias desde GREATEST(primera venta HISTORICA, v_from)))
--
-- El piso de 30 dias es para que un producto con 2 dias de historia y una venta
-- grande no salga con una velocidad absurda. El tope es analysis_days.
--
-- OJO CON LA DEFINICION — la primera version de esto usaba la primera venta
-- DENTRO DE LA VENTANA, y eso esta mal: un producto viejo de venta esporadica
-- simplemente no vende el dia 1 de la ventana, asi que su denominador bajaba y
-- su velocidad subia sin ninguna razon. Medido en Salud 1: inflaba a 1,418 de
-- 1,765 productos (80%), +17.4% de media. Con la primera venta HISTORICA (que
-- es la que distingue "producto nuevo" de "producto esporadico") el efecto es
-- el buscado: 45 de 1,765 (2.5%), +2.4% de media, 16 que al menos duplican.
-- Si el producto ya vendia antes de la ventana, la ventana esta cubierta
-- completa y data_days = analysis_days, igual que hoy.
--
-- El mismo denominador se usa para el CV (que alimenta XYZ): velocidad y
-- variabilidad tienen que describir la MISMA ventana, si no el percentil de XYZ
-- compara peras con manzanas.
--
-- ══ F2.5 · Los 424 sparse_data zombis ══
--
-- 417 en Salud 4 y 7 en Salud 5, todos con draft_calculated_at del 16-jun.
-- Un producto marcado 'sparse_data' (1-2 dias de venta en la ventana) que en el
-- siguiente recalculo ya no tiene NINGUNA venta no aparece en `stats`, asi que
-- ningun upsert lo toca y se queda marcado para siempre.
-- Ahora, al terminar, se resetean a 'none' los sparse_data de la(s) sucursal(es)
-- recalculada(s) cuyo draft_calculated_at quedo viejo — o sea, los que este
-- recalculo no volvio a escribir. Va como sentencia APARTE y no como CTE del
-- statement grande a proposito: dos escrituras a la misma fila dentro de un
-- mismo statement (el ON CONFLICT del upsert y este UPDATE) es comportamiento
-- indefinido en Postgres.
--
-- ══ F2.8 · Paridad de ocultos ══
--
-- El trigger de Bodega excluye is_hidden de la Σ; el bloque de Bodega de
-- publish_stock_params no. Era la misma suma calculada de dos formas. Se iguala.
-- Verificado que hoy no cambia ningun numero: de las 48 filas ocultas en
-- sucursales, 0 tienen min/max > 0.

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.calculate_stock_params(p_erp_sucursal_id integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  cfg             public.stock_config%ROWTYPE;
  v_from          date;
  v_now           timestamptz := NOW();
  v_count         integer := 0;
  v_auto_applied  integer := 0;
  v_sparse_reset  integer := 0;
  v_lock          public.module_locks%ROWTYPE;
BEGIN
  -- Candado de mantenimiento: aplica INCLUSO a service_role.
  IF public.auth_module_locked(ARRAY['minmax','pedidos']) THEN
    SELECT * INTO v_lock
    FROM public.module_locks
    WHERE module_key = ANY(ARRAY['minmax','pedidos'])
      AND expires_at > now()
    ORDER BY locked_at
    LIMIT 1;

    IF (SELECT auth.role()) IS NOT DISTINCT FROM 'service_role' THEN
      RETURN jsonb_build_object(
        'ok',              false,
        'skipped',         true,
        'reason',          'module_locked',
        'locked_by',       v_lock.locked_by_name,
        'locked_module',   v_lock.module_key,
        'erp_sucursal_id', p_erp_sucursal_id
      );
    END IF;

    RAISE EXCEPTION 'MODULE_LOCKED: % esta en mantenimiento por % — no se puede recalcular',
      v_lock.module_key, v_lock.locked_by_name;
  END IF;

  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' AND NOT auth_can_edit_any(ARRAY['minmax']) THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: se requiere permiso de edición en Min/Max';
  END IF;

  IF p_erp_sucursal_id = 6 THEN
    RETURN jsonb_build_object(
      'ok',      false,
      'skipped', true,
      'reason',  'bodega_not_calculated_here — su MIN/MAX real viene de trg_bodega_draft_sync (SUM de sucursales), no de este cálculo independiente'
    );
  END IF;

  SET LOCAL work_mem = '128MB';
  SELECT * INTO cfg FROM public.stock_config WHERE id = 1;
  v_from := CURRENT_DATE - (cfg.analysis_days || ' days')::interval;

  -- Saltar sucursal si tiene borradores pendientes de revisión manual.
  -- Los OCULTOS no cuentan: su borrador es inalcanzable desde la UI y este
  -- mismo cálculo no los toca, así que bloqueaban la sucursal para siempre.
  IF p_erp_sucursal_id IS NOT NULL THEN
    PERFORM 1 FROM product_stock_params
    WHERE erp_sucursal_id = p_erp_sucursal_id
      AND draft_status = 'pending'
      AND is_hidden IS NOT TRUE
    LIMIT 1;
    IF FOUND THEN
      RETURN jsonb_build_object(
        'ok',               false,
        'skipped',          true,
        'reason',           'branch_has_pending_drafts',
        'erp_sucursal_id',  p_erp_sucursal_id
      );
    END IF;
  END IF;

  WITH branch_map AS (
    SELECT branch_id AS bid, erp_sucursal_id AS esid
    FROM erp_sucursal_map
    WHERE es_bodega = false
  ),
  daily AS MATERIALIZED (
    SELECT
      bm.esid                                                                           AS erp_sucursal_id,
      ii.erp_product_id,
      inv.fecha,
      SUM(ii.cantidad::numeric
          * ii.factor_unidades) AS units,
      SUM(ii.total_linea)                                                               AS rev
    FROM sales_invoice_items ii
    JOIN sales_invoices inv ON inv.id = ii.invoice_id
    JOIN branch_map bm      ON bm.bid = inv.branch_id
    WHERE inv.fecha         >= v_from
      AND inv.estado        != 'ANULADA'
      AND ii.erp_product_id IS NOT NULL
      AND ii.cantidad        > 0
      AND (p_erp_sucursal_id IS NULL OR bm.esid = p_erp_sucursal_id)
      AND NOT EXISTS (
        SELECT 1 FROM products p
        JOIN laboratorios l ON l.id = p.laboratorio_id
        WHERE p.id = ii.erp_product_id AND l.ocultar_en_minmax = true
      )
    GROUP BY bm.esid, ii.erp_product_id, inv.fecha
  ),
  daily_p95 AS (
    SELECT
      erp_sucursal_id,
      erp_product_id,
      PERCENTILE_CONT(cfg.outlier_percentile::float / 100.0)
          WITHIN GROUP (ORDER BY units) AS cap
    FROM daily
    GROUP BY erp_sucursal_id, erp_product_id
  ),
  -- F2.3: primera venta HISTORICA por producto/sucursal — sin filtro de fecha
  -- a proposito. Es lo unico que distingue un producto nuevo (que no pudo
  -- vender en los dias que no existia) de uno viejo con venta esporadica.
  primera_venta AS (
    SELECT bm.esid AS erp_sucursal_id, ii.erp_product_id, MIN(inv.fecha) AS primera
    FROM sales_invoice_items ii
    JOIN sales_invoices inv ON inv.id = ii.invoice_id
    JOIN branch_map bm      ON bm.bid = inv.branch_id
    WHERE inv.estado        != 'ANULADA'
      AND ii.erp_product_id IS NOT NULL
      AND ii.cantidad        > 0
      AND (p_erp_sucursal_id IS NULL OR bm.esid = p_erp_sucursal_id)
    GROUP BY bm.esid, ii.erp_product_id
  ),
  -- Las sumas y el denominador real, separados del calculo de la velocidad para
  -- poder reusar data_days (un alias no se puede referenciar en el mismo SELECT).
  stats_raw AS (
    SELECT
      d.erp_sucursal_id,
      d.erp_product_id,
      SUM(d.units)::integer                                       AS sold_period,
      SUM(d.rev)                                                  AS rev_period,
      SUM(LEAST(d.units, p.cap))::numeric                         AS units_w,
      SUM(LEAST(d.units, p.cap) * LEAST(d.units, p.cap))::numeric AS units_w_sq,
      SUM(CASE WHEN d.fecha >= CURRENT_DATE - 30 THEN d.units ELSE 0 END)::numeric AS units_30d,
      LEAST(cfg.analysis_days,
            GREATEST(30, (CURRENT_DATE - GREATEST(COALESCE(pv.primera, v_from), v_from))::int + 1)) AS data_days,
      COUNT(DISTINCT d.fecha)                                     AS dias
    FROM daily d
    JOIN daily_p95 p ON p.erp_sucursal_id = d.erp_sucursal_id
                    AND p.erp_product_id  = d.erp_product_id
    LEFT JOIN primera_venta pv ON pv.erp_sucursal_id = d.erp_sucursal_id
                              AND pv.erp_product_id  = d.erp_product_id
    GROUP BY d.erp_sucursal_id, d.erp_product_id, pv.primera
    HAVING COUNT(DISTINCT d.fecha) >= 1
  ),
  stats AS (
    SELECT
      erp_sucursal_id, erp_product_id, sold_period, rev_period, data_days, dias,
      units_w / data_days   AS velocity,
      units_30d / 30        AS velocity_30d,
      ROUND((
        SQRT(GREATEST(0, units_w_sq / data_days - POWER(units_w / data_days, 2)))
        / NULLIF(units_w / data_days, 0) * 100
      )::numeric, 1) AS cv
    FROM stats_raw
  ),
  ranked AS (
    SELECT *,
      PERCENT_RANK() OVER (PARTITION BY erp_sucursal_id ORDER BY cv) AS cv_pctile,
      SUM(rev_period) OVER (
        PARTITION BY erp_sucursal_id
        ORDER BY rev_period DESC
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
      )                                                    AS cum_rev,
      SUM(rev_period) OVER (PARTITION BY erp_sucursal_id) AS tot_rev
    FROM stats
    WHERE dias >= 3
  ),
  lead_times AS MATERIALIZED (
    SELECT erp_product_id, erp_sucursal_id, lead_time_days
    FROM product_stock_params
    WHERE lead_time_days IS NOT NULL AND erp_sucursal_id != 6
  ),
  classified AS (
    SELECT r.*,
      CASE
        WHEN r.tot_rev = 0                                               THEN 'D'
        WHEN (r.cum_rev - r.rev_period) / r.tot_rev < cfg.abc_a_pct/100 THEN 'A'
        WHEN (r.cum_rev - r.rev_period) / r.tot_rev < cfg.abc_b_pct/100 THEN 'B'
        ELSE                                                                  'C'
      END AS abc,
      CASE
        WHEN r.cv_pctile <= cfg.xyz_x_percentile / 100.0 THEN 'X'
        WHEN r.cv_pctile <= cfg.xyz_y_percentile / 100.0 THEN 'Y'
        ELSE                               'Z'
      END AS xyz,
      COALESCE(lt.lead_time_days,
        CASE
          WHEN r.cv_pctile <= cfg.xyz_x_percentile / 100.0 THEN cfg.reorder_x_days + cfg.buffer_x_days
          WHEN r.cv_pctile <= cfg.xyz_y_percentile / 100.0 THEN cfg.reorder_y_days + cfg.buffer_y_days
          ELSE                               cfg.reorder_z_days + cfg.buffer_z_days
        END
      ) AS effective_lead_days
    FROM ranked r
    LEFT JOIN lead_times lt ON lt.erp_product_id = r.erp_product_id
                            AND lt.erp_sucursal_id = r.erp_sucursal_id
  ),
  with_min AS (
    SELECT *,
      GREATEST(
        FLOOR(velocity * effective_lead_days)::int,
        CASE WHEN CEIL(velocity * cfg.cycle_days)::int > 1 THEN 1 ELSE 0 END
      ) AS computed_min
    FROM classified
  ),
  main_upsert AS (
    INSERT INTO product_stock_params (
      erp_product_id, erp_sucursal_id,
      draft_abc_class, draft_velocity, draft_velocity_30d, draft_cv, draft_demand_variability,
      draft_min, draft_max,
      calc_min, calc_max,
      draft_units_sold, draft_revenue, draft_data_days,
      draft_calculated_at, draft_status,
      updated_at
    )
    SELECT
      erp_product_id, erp_sucursal_id,
      abc,
      ROUND(velocity::numeric, 6),
      ROUND(velocity_30d::numeric, 6),
      cv, xyz,
      computed_min,
      GREATEST(CEIL(velocity * cfg.cycle_days)::int, computed_min + 1, 1),
      computed_min,
      GREATEST(CEIL(velocity * cfg.cycle_days)::int, computed_min + 1, 1),
      sold_period, rev_period, data_days,
      v_now, 'pending',
      v_now
    FROM with_min
    ON CONFLICT (erp_product_id, erp_sucursal_id) DO UPDATE SET
      abc_class                  = EXCLUDED.draft_abc_class,
      daily_velocity              = EXCLUDED.draft_velocity,
      velocity_30d                 = EXCLUDED.draft_velocity_30d,
      cv                           = EXCLUDED.draft_cv,
      demand_variability            = EXCLUDED.draft_demand_variability,
      units_sold_6m                 = EXCLUDED.draft_units_sold,
      revenue_6m                    = EXCLUDED.draft_revenue,
      calculated_at                 = EXCLUDED.draft_calculated_at,
      draft_abc_class            = EXCLUDED.draft_abc_class,
      draft_velocity             = EXCLUDED.draft_velocity,
      draft_velocity_30d         = EXCLUDED.draft_velocity_30d,
      draft_cv                   = EXCLUDED.draft_cv,
      draft_demand_variability   = EXCLUDED.draft_demand_variability,
      draft_min                  = EXCLUDED.draft_min,
      draft_max                  = EXCLUDED.draft_max,
      calc_min                   = EXCLUDED.calc_min,
      calc_max                   = EXCLUDED.calc_max,
      draft_units_sold           = EXCLUDED.draft_units_sold,
      draft_revenue              = EXCLUDED.draft_revenue,
      draft_data_days            = EXCLUDED.draft_data_days,
      draft_calculated_at        = EXCLUDED.draft_calculated_at,
      draft_status               = CASE
        WHEN product_stock_params.min_units IS NULL
          OR product_stock_params.min_units  IS DISTINCT FROM EXCLUDED.draft_min
          OR product_stock_params.max_units  IS DISTINCT FROM EXCLUDED.draft_max
        THEN 'pending'
        ELSE 'none'
      END,
      updated_at                 = EXCLUDED.updated_at
    WHERE product_stock_params.is_hidden IS NOT TRUE
    RETURNING erp_product_id
  ),
  sparse_upsert AS (
    INSERT INTO product_stock_params (
      erp_product_id, erp_sucursal_id,
      draft_abc_class, draft_velocity, draft_velocity_30d, draft_cv, draft_demand_variability,
      draft_min, draft_max,
      calc_min, calc_max,
      draft_units_sold, draft_revenue, draft_data_days,
      draft_calculated_at, draft_status,
      updated_at
    )
    SELECT
      erp_product_id, erp_sucursal_id,
      NULL,
      ROUND(velocity::numeric, 6),
      ROUND(velocity_30d::numeric, 6),
      NULL, NULL,
      NULL, NULL,
      NULL, NULL,
      sold_period, rev_period, data_days,
      v_now, 'sparse_data',
      v_now
    FROM stats
    WHERE dias BETWEEN 1 AND 2
    ON CONFLICT (erp_product_id, erp_sucursal_id) DO UPDATE SET
      draft_abc_class            = NULL,
      draft_velocity             = EXCLUDED.draft_velocity,
      draft_velocity_30d         = EXCLUDED.draft_velocity_30d,
      draft_cv                   = NULL,
      draft_demand_variability   = NULL,
      draft_min                  = NULL,
      draft_max                  = NULL,
      calc_min                   = NULL,
      calc_max                   = NULL,
      draft_units_sold           = EXCLUDED.draft_units_sold,
      draft_revenue              = EXCLUDED.draft_revenue,
      draft_data_days            = EXCLUDED.draft_data_days,
      draft_calculated_at        = EXCLUDED.draft_calculated_at,
      draft_status               = 'sparse_data',
      updated_at                 = EXCLUDED.updated_at
    WHERE product_stock_params.is_hidden IS NOT TRUE
    RETURNING erp_product_id
  )
  SELECT COUNT(*) INTO v_count
  FROM (
    SELECT erp_product_id FROM main_upsert
    UNION ALL
    SELECT erp_product_id FROM sparse_upsert
  ) combined;

  -- F2.5: los sparse_data que este recalculo NO volvio a escribir ya no tienen
  -- ni una venta en la ventana: dejan de ser "datos escasos".
  UPDATE product_stock_params
  SET draft_status             = 'none',
      draft_abc_class          = NULL,
      draft_velocity           = NULL,
      draft_velocity_30d       = NULL,
      draft_cv                 = NULL,
      draft_demand_variability = NULL,
      draft_units_sold         = NULL,
      draft_revenue            = NULL,
      draft_data_days          = NULL,
      draft_min                = NULL,
      draft_max                = NULL,
      draft_calculated_at      = NULL,
      updated_at               = v_now
  WHERE draft_status = 'sparse_data'
    AND erp_sucursal_id != 6
    AND (p_erp_sucursal_id IS NULL OR erp_sucursal_id = p_erp_sucursal_id)
    AND (draft_calculated_at IS NULL OR draft_calculated_at < v_now);

  GET DIAGNOSTICS v_sparse_reset = ROW_COUNT;

  -- F2.1: sin INSERT a product_stock_params_history — lo escribe
  -- trg_psp_capture_history, que ve este UPDATE igual que cualquier otro.
  WITH auto_apply AS (
    UPDATE product_stock_params psp
    SET
      abc_class                = psp.draft_abc_class,
      daily_velocity           = psp.draft_velocity,
      velocity_30d             = psp.draft_velocity_30d,
      cv                       = psp.draft_cv,
      demand_variability       = psp.draft_demand_variability,
      min_units                = psp.draft_min,
      max_units                = psp.draft_max,
      units_sold_6m            = psp.draft_units_sold,
      revenue_6m               = psp.draft_revenue,
      data_days                = psp.draft_data_days,
      calculated_at            = psp.draft_calculated_at,
      draft_min                = NULL,
      draft_max                = NULL,
      draft_abc_class          = NULL,
      draft_demand_variability = NULL,
      draft_cv                 = NULL,
      draft_velocity           = NULL,
      draft_velocity_30d       = NULL,
      draft_units_sold         = NULL,
      draft_revenue            = NULL,
      draft_data_days          = NULL,
      draft_calculated_at      = NULL,
      draft_status             = 'none',
      published_at             = v_now,
      published_by             = 'auto',
      updated_at                = v_now
    WHERE psp.draft_status = 'pending'
      AND psp.erp_sucursal_id != 6
      AND (p_erp_sucursal_id IS NULL OR psp.erp_sucursal_id = p_erp_sucursal_id)
      AND psp.is_hidden IS NOT TRUE
      AND COALESCE(psp.min_units, 0) > 0
      AND COALESCE(psp.draft_min,  0) > 0
      AND COALESCE(psp.draft_max,  0) > 0
      AND ABS(psp.draft_min - psp.min_units)::numeric / GREATEST(psp.min_units, 1) <= 0.40
      AND ABS(psp.draft_max - psp.max_units)::numeric / GREATEST(psp.max_units, 1) <= 0.40
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_auto_applied FROM auto_apply;

  RETURN jsonb_build_object(
    'ok', true, 'rows', v_count,
    'auto_applied', v_auto_applied,
    'drafted', GREATEST(v_count - v_auto_applied, 0),
    'sparse_reset', v_sparse_reset,
    'at', v_now
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.calculate_stock_params(integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.calculate_stock_params(integer) TO authenticated, service_role;


-- ── publish_stock_params: F2.1 (sin insert de historial) + F2.8 (ocultos) ──

CREATE OR REPLACE FUNCTION public.publish_stock_params(p_erp_sucursal_id integer DEFAULT NULL::integer, p_erp_product_ids integer[] DEFAULT NULL::integer[], p_published_by text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_count        INTEGER;
  v_bodega_count INTEGER := 0;
  v_now          TIMESTAMPTZ := NOW();
  v_publisher    TEXT := (SELECT auth.email());
BEGIN
  IF NOT auth_can_edit_any(ARRAY['minmax']) THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: se requiere permiso de edición en Min/Max';
  END IF;

  WITH par_ordenado AS (
    SELECT
      psp.id,
      LEAST(COALESCE(psp.draft_min, 0), COALESCE(psp.draft_max, 0))    AS lo,
      GREATEST(COALESCE(psp.draft_min, 0), COALESCE(psp.draft_max, 0)) AS hi
    FROM product_stock_params psp
    WHERE psp.draft_status     = 'pending'
      AND psp.erp_sucursal_id != 6
      AND (p_erp_sucursal_id IS NULL OR psp.erp_sucursal_id = p_erp_sucursal_id)
      AND (p_erp_product_ids IS NULL OR psp.erp_product_id  = ANY(p_erp_product_ids))
  ),
  con_min AS (
    SELECT id, hi, GREATEST(lo, CASE WHEN hi > 1 THEN 1 ELSE 0 END) AS n_min
    FROM par_ordenado
  ),
  par AS (
    SELECT id, n_min,
           CASE WHEN n_min >= 1 THEN GREATEST(hi, n_min + 1) ELSE hi END AS n_max
    FROM con_min
  ),
  published AS (
    UPDATE product_stock_params psp
    SET
      abc_class                = psp.draft_abc_class,
      daily_velocity           = psp.draft_velocity,
      velocity_30d             = psp.draft_velocity_30d,
      cv                       = psp.draft_cv,
      demand_variability       = psp.draft_demand_variability,
      min_units                = par.n_min,
      max_units                = par.n_max,
      units_sold_6m            = psp.draft_units_sold,
      revenue_6m               = psp.draft_revenue,
      data_days                = psp.draft_data_days,
      calculated_at            = psp.draft_calculated_at,
      draft_min                = NULL,
      draft_max                = NULL,
      draft_abc_class          = NULL,
      draft_demand_variability = NULL,
      draft_cv                 = NULL,
      draft_velocity           = NULL,
      draft_velocity_30d       = NULL,
      draft_units_sold         = NULL,
      draft_revenue            = NULL,
      draft_data_days          = NULL,
      draft_calculated_at      = NULL,
      draft_status             = 'none',
      published_at             = v_now,
      published_by             = v_publisher,
      updated_at               = v_now
    FROM par
    WHERE par.id = psp.id
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_count FROM published;

  IF p_erp_sucursal_id IS DISTINCT FROM 6 THEN
    WITH branch_sums AS (
      SELECT
        s.erp_product_id,
        SUM(COALESCE(CASE WHEN s.draft_status = 'pending' THEN s.draft_min ELSE s.min_units END, 0))::integer AS eff_min,
        SUM(COALESCE(CASE WHEN s.draft_status = 'pending' THEN s.draft_max ELSE s.max_units END, 0))::integer AS eff_max,
        SUM(COALESCE(s.min_units, 0))::integer AS pub_min,
        SUM(COALESCE(s.max_units, 0))::integer AS pub_max
      FROM product_stock_params s
      WHERE s.erp_sucursal_id != 6
        AND s.is_hidden IS NOT TRUE          -- F2.8: igual que el trigger de Bodega
        AND (p_erp_product_ids IS NULL OR s.erp_product_id = ANY(p_erp_product_ids))
      GROUP BY s.erp_product_id
      HAVING
        SUM(COALESCE(s.min_units, 0)) > 0
        OR SUM(COALESCE(s.max_units, 0)) > 0
        OR EXISTS (
          SELECT 1 FROM product_stock_params b
          WHERE b.erp_sucursal_id = 6
            AND b.erp_product_id  = s.erp_product_id
            AND b.draft_status    = 'pending'
        )
    ),
    bodega_min AS (
      SELECT
        erp_product_id, eff_min, eff_max, pub_min, pub_max,
        GREATEST(pub_min, CASE WHEN pub_max > 1 THEN 1 ELSE 0 END) AS n_min
      FROM branch_sums
    ),
    bodega AS (
      SELECT
        erp_product_id, eff_min, eff_max, pub_min, pub_max, n_min,
        GREATEST(pub_max, CASE WHEN n_min >= 1 THEN n_min + 1 ELSE 0 END) AS n_max
      FROM bodega_min
    )
    INSERT INTO product_stock_params (
      erp_product_id, erp_sucursal_id,
      min_units, max_units,
      draft_min, draft_max, draft_status,
      published_at, published_by, updated_at
    )
    SELECT
      erp_product_id, 6,
      n_min,
      n_max,
      CASE WHEN eff_min != pub_min OR eff_max != pub_max THEN eff_min ELSE NULL END,
      CASE WHEN eff_min != pub_min OR eff_max != pub_max THEN eff_max ELSE NULL END,
      CASE WHEN eff_min != pub_min OR eff_max != pub_max THEN 'pending' ELSE 'none' END,
      v_now, v_publisher, v_now
    FROM bodega
    ON CONFLICT (erp_product_id, erp_sucursal_id) DO UPDATE SET
      min_units    = EXCLUDED.min_units,
      max_units    = EXCLUDED.max_units,
      draft_min    = EXCLUDED.draft_min,
      draft_max    = EXCLUDED.draft_max,
      draft_status = EXCLUDED.draft_status,
      published_at = EXCLUDED.published_at,
      published_by = EXCLUDED.published_by,
      updated_at   = EXCLUDED.updated_at
    WHERE product_stock_params.is_hidden IS NOT TRUE;

    GET DIAGNOSTICS v_bodega_count = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object(
    'ok',             true,
    'published',      v_count,
    'bodega_updated', v_bodega_count,
    'at',             v_now
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.publish_stock_params(integer, integer[], text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.publish_stock_params(integer, integer[], text) TO authenticated, service_role;


-- ── approve_minmax_request: F2.1 (tercer insertor de historial) ──
--
-- Insertaba el estado NUEVO (y solo min/max, sin velocidad ni ABC). El UPDATE
-- que hace sobre product_stock_params ya dispara trg_psp_capture_history.
-- Si la fila no existia, no hay estado anterior que registrar — el trigger es
-- BEFORE UPDATE, no INSERT, y eso es correcto.

CREATE OR REPLACE FUNCTION public.approve_minmax_request(p_request_id bigint, p_decided_by text DEFAULT NULL::text, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  r public.minmax_change_requests%ROWTYPE;
  v_now timestamptz := now();
  v_publisher text := (SELECT auth.email());
  v_is_hidden boolean;
BEGIN
  UPDATE public.minmax_change_requests
  SET status='approved', decided_by=p_decided_by, decided_at=v_now, decision_note=p_note
  WHERE id = p_request_id AND status = 'pending'
  RETURNING * INTO r;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'REQUEST_NOT_FOUND_OR_NO_PERMISSION';
  END IF;

  IF r.erp_sucursal_id = 6 THEN
    RAISE EXCEPTION 'BODEGA_NOT_APPROVABLE_HERE: Bodega deriva su MIN/MAX de la suma de sucursales (trg_bodega_draft_sync), no admite solicitudes directas';
  END IF;

  SELECT is_hidden INTO v_is_hidden
  FROM public.product_stock_params
  WHERE erp_product_id = r.erp_product_id AND erp_sucursal_id = r.erp_sucursal_id;

  IF v_is_hidden IS TRUE THEN
    RAISE EXCEPTION 'PRODUCT_HIDDEN: el producto está oculto en Min/Max — quitale el ocultamiento antes de aprobar esta solicitud';
  END IF;

  INSERT INTO public.product_stock_params (
    erp_product_id, erp_sucursal_id,
    min_units, max_units,
    manual_min, manual_max,
    published_at, published_by, updated_at
  )
  VALUES (
    r.erp_product_id, r.erp_sucursal_id,
    r.requested_min, r.requested_max,
    NULL, NULL,
    v_now, v_publisher, v_now
  )
  ON CONFLICT (erp_product_id, erp_sucursal_id) DO UPDATE SET
    min_units    = EXCLUDED.min_units,
    max_units    = EXCLUDED.max_units,
    manual_min   = NULL,
    manual_max   = NULL,
    published_at = EXCLUDED.published_at,
    published_by = EXCLUDED.published_by,
    updated_at   = EXCLUDED.updated_at;

  RETURN jsonb_build_object(
    'ok', true,
    'erp_product_id', r.erp_product_id,
    'erp_sucursal_id', r.erp_sucursal_id,
    'requested_by_id', r.requested_by_id,
    'product_name', r.product_name,
    'requested_min', r.requested_min,
    'requested_max', r.requested_max
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.approve_minmax_request(bigint, text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.approve_minmax_request(bigint, text, text) TO authenticated, service_role;
