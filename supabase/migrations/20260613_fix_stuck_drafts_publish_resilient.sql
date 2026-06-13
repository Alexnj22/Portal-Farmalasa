-- Fix: pares de borrador corruptos (draft_min > draft_max) quedan atascados en 'pending'
-- para siempre porque publish_stock_params los omitía silenciosamente con un guard.
--
-- Causa raíz: el cálculo del 1 de junio dejó algunos pares invertidos.
-- El guard añadido el 10-jun en publish_stock_params los excluía del UPDATE para evitar
-- violar el CHECK constraint min_units <= max_units, pero nunca los corregía.
-- Resultado: La Popular tenía 149 y Salud 3 tenía 119 borradores inatascables.
--
-- Fix:
--   1. Normalizar los pares corruptos existentes (intercambiar min/max en el borrador).
--   2. Reemplazar el guard por LEAST/GREATEST en el UPDATE, para que borradores
--      con par invertido siempre sean publicables sin violar constraints.

-- ── 1. Corregir pares corruptos en todos los borradores pendientes ─────────────
DO $$
DECLARE v_fixed INTEGER;
BEGIN
  UPDATE product_stock_params
  SET
    draft_min  = LEAST(draft_min, draft_max),
    draft_max  = GREATEST(draft_min, draft_max),
    updated_at = NOW()
  WHERE draft_status = 'pending'
    AND draft_min IS NOT NULL
    AND draft_max IS NOT NULL
    AND draft_min > draft_max;
  GET DIAGNOSTICS v_fixed = ROW_COUNT;
  RAISE NOTICE 'Pares corruptos corregidos: %', v_fixed;
END;
$$;

-- ── 2. publish_stock_params: LEAST/GREATEST en lugar del guard ─────────────────
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
$function$;

GRANT EXECUTE ON FUNCTION public.publish_stock_params(integer, integer[], text) TO authenticated, service_role;
