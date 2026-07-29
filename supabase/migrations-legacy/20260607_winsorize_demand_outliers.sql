-- Winsorización de outliers de demanda en calculate_stock_params.
-- Agrega outlier_percentile a stock_config (default 95).
-- La velocidad y el CV se calculan sobre unidades capeadas al percentil configurado;
-- sold_period y rev_period mantienen los valores reales para reporting y ABC.
-- velocity_30d se deja sin capear (ventana corta ya es robusta por sí sola).

-- 1. Schema
ALTER TABLE stock_config
    ADD COLUMN IF NOT EXISTS outlier_percentile integer DEFAULT 95
        CHECK (outlier_percentile BETWEEN 50 AND 100);

UPDATE stock_config SET outlier_percentile = 95 WHERE id = 1 AND outlier_percentile IS NULL;

-- 2. Función actualizada
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
    -- Percentil de corte por producto/sucursal — winsorización de outliers
    daily_p95 AS (
      SELECT
        erp_sucursal_id,
        erp_product_id,
        PERCENTILE_CONT(cfg.outlier_percentile::float / 100.0)
            WITHIN GROUP (ORDER BY units) AS cap
      FROM daily
      GROUP BY erp_sucursal_id, erp_product_id
    ),
    stats AS (
      SELECT
        d.erp_sucursal_id,
        d.erp_product_id,
        SUM(d.units)::integer                                                         AS sold_period,
        SUM(d.rev)                                                                    AS rev_period,
        -- Velocidad sobre unidades capeadas (elimina outliers mayoristas)
        SUM(LEAST(d.units, p.cap))::numeric / cfg.analysis_days                      AS velocity,
        -- velocity_30d sin capear (ventana corta ya es robusta)
        SUM(CASE WHEN d.fecha >= CURRENT_DATE - 30 THEN d.units ELSE 0 END)::numeric / 30 AS velocity_30d,
        -- CV sobre unidades capeadas para que outliers no distorsionen la clase XYZ
        ROUND(
          SQRT(GREATEST(0,
            SUM(LEAST(d.units, p.cap) * LEAST(d.units, p.cap))::numeric / cfg.analysis_days
            - POWER(SUM(LEAST(d.units, p.cap))::numeric / cfg.analysis_days, 2)
          )) / NULLIF(SUM(LEAST(d.units, p.cap))::numeric / cfg.analysis_days, 0) * 100
        ::numeric, 1) AS cv
      FROM daily d
      JOIN daily_p95 p ON p.erp_sucursal_id = d.erp_sucursal_id
                      AND p.erp_product_id  = d.erp_product_id
      GROUP BY d.erp_sucursal_id, d.erp_product_id
      HAVING SUM(d.units) > 0
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
        ::numeric, 1) AS cv
      FROM daily_all d
      JOIN daily_all_p95 p ON p.erp_product_id = d.erp_product_id
      GROUP BY d.erp_product_id
      HAVING SUM(d.units) > 0
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
