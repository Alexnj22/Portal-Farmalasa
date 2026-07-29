-- Restaura la regla MIN floor que se perdió cuando use_erp_map sobreescribió min_floor.
-- Regla: si CEIL(v × cycle) > 1, MIN debe ser al menos 1.
-- El único par válido con MIN=0 es (0,1) — rotación tan baja que solo se mantiene 1 und.
-- Mantiene: erp_sucursal_map (use_erp_map), is_hidden guard (hidden_products_v2).

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
        bm.esid                                                                          AS erp_sucursal_id,
        ii.erp_product_id,
        inv.fecha,
        SUM(ii.cantidad::numeric
            * COALESCE((regexp_match(ii.presentacion,'[0-9]+[xX]([0-9]+)'))[1]::int, 1)) AS units,
        SUM(ii.total_linea)                                                              AS rev
      FROM sales_invoice_items ii
      JOIN sales_invoices inv ON inv.id = ii.invoice_id
      JOIN branch_map bm      ON bm.bid = inv.branch_id
      WHERE inv.fecha         >= v_from
        AND inv.estado        != 'ANULADA'
        AND ii.erp_product_id IS NOT NULL
        AND ii.cantidad        > 0
        AND (p_erp_sucursal_id IS NULL OR bm.esid = p_erp_sucursal_id)
      GROUP BY bm.esid, ii.erp_product_id, inv.fecha
    ),
    stats AS (
      SELECT
        erp_sucursal_id,
        erp_product_id,
        SUM(units)::integer                                     AS sold_period,
        SUM(rev)                                                AS rev_period,
        SUM(units)::numeric / cfg.analysis_days                AS velocity,
        SUM(CASE WHEN fecha >= CURRENT_DATE - 30 THEN units ELSE 0 END)::numeric / 30 AS velocity_30d,
        ROUND(
          SQRT(GREATEST(0,
            SUM(units * units)::numeric / cfg.analysis_days
            - POWER(SUM(units)::numeric / cfg.analysis_days, 2)
          )) / NULLIF(SUM(units)::numeric / cfg.analysis_days, 0) * 100
        ::numeric, 1) AS cv
      FROM daily
      GROUP BY erp_sucursal_id, erp_product_id
      HAVING SUM(units) > 0
    ),
    ranked AS (
      SELECT *,
        SUM(rev_period) OVER (
          PARTITION BY erp_sucursal_id
          ORDER BY rev_period DESC
          ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
        )                                                    AS cum_rev,
        SUM(rev_period) OVER (PARTITION BY erp_sucursal_id) AS tot_rev
      FROM stats
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
      LEFT JOIN lead_times lt ON lt.erp_product_id = r.erp_product_id AND lt.erp_sucursal_id = r.erp_sucursal_id
    ),
    with_min AS (
      SELECT *,
        -- MIN floor: si MAX > 1, MIN debe ser al menos 1.
        -- Solo (0,1) es válido con MIN=0.
        GREATEST(
          FLOOR(velocity * effective_lead_days)::int,
          CASE WHEN CEIL(velocity * cfg.cycle_days)::int > 1 THEN 1 ELSE 0 END
        ) AS computed_min
      FROM classified
    )
    INSERT INTO product_stock_params (
      erp_product_id, erp_sucursal_id,
      draft_abc_class, draft_velocity, draft_velocity_30d, draft_cv, draft_demand_variability,
      draft_min, draft_max,
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
    WHERE product_stock_params.is_hidden IS NOT TRUE;

    GET DIAGNOSTICS v_count = ROW_COUNT;
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
      GROUP BY ii.erp_product_id, inv.fecha
    ),
    stats_all AS (
      SELECT
        erp_product_id,
        SUM(units)::integer                                     AS sold_period,
        SUM(rev)                                                AS rev_period,
        SUM(units)::numeric / cfg.analysis_days                AS velocity,
        SUM(CASE WHEN fecha >= CURRENT_DATE - 30 THEN units ELSE 0 END)::numeric / 30 AS velocity_30d,
        ROUND(
          SQRT(GREATEST(0,
            SUM(units * units)::numeric / cfg.analysis_days
            - POWER(SUM(units)::numeric / cfg.analysis_days, 2)
          )) / NULLIF(SUM(units)::numeric / cfg.analysis_days, 0) * 100
        ::numeric, 1) AS cv
      FROM daily_all
      GROUP BY erp_product_id
      HAVING SUM(units) > 0
    ),
    ranked_all AS (
      SELECT *,
        SUM(rev_period) OVER (ORDER BY rev_period DESC ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS cum_rev,
        SUM(rev_period) OVER ()                                                                          AS tot_rev
      FROM stats_all
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
    )
    INSERT INTO product_stock_params (
      erp_product_id, erp_sucursal_id,
      draft_abc_class, draft_velocity, draft_velocity_30d, draft_cv, draft_demand_variability,
      draft_min, draft_max,
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
    WHERE product_stock_params.is_hidden IS NOT TRUE;

    GET DIAGNOSTICS v_count_bodega = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object('ok', true, 'rows', v_count + v_count_bodega, 'at', NOW());
END;
$function$;

GRANT EXECUTE ON FUNCTION public.calculate_stock_params(integer) TO authenticated, service_role;
