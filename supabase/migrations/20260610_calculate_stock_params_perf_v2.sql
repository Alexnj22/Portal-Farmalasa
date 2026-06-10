-- calculate_stock_params v2 — optimizaciones de rendimiento:
--   1. SET LOCAL work_mem = '128MB': elimina disk spill (HashAggregate 172k groups → 41 batches en disco)
--   2. stats HAVING >= 1 día + columna `dias`: todos los productos con ventas entran al CTE stats una vez
--   3. ranked filtra WHERE dias >= 3: solo productos con patrón retail confiable se clasifican ABC/XYZ
--   4. Data-modifying CTEs: main_upsert + sparse_upsert comparten el mismo MATERIALIZED daily CTE
--      → 2 scans de sales_invoice_items por sucursal en vez de 4 (elimina re-escaneo para sparse)
--   5. Mismo rediseño en rama Bodega

CREATE OR REPLACE FUNCTION public.calculate_stock_params(p_erp_sucursal_id integer DEFAULT NULL::integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  cfg            public.stock_config%ROWTYPE;
  v_from         date;
  v_count        integer := 0;
  v_count_bodega integer := 0;
BEGIN
  SET LOCAL work_mem = '128MB';
  SELECT * INTO cfg FROM public.stock_config WHERE id = 1;
  v_from := CURRENT_DATE - (cfg.analysis_days || ' days')::interval;

  -- ── Sucursales (no Bodega) ───────────────────────────────────────────────────
  IF p_erp_sucursal_id IS NULL OR p_erp_sucursal_id != 6 THEN
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
            * COALESCE((regexp_match(ii.presentacion,'[0-9]+[xX]([0-9]+)'))[1]::int, 1)) AS units,
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
    -- Todos los productos con >= 1 día de venta (incluye sparse 1-2 días)
    stats AS (
      SELECT
        d.erp_sucursal_id,
        d.erp_product_id,
        SUM(d.units)::integer                                                         AS sold_period,
        SUM(d.rev)                                                                    AS rev_period,
        SUM(LEAST(d.units, p.cap))::numeric / cfg.analysis_days                      AS velocity,
        SUM(CASE WHEN d.fecha >= CURRENT_DATE - 30 THEN d.units ELSE 0 END)::numeric / 30 AS velocity_30d,
        ROUND(
          SQRT(GREATEST(0,
            SUM(LEAST(d.units, p.cap) * LEAST(d.units, p.cap))::numeric / cfg.analysis_days
            - POWER(SUM(LEAST(d.units, p.cap))::numeric / cfg.analysis_days, 2)
          )) / NULLIF(SUM(LEAST(d.units, p.cap))::numeric / cfg.analysis_days, 0) * 100
        ::numeric, 1) AS cv,
        COUNT(DISTINCT d.fecha) AS dias
      FROM daily d
      JOIN daily_p95 p ON p.erp_sucursal_id = d.erp_sucursal_id
                      AND p.erp_product_id  = d.erp_product_id
      GROUP BY d.erp_sucursal_id, d.erp_product_id
      HAVING COUNT(DISTINCT d.fecha) >= 1
    ),
    -- Solo productos con patrón retail confiable (>= 3 días distintos)
    ranked AS (
      SELECT *,
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
          WHEN r.cv <= cfg.xyz_x_cv_max THEN 'X'
          WHEN r.cv <= cfg.xyz_y_cv_max THEN 'Y'
          ELSE                               'Z'
        END AS xyz,
        COALESCE(lt.lead_time_days,
          CASE
            WHEN r.cv <= cfg.xyz_x_cv_max THEN cfg.reorder_x_days + cfg.buffer_x_days
            WHEN r.cv <= cfg.xyz_y_cv_max THEN cfg.reorder_y_days + cfg.buffer_y_days
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
    -- Productos normales (dias >= 3): cálculo completo MIN/MAX
    main_upsert AS (
      INSERT INTO product_stock_params (
        erp_product_id, erp_sucursal_id,
        draft_abc_class, draft_velocity, draft_velocity_30d, draft_cv, draft_demand_variability,
        draft_min, draft_max,
        calc_min, calc_max,
        draft_units_sold, draft_revenue,
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
        sold_period, rev_period,
        NOW(), 'pending',
        NOW()
      FROM with_min
      ON CONFLICT (erp_product_id, erp_sucursal_id) DO UPDATE SET
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
        draft_calculated_at        = EXCLUDED.draft_calculated_at,
        draft_status               = CASE
          WHEN product_stock_params.min_units IS NULL
            OR product_stock_params.min_units  IS DISTINCT FROM EXCLUDED.draft_min
            OR product_stock_params.max_units  IS DISTINCT FROM EXCLUDED.draft_max
            OR product_stock_params.abc_class  IS DISTINCT FROM EXCLUDED.draft_abc_class
            OR product_stock_params.demand_variability IS DISTINCT FROM EXCLUDED.draft_demand_variability
          THEN 'pending'
          ELSE 'none'
        END,
        updated_at                 = EXCLUDED.updated_at
      WHERE product_stock_params.is_hidden IS NOT TRUE
      RETURNING erp_product_id
    ),
    -- Productos sparse (dias 1-2): sin MIN/MAX calculado, requiere confirmación manual.
    -- Reutiliza stats CTE — no escanea sales_invoice_items de nuevo.
    sparse_upsert AS (
      INSERT INTO product_stock_params (
        erp_product_id, erp_sucursal_id,
        draft_abc_class, draft_velocity, draft_velocity_30d, draft_cv, draft_demand_variability,
        draft_min, draft_max,
        calc_min, calc_max,
        draft_units_sold, draft_revenue,
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
        sold_period, rev_period,
        NOW(), 'sparse_data',
        NOW()
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
  END IF;

  -- ── Bodega (demanda consolidada de todas las sucursales) ─────────────────────
  IF p_erp_sucursal_id IS NULL OR p_erp_sucursal_id = 6 THEN
    WITH branch_map_all AS (
      SELECT branch_id AS bid
      FROM erp_sucursal_map
      WHERE es_bodega = false
    ),
    daily_all AS MATERIALIZED (
      SELECT
        ii.erp_product_id,
        inv.fecha,
        SUM(ii.cantidad::numeric
            * COALESCE((regexp_match(ii.presentacion,'[0-9]+[xX]([0-9]+)'))[1]::int, 1)) AS units,
        SUM(ii.total_linea)                                                               AS rev
      FROM sales_invoice_items ii
      JOIN sales_invoices inv ON inv.id = ii.invoice_id
      JOIN branch_map_all bm  ON bm.bid = inv.branch_id
      WHERE inv.fecha         >= v_from
        AND inv.estado        != 'ANULADA'
        AND ii.erp_product_id IS NOT NULL
        AND ii.cantidad        > 0
        AND NOT EXISTS (
          SELECT 1 FROM products p
          JOIN laboratorios l ON l.id = p.laboratorio_id
          WHERE p.id = ii.erp_product_id AND l.ocultar_en_minmax = true
        )
      GROUP BY ii.erp_product_id, inv.fecha
    ),
    daily_all_p95 AS (
      SELECT
        erp_product_id,
        PERCENTILE_CONT(cfg.outlier_percentile::float / 100.0)
            WITHIN GROUP (ORDER BY units) AS cap
      FROM daily_all
      GROUP BY erp_product_id
    ),
    stats_all AS (
      SELECT
        d.erp_product_id,
        SUM(d.units)::integer                                                         AS sold_period,
        SUM(d.rev)                                                                    AS rev_period,
        SUM(LEAST(d.units, p.cap))::numeric / cfg.analysis_days                      AS velocity,
        SUM(CASE WHEN d.fecha >= CURRENT_DATE - 30 THEN d.units ELSE 0 END)::numeric / 30 AS velocity_30d,
        ROUND(
          SQRT(GREATEST(0,
            SUM(LEAST(d.units, p.cap) * LEAST(d.units, p.cap))::numeric / cfg.analysis_days
            - POWER(SUM(LEAST(d.units, p.cap))::numeric / cfg.analysis_days, 2)
          )) / NULLIF(SUM(LEAST(d.units, p.cap))::numeric / cfg.analysis_days, 0) * 100
        ::numeric, 1) AS cv,
        COUNT(DISTINCT d.fecha) AS dias
      FROM daily_all d
      JOIN daily_all_p95 p ON p.erp_product_id = d.erp_product_id
      GROUP BY d.erp_product_id
      HAVING COUNT(DISTINCT d.fecha) >= 1
    ),
    ranked_all AS (
      SELECT *,
        SUM(rev_period) OVER (ORDER BY rev_period DESC ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS cum_rev,
        SUM(rev_period) OVER ()                                                                          AS tot_rev
      FROM stats_all
      WHERE dias >= 3
    ),
    lead_times_bodega AS MATERIALIZED (
      SELECT erp_product_id, lead_time_days
      FROM product_stock_params
      WHERE lead_time_days IS NOT NULL AND erp_sucursal_id = 6
    ),
    classified_all AS (
      SELECT r.*,
        CASE
          WHEN r.tot_rev = 0                                               THEN 'D'
          WHEN (r.cum_rev - r.rev_period) / r.tot_rev < cfg.abc_a_pct/100 THEN 'A'
          WHEN (r.cum_rev - r.rev_period) / r.tot_rev < cfg.abc_b_pct/100 THEN 'B'
          ELSE                                                                  'C'
        END AS abc,
        CASE
          WHEN r.cv <= cfg.xyz_x_cv_max THEN 'X'
          WHEN r.cv <= cfg.xyz_y_cv_max THEN 'Y'
          ELSE                               'Z'
        END AS xyz,
        COALESCE(lt.lead_time_days,
          CASE
            WHEN r.cv <= cfg.xyz_x_cv_max THEN cfg.reorder_x_days + cfg.buffer_x_days
            WHEN r.cv <= cfg.xyz_y_cv_max THEN cfg.reorder_y_days + cfg.buffer_y_days
            ELSE                               cfg.reorder_z_days + cfg.buffer_z_days
          END
        ) AS effective_lead_days
      FROM ranked_all r
      LEFT JOIN lead_times_bodega lt ON lt.erp_product_id = r.erp_product_id
    ),
    with_min_all AS (
      SELECT *,
        GREATEST(
          FLOOR(velocity * effective_lead_days)::int,
          CASE WHEN CEIL(velocity * cfg.cycle_days)::int > 1 THEN 1 ELSE 0 END
        ) AS computed_min
      FROM classified_all
    ),
    main_all_upsert AS (
      INSERT INTO product_stock_params (
        erp_product_id, erp_sucursal_id,
        draft_abc_class, draft_velocity, draft_velocity_30d, draft_cv, draft_demand_variability,
        draft_min, draft_max,
        calc_min, calc_max,
        draft_units_sold, draft_revenue,
        draft_calculated_at, draft_status,
        updated_at
      )
      SELECT
        erp_product_id, 6,
        abc,
        ROUND(velocity::numeric, 6),
        ROUND(velocity_30d::numeric, 6),
        cv, xyz,
        computed_min,
        GREATEST(CEIL(velocity * cfg.cycle_days)::int, computed_min + 1, 1),
        computed_min,
        GREATEST(CEIL(velocity * cfg.cycle_days)::int, computed_min + 1, 1),
        sold_period, rev_period,
        NOW(), 'pending',
        NOW()
      FROM with_min_all
      ON CONFLICT (erp_product_id, erp_sucursal_id) DO UPDATE SET
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
        draft_calculated_at        = EXCLUDED.draft_calculated_at,
        draft_status               = CASE
          WHEN product_stock_params.min_units IS NULL
            OR product_stock_params.min_units  IS DISTINCT FROM EXCLUDED.draft_min
            OR product_stock_params.max_units  IS DISTINCT FROM EXCLUDED.draft_max
            OR product_stock_params.abc_class  IS DISTINCT FROM EXCLUDED.draft_abc_class
            OR product_stock_params.demand_variability IS DISTINCT FROM EXCLUDED.draft_demand_variability
          THEN 'pending'
          ELSE 'none'
        END,
        updated_at                 = EXCLUDED.updated_at
      WHERE product_stock_params.is_hidden IS NOT TRUE
      RETURNING erp_product_id
    ),
    sparse_all_upsert AS (
      INSERT INTO product_stock_params (
        erp_product_id, erp_sucursal_id,
        draft_abc_class, draft_velocity, draft_velocity_30d, draft_cv, draft_demand_variability,
        draft_min, draft_max,
        calc_min, calc_max,
        draft_units_sold, draft_revenue,
        draft_calculated_at, draft_status,
        updated_at
      )
      SELECT
        erp_product_id, 6,
        NULL,
        ROUND(velocity::numeric, 6),
        ROUND(velocity_30d::numeric, 6),
        NULL, NULL,
        NULL, NULL,
        NULL, NULL,
        sold_period, rev_period,
        NOW(), 'sparse_data',
        NOW()
      FROM stats_all
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
        draft_calculated_at        = EXCLUDED.draft_calculated_at,
        draft_status               = 'sparse_data',
        updated_at                 = EXCLUDED.updated_at
      WHERE product_stock_params.is_hidden IS NOT TRUE
      RETURNING erp_product_id
    )
    SELECT COUNT(*) INTO v_count_bodega
    FROM (
      SELECT erp_product_id FROM main_all_upsert
      UNION ALL
      SELECT erp_product_id FROM sparse_all_upsert
    ) combined;
  END IF;

  RETURN jsonb_build_object('ok', true, 'rows', v_count + v_count_bodega, 'at', NOW());
END;
$function$;

GRANT EXECUTE ON FUNCTION public.calculate_stock_params(integer) TO authenticated, service_role;
