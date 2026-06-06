-- Option A: Bodega MIN/MAX = Σ published branch MIN/MAX.
-- When any branch publish happens, Bodega rows are automatically upserted
-- with the sum of all branches' live min_units / max_units for each product.
-- Bodega-only publishes (p_erp_sucursal_id = 6) skip the auto-sum step.

CREATE OR REPLACE FUNCTION public.publish_stock_params(
  p_erp_sucursal_id integer   DEFAULT NULL::integer,
  p_erp_product_ids integer[] DEFAULT NULL::integer[],
  p_published_by    text      DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_count        INTEGER;
  v_count_bodega INTEGER := 0;
  v_now          TIMESTAMPTZ := NOW();
BEGIN
  -- ── 1. Publish branch drafts (unchanged logic) ────────────────────────────
  WITH published AS (
    UPDATE product_stock_params
    SET
      abc_class                = draft_abc_class,
      daily_velocity           = draft_velocity,
      velocity_30d             = draft_velocity_30d,
      cv                       = draft_cv,
      demand_variability       = draft_demand_variability,
      min_units                = draft_min,
      max_units                = draft_max,
      units_sold_6m            = draft_units_sold,
      revenue_6m               = draft_revenue,
      calculated_at            = draft_calculated_at,
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
      published_at             = v_now,
      published_by             = p_published_by,
      updated_at               = v_now
    WHERE draft_status = 'pending'
      AND (p_erp_sucursal_id IS NULL OR erp_sucursal_id = p_erp_sucursal_id)
      AND (p_erp_product_ids IS NULL OR erp_product_id = ANY(p_erp_product_ids))
    RETURNING
      erp_product_id, erp_sucursal_id,
      min_units, max_units, daily_velocity, velocity_30d,
      abc_class, demand_variability, cv, calculated_at
  )
  INSERT INTO product_stock_params_history (
    erp_product_id, erp_sucursal_id, captured_at,
    min_units, max_units, daily_velocity, velocity_30d,
    abc_class, demand_variability, cv, calculated_at
  )
  SELECT
    erp_product_id, erp_sucursal_id, v_now,
    min_units, max_units, daily_velocity, velocity_30d,
    abc_class, demand_variability, cv, calculated_at
  FROM published;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  -- ── 2. Auto-update Bodega: MIN = Σ branch MINs, MAX = Σ branch MAXs ───────
  -- Only runs when publishing branches (not when explicitly publishing Bodega)
  IF p_erp_sucursal_id IS DISTINCT FROM 6 THEN
    WITH network_sums AS (
      SELECT
        erp_product_id,
        SUM(COALESCE(min_units, 0))::integer AS bodega_min,
        SUM(COALESCE(max_units, 0))::integer AS bodega_max
      FROM product_stock_params
      WHERE erp_sucursal_id != 6
        AND min_units IS NOT NULL
        AND (p_erp_product_ids IS NULL OR erp_product_id = ANY(p_erp_product_ids))
      GROUP BY erp_product_id
    )
    INSERT INTO product_stock_params (
      erp_product_id, erp_sucursal_id,
      min_units, max_units,
      published_at, published_by, updated_at
    )
    SELECT erp_product_id, 6, bodega_min, bodega_max, v_now, p_published_by, v_now
    FROM network_sums
    ON CONFLICT (erp_product_id, erp_sucursal_id) DO UPDATE SET
      min_units    = EXCLUDED.min_units,
      max_units    = EXCLUDED.max_units,
      published_at = EXCLUDED.published_at,
      published_by = EXCLUDED.published_by,
      updated_at   = EXCLUDED.updated_at
    WHERE product_stock_params.is_hidden IS NOT TRUE;

    GET DIAGNOSTICS v_count_bodega = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object(
    'ok',             true,
    'published',      v_count,
    'bodega_updated', v_count_bodega,
    'at',             v_now
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.publish_stock_params(integer, integer[], text) TO authenticated, service_role;
