SET lock_timeout = '5s';

-- Auditoría 2026-07-17: calculate_stock_params(6) generaba un borrador
-- independiente para Bodega (demanda agregada + ABC/XYZ propio) que NUNCA
-- podía convertirse en el min_units/max_units real de Bodega —
-- publish_stock_params excluye erp_sucursal_id=6 en sus dos bloques, así
-- que ese borrador solo se acumulaba como ruido (3,050+ filas sin resolver
-- desde junio) hasta que el trigger trg_bodega_draft_sync lo pisaba con el
-- valor real (SUM de las sucursales) la próxima vez que cualquier sucursal
-- cambiara. El valor real de Bodega SIEMPRE viene de trg_bodega_draft_sync
-- (tiempo real) y de publish_stock_params (al publicar) — nunca de acá.
-- Se quita el bloque completo de Bodega; llamar con p_erp_sucursal_id=6
-- ahora devuelve 'skipped' explícito en vez de calcular en silencio.
CREATE OR REPLACE FUNCTION public.calculate_stock_params(p_erp_sucursal_id integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  cfg             public.stock_config%ROWTYPE;
  v_from          date;
  v_count         integer := 0;
  v_auto_applied  integer := 0;
BEGIN
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

  -- Saltar sucursal si tiene borradores pendientes de revisión manual
  IF p_erp_sucursal_id IS NOT NULL THEN
    PERFORM 1 FROM product_stock_params
    WHERE erp_sucursal_id = p_erp_sucursal_id AND draft_status = 'pending'
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
      ::numeric, 1) AS cv,
      COUNT(DISTINCT d.fecha) AS dias
    FROM daily d
    JOIN daily_p95 p ON p.erp_sucursal_id = d.erp_sucursal_id
                    AND p.erp_product_id  = d.erp_product_id
    GROUP BY d.erp_sucursal_id, d.erp_product_id
    HAVING COUNT(DISTINCT d.fecha) >= 1
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
      draft_calculated_at      = NULL,
      draft_status             = 'none',
      published_at             = NOW(),
      published_by             = 'auto',
      updated_at                = NOW()
    WHERE psp.draft_status = 'pending'
      AND psp.erp_sucursal_id != 6
      AND (p_erp_sucursal_id IS NULL OR psp.erp_sucursal_id = p_erp_sucursal_id)
      AND psp.is_hidden IS NOT TRUE
      AND COALESCE(psp.min_units, 0) > 0
      AND COALESCE(psp.draft_min,  0) > 0
      AND COALESCE(psp.draft_max,  0) > 0
      AND ABS(psp.draft_min - psp.min_units)::numeric / GREATEST(psp.min_units, 1) <= 0.40
      AND ABS(psp.draft_max - psp.max_units)::numeric / GREATEST(psp.max_units, 1) <= 0.40
    RETURNING
      psp.erp_product_id, psp.erp_sucursal_id,
      psp.min_units, psp.max_units,
      psp.daily_velocity, psp.velocity_30d,
      psp.abc_class, psp.demand_variability, psp.cv, psp.calculated_at
  )
  INSERT INTO product_stock_params_history (
    erp_product_id, erp_sucursal_id, captured_at,
    min_units, max_units, daily_velocity, velocity_30d,
    abc_class, demand_variability, cv, calculated_at
  )
  SELECT erp_product_id, erp_sucursal_id, NOW(),
    min_units, max_units, daily_velocity, velocity_30d,
    abc_class, demand_variability, cv, calculated_at
  FROM auto_apply;

  GET DIAGNOSTICS v_auto_applied = ROW_COUNT;

  RETURN jsonb_build_object(
    'ok', true, 'rows', v_count,
    'auto_applied', v_auto_applied,
    'drafted', GREATEST(v_count - v_auto_applied, 0),
    'at', NOW()
  );
END;
$function$;
