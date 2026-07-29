-- Reemplaza el auto-update de Bodega en publish_stock_params por un trigger
-- que recalcula el draft de Bodega en tiempo real cada vez que cambia
-- draft_min, draft_max, draft_status, min_units o max_units en una sucursal.
--
-- Efectivo de cada sucursal:
--   si draft_status = 'pending'  → usa draft_min / draft_max
--   si draft_status != 'pending' → usa min_units / max_units (publicado)

-- ── 1. Función del trigger ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION sync_bodega_draft_from_branch()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO product_stock_params (
    erp_product_id, erp_sucursal_id,
    draft_min, draft_max, draft_status, draft_calculated_at, updated_at
  )
  SELECT
    NEW.erp_product_id,
    6,
    SUM(COALESCE(
      CASE WHEN psp.draft_status = 'pending' THEN psp.draft_min ELSE psp.min_units END,
    0))::integer AS bodega_min,
    SUM(COALESCE(
      CASE WHEN psp.draft_status = 'pending' THEN psp.draft_max ELSE psp.max_units END,
    0))::integer AS bodega_max,
    'pending',
    NOW(),
    NOW()
  FROM product_stock_params psp
  WHERE psp.erp_sucursal_id != 6
    AND psp.erp_product_id = NEW.erp_product_id
  HAVING
    SUM(COALESCE(CASE WHEN psp.draft_status = 'pending' THEN psp.draft_min ELSE psp.min_units END, 0)) > 0
    OR
    SUM(COALESCE(CASE WHEN psp.draft_status = 'pending' THEN psp.draft_max ELSE psp.max_units END, 0)) > 0
  ON CONFLICT (erp_product_id, erp_sucursal_id) DO UPDATE SET
    draft_min           = EXCLUDED.draft_min,
    draft_max           = EXCLUDED.draft_max,
    draft_status        = 'pending',
    draft_calculated_at = EXCLUDED.draft_calculated_at,
    updated_at          = EXCLUDED.updated_at
  WHERE product_stock_params.is_hidden IS NOT TRUE;

  RETURN NEW;
END;
$$;

-- ── 2. Trigger: dispara en cambios de draft o live en sucursales ──────────────
DROP TRIGGER IF EXISTS trg_bodega_draft_sync ON product_stock_params;

CREATE TRIGGER trg_bodega_draft_sync
AFTER INSERT OR UPDATE OF draft_min, draft_max, draft_status, min_units, max_units
ON product_stock_params
FOR EACH ROW
WHEN (NEW.erp_sucursal_id != 6)
EXECUTE FUNCTION sync_bodega_draft_from_branch();

-- ── 3. publish_stock_params: elimina el bloque de auto-update de Bodega ───────
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
  v_count INTEGER;
  v_now   TIMESTAMPTZ := NOW();
BEGIN
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

  RETURN jsonb_build_object('ok', true, 'published', v_count, 'at', v_now);
END;
$$;

GRANT EXECUTE ON FUNCTION public.publish_stock_params(integer, integer[], text) TO authenticated, service_role;
