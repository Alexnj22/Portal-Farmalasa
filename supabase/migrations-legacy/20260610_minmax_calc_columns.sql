-- Agrega calc_min / calc_max a product_stock_params:
-- columnas que SOLO escribe calculate_stock_params (nunca ediciones manuales).
-- Sirven como baseline para el botón "Restaurar a calculado" en Min/Max.

ALTER TABLE public.product_stock_params
  ADD COLUMN IF NOT EXISTS calc_min INT,
  ADD COLUMN IF NOT EXISTS calc_max INT;

-- ─── get_stock_analysis: expone calc_min / calc_max ────────────────────────
DROP FUNCTION IF EXISTS public.get_stock_analysis(integer);
CREATE FUNCTION get_stock_analysis(p_erp_sucursal_id integer)
RETURNS TABLE (
  erp_product_id           integer,
  product_name             text,
  abc_class                text,
  daily_velocity           numeric,
  velocity_30d             numeric,
  cv                       numeric,
  demand_variability       text,
  effective_min            integer,
  effective_max            integer,
  has_manual               boolean,
  units_sold_6m            integer,
  revenue_6m               numeric,
  current_stock            bigint,
  presentations            jsonb,
  calculated_at            timestamptz,
  alert_status             text,
  is_dead_stock            boolean,
  draft_min                int,
  draft_max                int,
  draft_abc_class          text,
  draft_demand_variability text,
  draft_calculated_at      timestamptz,
  draft_status             text,
  foto_url                 text,
  published_by             text,
  laboratorio_nombre       text,
  is_hidden                boolean,
  calc_min                 int,
  calc_max                 int
)
LANGUAGE sql
VOLATILE
AS $function$
  WITH config AS (
    SELECT (1.0 + approaching_pct / 100.0) AS approaching_mult
    FROM stock_config LIMIT 1
  ),
  inv_base AS (
    SELECT
      erp_product_id,
      presentacion                                                             AS tipo,
      COALESCE((regexp_match(detalle,'[0-9]+[xX]([0-9]+)'))[1]::int, 1)      AS factor,
      cantidad
    FROM inventory
    WHERE erp_sucursal_id = p_erp_sucursal_id
      AND is_vencidos     = false
  ),
  inv_grouped AS (
    SELECT erp_product_id, tipo, factor, SUM(cantidad) AS qty
    FROM inv_base
    GROUP BY erp_product_id, tipo, factor
  ),
  inv_summary AS (
    SELECT
      erp_product_id,
      SUM(qty * factor)::bigint                         AS total_units,
      jsonb_agg(
        jsonb_build_object('tipo', tipo, 'factor', factor)
        ORDER BY factor DESC
      )                                                 AS presentations
    FROM inv_grouped
    GROUP BY erp_product_id
  ),
  params AS (
    SELECT
      psp.erp_product_id,
      psp.abc_class,
      COALESCE(psp.daily_velocity, psp.draft_velocity)                        AS daily_velocity,
      COALESCE(psp.velocity_30d,   psp.draft_velocity_30d, 0)                AS velocity_30d,
      psp.cv,
      psp.demand_variability,
      COALESCE(psp.manual_min, psp.min_units, psp.draft_min, 0)::int         AS eff_min,
      COALESCE(psp.manual_max, psp.max_units, psp.draft_max, 0)::int         AS eff_max,
      (psp.manual_min IS NOT NULL OR psp.manual_max IS NOT NULL)              AS has_manual,
      COALESCE(psp.units_sold_6m,  psp.draft_units_sold)                     AS units_sold_6m,
      COALESCE(psp.revenue_6m,     psp.draft_revenue)                        AS revenue_6m,
      psp.calculated_at,
      psp.draft_min,
      psp.draft_max,
      psp.draft_abc_class,
      psp.draft_demand_variability,
      psp.draft_calculated_at,
      COALESCE(psp.draft_status, 'none')                                      AS draft_status,
      psp.published_by,
      psp.is_hidden,
      psp.calc_min,
      psp.calc_max
    FROM product_stock_params psp
    WHERE psp.erp_sucursal_id = p_erp_sucursal_id
  )
  SELECT
    combined.erp_product_id, combined.product_name, combined.abc_class,
    combined.daily_velocity, combined.velocity_30d, combined.cv, combined.demand_variability,
    combined.effective_min, combined.effective_max, combined.has_manual,
    combined.units_sold_6m, combined.revenue_6m,
    combined.current_stock, combined.presentations,
    combined.calculated_at, combined.alert_status, combined.is_dead_stock,
    combined.draft_min, combined.draft_max, combined.draft_abc_class, combined.draft_demand_variability,
    combined.draft_calculated_at, combined.draft_status,
    combined.foto_url, combined.published_by,
    combined.laboratorio_nombre, combined.is_hidden,
    combined.calc_min, combined.calc_max
  FROM (
    -- Productos con fila en product_stock_params
    SELECT
      p.id                                              AS erp_product_id,
      p.nombre                                          AS product_name,
      pr.abc_class,
      pr.daily_velocity,
      pr.velocity_30d,
      pr.cv,
      pr.demand_variability,
      pr.eff_min                                        AS effective_min,
      pr.eff_max                                        AS effective_max,
      pr.has_manual,
      pr.units_sold_6m,
      pr.revenue_6m,
      COALESCE(inv.total_units, 0::bigint)              AS current_stock,
      COALESCE(inv.presentations, '[]'::jsonb)          AS presentations,
      pr.calculated_at,
      CASE
        WHEN COALESCE(inv.total_units, 0) = 0                                                                           THEN 'out_of_stock'
        WHEN COALESCE(inv.total_units, 0) < pr.eff_min                                                                  THEN 'below_min'
        WHEN COALESCE(inv.total_units, 0)::numeric < pr.eff_min * (SELECT approaching_mult FROM config)                 THEN 'approaching'
        WHEN COALESCE(inv.total_units, 0) > pr.eff_max AND pr.eff_max > 0                                               THEN 'overstocked'
        ELSE                                                                                                                 'ok'
      END                                               AS alert_status,
      false::boolean                                    AS is_dead_stock,
      pr.draft_min, pr.draft_max, pr.draft_abc_class, pr.draft_demand_variability,
      pr.draft_calculated_at, pr.draft_status,
      p.foto_url,
      pr.published_by,
      lab.nombre                                        AS laboratorio_nombre,
      pr.is_hidden,
      pr.calc_min,
      pr.calc_max
    FROM params pr
    JOIN products p ON p.id = pr.erp_product_id
    LEFT JOIN laboratorios lab ON lab.id = p.laboratorio_id
    LEFT JOIN inv_summary inv ON inv.erp_product_id = pr.erp_product_id
    WHERE (lab.ocultar_en_minmax IS NOT TRUE)

    UNION ALL

    -- Dead stock: tiene inventario pero sin fila en params
    SELECT
      inv2.erp_product_id,
      COALESCE(p2.nombre, d.descripcion, '(sin nombre)'),
      'D'::text,
      0::numeric, 0::numeric, 0::numeric, 'X'::text,
      0::int, 0::int,
      false::boolean,
      NULL::int, NULL::numeric,
      inv2.total_units, inv2.presentations,
      NULL::timestamptz,
      'no_data'::text,
      true::boolean,
      NULL::int, NULL::int, NULL::text, NULL::text,
      NULL::timestamptz, 'none'::text,
      p2.foto_url,
      NULL::text,
      lab2.nombre,
      false::boolean,
      NULL::int, NULL::int
    FROM inv_summary inv2
    JOIN products p2        ON p2.id = inv2.erp_product_id
    LEFT JOIN laboratorios lab2 ON lab2.id = p2.laboratorio_id
    LEFT JOIN (
      SELECT DISTINCT ii.erp_product_id, bm.erp_sucursal_id AS esid
      FROM sales_invoice_items ii
      JOIN sales_invoices inv3 ON inv3.id = ii.invoice_id
      JOIN erp_sucursal_map bm ON bm.branch_id = inv3.branch_id
    ) d2 ON d2.erp_product_id = inv2.erp_product_id AND d2.esid = p_erp_sucursal_id
    LEFT JOIN LATERAL (
      SELECT ii2.descripcion FROM sales_invoice_items ii2
      JOIN sales_invoices inv4 ON inv4.id = ii2.invoice_id
      JOIN erp_sucursal_map bm2 ON bm2.branch_id = inv4.branch_id
      WHERE ii2.erp_product_id = inv2.erp_product_id AND bm2.erp_sucursal_id = p_erp_sucursal_id
      LIMIT 1
    ) d ON true
    WHERE NOT EXISTS (
      SELECT 1 FROM product_stock_params psp2
      WHERE psp2.erp_product_id = inv2.erp_product_id
        AND psp2.erp_sucursal_id = p_erp_sucursal_id
    )
      AND (lab2.ocultar_en_minmax IS NOT TRUE)

    UNION ALL

    -- Sin historial: fila en params pero nunca ha tenido ventas
    SELECT
      p3.id,
      p3.nombre,
      'D'::text,
      0::numeric, 0::numeric, 0::numeric, 'X'::text,
      COALESCE(psp3.manual_min, psp3.min_units, psp3.draft_min, 0)::int,
      COALESCE(psp3.manual_max, psp3.max_units, psp3.draft_max, 0)::int,
      (psp3.manual_min IS NOT NULL OR psp3.manual_max IS NOT NULL)::boolean,
      0::int, NULL::numeric,
      COALESCE(inv3b.total_units, 0::bigint),
      COALESCE(inv3b.presentations, '[]'::jsonb),
      NULL::timestamptz,
      CASE WHEN COALESCE(inv3b.total_units,0) = 0 THEN 'out_of_stock' ELSE 'ok' END,
      false::boolean,
      psp3.draft_min, psp3.draft_max, NULL::text, NULL::text,
      psp3.draft_calculated_at, COALESCE(psp3.draft_status,'none'),
      p3.foto_url,
      psp3.published_by,
      lab3.nombre,
      COALESCE(psp3.is_hidden, false)::boolean,
      psp3.calc_min,
      psp3.calc_max
    FROM product_stock_params psp3
    JOIN products p3          ON p3.id = psp3.erp_product_id
    LEFT JOIN laboratorios lab3 ON lab3.id = p3.laboratorio_id
    LEFT JOIN inv_summary inv3b ON inv3b.erp_product_id = psp3.erp_product_id
    WHERE psp3.erp_sucursal_id = p_erp_sucursal_id
      AND psp3.daily_velocity IS NULL
      AND psp3.draft_velocity IS NULL
      AND (lab3.ocultar_en_minmax IS NOT TRUE)
      AND NOT EXISTS (
        SELECT 1 FROM params pr2 WHERE pr2.erp_product_id = psp3.erp_product_id
      )
  ) combined;
$function$;

GRANT EXECUTE ON FUNCTION public.get_stock_analysis(integer) TO authenticated, service_role;

-- ─── calculate_stock_params: también escribe calc_min / calc_max ────────────
DROP FUNCTION IF EXISTS public.calculate_stock_params(integer);
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
        SUM(LEAST(d.units, p.cap))::numeric / cfg.analysis_days                      AS velocity,
        SUM(CASE WHEN d.fecha >= CURRENT_DATE - 30 THEN d.units ELSE 0 END)::numeric / 30 AS velocity_30d,
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
    WHERE product_stock_params.is_hidden IS NOT TRUE;

    GET DIAGNOSTICS v_count_bodega = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object('ok', true, 'rows', v_count + v_count_bodega, 'at', NOW());
END;
$function$;

GRANT EXECUTE ON FUNCTION public.calculate_stock_params(integer) TO authenticated, service_role;
