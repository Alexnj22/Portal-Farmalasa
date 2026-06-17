-- publish_stock_params v7: corrige el caso donde todas las sucursales publican 0/0
--
-- Bug en v6: el HAVING filtraba productos cuya Σ pub_min=0 y pub_max=0.
-- Resultado: cuando todas las sucursales removían un producto (0/0), bodega
-- conservaba un draft stale (pending) con los valores de la última Σ parcial
-- calculada, y mostraba "SUC. PEND." aunque ya no hubiera ninguna sucursal pendiente.
--
-- Fix: agregar OR EXISTS en el HAVING para incluir productos donde bodega
-- todavía tenga draft_status='pending' aunque la nueva Σ sea 0.
-- Eso permite que el ON CONFLICT limpie el draft a NULL/none.

CREATE OR REPLACE FUNCTION public.publish_stock_params(
  p_erp_sucursal_id integer   DEFAULT NULL::integer,
  p_erp_product_ids integer[] DEFAULT NULL::integer[],
  p_published_by    text      DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_count        INTEGER;
  v_bodega_count INTEGER := 0;
  v_now          TIMESTAMPTZ := NOW();
BEGIN

  -- ── 1. Publicar borradores de sucursales (nunca Bodega via este paso) ─────
  WITH published AS (
    UPDATE product_stock_params
    SET
      abc_class                = draft_abc_class,
      daily_velocity           = draft_velocity,
      velocity_30d             = draft_velocity_30d,
      cv                       = draft_cv,
      demand_variability       = draft_demand_variability,
      min_units                = LEAST(draft_min, COALESCE(draft_max, draft_min)),
      max_units                = GREATEST(COALESCE(draft_min, draft_max), draft_max),
      units_sold_6m            = draft_units_sold,
      revenue_6m               = draft_revenue,
      data_days                = draft_data_days,
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
      draft_data_days          = NULL,
      draft_calculated_at      = NULL,
      draft_status             = 'none',
      published_at             = v_now,
      published_by             = p_published_by,
      updated_at               = v_now
    WHERE draft_status        = 'pending'
      AND erp_sucursal_id    != 6
      AND (p_erp_sucursal_id IS NULL OR erp_sucursal_id = p_erp_sucursal_id)
      AND (p_erp_product_ids IS NULL OR erp_product_id  = ANY(p_erp_product_ids))
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

  -- ── 2. Auto-confirmar Bodega ───────────────────────────────────────────────
  IF p_erp_sucursal_id IS DISTINCT FROM 6 THEN
    WITH branch_sums AS (
      SELECT
        s.erp_product_id,
        SUM(COALESCE(
          CASE WHEN s.draft_status = 'pending' THEN s.draft_min ELSE s.min_units END,
          0
        ))::integer AS eff_min,
        SUM(COALESCE(
          CASE WHEN s.draft_status = 'pending' THEN s.draft_max ELSE s.max_units END,
          0
        ))::integer AS eff_max,
        SUM(COALESCE(s.min_units, 0))::integer AS pub_min,
        SUM(COALESCE(s.max_units, 0))::integer AS pub_max
      FROM product_stock_params s
      WHERE s.erp_sucursal_id != 6
        AND (p_erp_product_ids IS NULL OR s.erp_product_id = ANY(p_erp_product_ids))
      GROUP BY s.erp_product_id
      HAVING
        -- Caso normal: alguna sucursal tiene valores publicados
        SUM(COALESCE(s.min_units, 0)) > 0
        OR SUM(COALESCE(s.max_units, 0)) > 0
        -- Caso fix: todas las sucursales llegaron a 0/0 pero bodega tiene draft stale
        -- → incluir el producto para que el ON CONFLICT limpie el draft a none
        OR EXISTS (
          SELECT 1 FROM product_stock_params b
          WHERE b.erp_sucursal_id = 6
            AND b.erp_product_id  = s.erp_product_id
            AND b.draft_status    = 'pending'
        )
    )
    INSERT INTO product_stock_params (
      erp_product_id, erp_sucursal_id,
      min_units, max_units,
      draft_min,    draft_max,    draft_status,
      published_at, published_by, updated_at
    )
    SELECT
      erp_product_id, 6,
      pub_min, pub_max,
      CASE WHEN eff_min != pub_min OR eff_max != pub_max THEN eff_min ELSE NULL END,
      CASE WHEN eff_min != pub_min OR eff_max != pub_max THEN eff_max ELSE NULL END,
      CASE WHEN eff_min != pub_min OR eff_max != pub_max THEN 'pending' ELSE 'none' END,
      v_now, p_published_by, v_now
    FROM branch_sums
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

GRANT EXECUTE ON FUNCTION public.publish_stock_params(integer, integer[], text) TO authenticated, service_role;

-- ── Fix inmediato: limpiar drafts stale en bodega donde todas las sucursales son 0/0 ──
UPDATE product_stock_params AS bodega
SET
  min_units    = 0,
  max_units    = 0,
  draft_min    = NULL,
  draft_max    = NULL,
  draft_status = 'none',
  updated_at   = NOW()
WHERE bodega.erp_sucursal_id = 6
  AND bodega.draft_status    = 'pending'
  AND NOT EXISTS (
    SELECT 1 FROM product_stock_params s
    WHERE s.erp_sucursal_id != 6
      AND s.erp_product_id  = bodega.erp_product_id
      AND (
        COALESCE(s.min_units, 0) > 0
        OR COALESCE(s.max_units, 0) > 0
        OR (s.draft_status = 'pending' AND (COALESCE(s.draft_min, 0) > 0 OR COALESCE(s.draft_max, 0) > 0))
      )
  );
