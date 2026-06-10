-- Min/Max — integridad de datos
-- 1) CHECK constraints: max >= min en los tres pares de columnas.
--    Se usa >= (no >) a propósito: el zero-out/ocultar productos escribe
--    draft_min=0, draft_max=0 intencionalmente. La validación estricta (max > min)
--    para EDICIONES de usuario vive en el cliente (React); aquí solo blindamos
--    contra la corrupción real (max < min) que la RPC de cálculo podía generar.
ALTER TABLE public.product_stock_params
  ADD CONSTRAINT psp_manual_max_gte_min
    CHECK (manual_min IS NULL OR manual_max IS NULL OR manual_max >= manual_min),
  ADD CONSTRAINT psp_calc_max_gte_min
    CHECK (min_units IS NULL OR max_units IS NULL OR max_units >= min_units),
  ADD CONSTRAINT psp_draft_max_gte_min
    CHECK (draft_min IS NULL OR draft_max IS NULL OR draft_max >= draft_min);

-- 2) Guard en publish_stock_params: nunca publicar un borrador con max < min
--    (defensa en profundidad; el constraint ya lo impide, pero esto evita que
--    una fila inválida aborte el lote completo).
CREATE OR REPLACE FUNCTION public.publish_stock_params(
  p_erp_sucursal_id integer DEFAULT NULL::integer,
  p_erp_product_ids integer[] DEFAULT NULL::integer[],
  p_published_by text DEFAULT NULL::text
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
      min_units                = draft_min,
      max_units                = draft_max,
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
      -- Guard de integridad: omitir borradores con max < min
      AND (draft_min IS NULL OR draft_max IS NULL OR draft_max >= draft_min)
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

-- 3) Limpieza: module_key huérfano (no está en el registro MODULES de PermissionsView,
--    el route usa 'minmax'). Sin referencias en el código.
DELETE FROM public.role_permissions WHERE module_key = 'productos_tab_minmax';
