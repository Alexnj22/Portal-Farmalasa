-- publish_stock_params v6: Bodega se auto-confirma cuando se publican sucursales.
--
-- Comportamiento:
--   1. Publica borradores de sucursales (igual que antes, excluye Bodega erp_sucursal_id=6).
--   2. Auto-confirma Bodega: min_units/max_units = Σ valores publicados de todas las sucursales.
--   3. Si aún quedan sucursales con borrador pendiente → Bodega mantiene draft (preview de la suma efectiva).
--      Cuando todas las sucursales tienen publicado → draft de Bodega se limpia (draft_status='none').
--   4. Publicar manualmente Bodega (p_erp_sucursal_id=6) ya no tiene efecto sobre las sucursales
--      porque se excluye sucursal_id=6 del paso 1. Bodega se auto-gestiona.
--
-- Σ efectivo (eff): CASE WHEN draft_status='pending' THEN draft_min ELSE min_units END
-- Σ publicado (pub): COALESCE(min_units, 0) de sucursales con min_units IS NOT NULL
-- → Bodega published = pub_sum
-- → Bodega draft = eff_sum (preview) solo cuando eff_sum != pub_sum

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
      AND erp_sucursal_id    != 6    -- Bodega se maneja en paso 2
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

  -- ── 2. Auto-confirmar Bodega (solo cuando se publican sucursales, no Bodega explícita) ──
  IF p_erp_sucursal_id IS DISTINCT FROM 6 THEN
    WITH branch_sums AS (
      SELECT
        erp_product_id,
        -- Σ efectivo: para sucursales con draft pendiente, proyecta el draft;
        --             para las que ya publicaron, usa el valor publicado.
        SUM(COALESCE(
          CASE WHEN draft_status = 'pending' THEN draft_min ELSE min_units END,
          0
        ))::integer AS eff_min,
        SUM(COALESCE(
          CASE WHEN draft_status = 'pending' THEN draft_max ELSE max_units END,
          0
        ))::integer AS eff_max,
        -- Σ publicado: solo lo que realmente está publicado en cada sucursal
        SUM(COALESCE(min_units, 0))::integer AS pub_min,
        SUM(COALESCE(max_units, 0))::integer AS pub_max
      FROM product_stock_params
      WHERE erp_sucursal_id != 6
        AND (p_erp_product_ids IS NULL OR erp_product_id = ANY(p_erp_product_ids))
      GROUP BY erp_product_id
      HAVING SUM(COALESCE(min_units, 0)) > 0
          OR SUM(COALESCE(max_units, 0)) > 0
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
      -- Draft = proyección solo si hay diferencia (i.e., quedan sucursales sin publicar)
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
