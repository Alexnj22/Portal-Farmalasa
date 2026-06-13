-- get_draft_cost_estimate v2:
-- - Incluye productos publicados (min_units/max_units) además de borradores pending
-- - Devuelve pub_min_cost/pub_max_cost (publicado) y eff_min_cost/eff_max_cost (efectivo con COALESCE draft)
-- - draft_count: cuántos productos tienen borrador pending activo
-- - La card frontend muestra la inversión efectiva y el delta vs publicado cuando hay borradores
CREATE OR REPLACE FUNCTION public.get_draft_cost_estimate(p_erp_sucursal_id integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE result jsonb;
BEGIN
  WITH unit_costs AS (
    SELECT DISTINCT ON (product_id)
      product_id,
      (costo / factor::numeric) AS unit_cost
    FROM public.product_precios
    WHERE activo = true AND costo > 0 AND factor > 0
    ORDER BY product_id, factor ASC
  ),
  params AS (
    SELECT
      psp.erp_product_id,
      psp.min_units                                                                           AS pub_min,
      psp.max_units                                                                           AS pub_max,
      COALESCE(CASE WHEN psp.draft_status = 'pending' THEN psp.draft_min END, psp.min_units) AS eff_min,
      COALESCE(CASE WHEN psp.draft_status = 'pending' THEN psp.draft_max END, psp.max_units) AS eff_max,
      (psp.draft_status = 'pending' AND psp.draft_min IS NOT NULL)                           AS has_draft,
      uc.unit_cost
    FROM public.product_stock_params psp
    LEFT JOIN unit_costs uc ON uc.product_id = psp.erp_product_id
    WHERE psp.erp_sucursal_id = p_erp_sucursal_id
      AND psp.is_hidden IS NOT TRUE
      AND (psp.min_units IS NOT NULL OR (psp.draft_status = 'pending' AND psp.draft_min IS NOT NULL))
  )
  SELECT jsonb_build_object(
    'pub_min_cost',  ROUND(COALESCE(SUM(pub_min * unit_cost), 0)::numeric, 2),
    'pub_max_cost',  ROUND(COALESCE(SUM(pub_max * unit_cost), 0)::numeric, 2),
    'eff_min_cost',  ROUND(COALESCE(SUM(eff_min * unit_cost), 0)::numeric, 2),
    'eff_max_cost',  ROUND(COALESCE(SUM(eff_max * unit_cost), 0)::numeric, 2),
    'product_count', COUNT(*),
    'draft_count',   COUNT(*) FILTER (WHERE has_draft),
    'costed_pct',    CASE WHEN COUNT(*) > 0
                       THEN ROUND((COUNT(CASE WHEN unit_cost IS NOT NULL THEN 1 END)::numeric / COUNT(*)::numeric * 100)::numeric, 1)
                       ELSE 0 END
  ) INTO result FROM params;
  RETURN COALESCE(result, '{}'::jsonb);
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_draft_cost_estimate(integer) TO authenticated, service_role;
