SET lock_timeout = '5s';

-- Mejora M2 (aprobada) de la auditoría MinMax 2026-07-17: get_network_summary
-- se llamaba en ~5 chunks de .range() desde TabMinMaxNetwork — PostgREST
-- re-ejecuta la función COMPLETA por cada chunk (limit/offset se aplica SOBRE
-- el resultado de la función), no solo pagina lo ya calculado. Patrón C:
-- RETURNS json + json_agg(to_json(t)), una sola ejecución agregada.
--
-- De paso corrige dos bugs de correctness descubiertos al tocar la función:
-- 1. manual_min/manual_max usaban COALESCE (reemplazo) — el mismo bug C-1 de
--    Fase 1, que no había llegado a esta función. Ahora usa la fórmula aditiva
--    (min_units + manual) igual que get_stock_analysis/get_pedido_preview.
-- 2. El factor de presentación del inventario salía de un regexp_match sobre
--    inventory.detalle en vez de product_precios.factor — viola la regla del
--    proyecto y difería en 112 de 23,175 filas de inventario (0.48%) respecto al
--    valor correcto. Ahora usa el mismo patrón pres_factors que get_stock_analysis.
--
-- Se crea junto a la vieja get_network_summary (sin dropearla todavía) para
-- comparar resultados antes de cortar el cable — ver migración de seguimiento
-- 20260717180100 que hace el DROP + revoke anon una vez verificado.
CREATE OR REPLACE FUNCTION public.get_network_summary_json()
 RETURNS json
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  WITH config AS (
    SELECT (1.0 + approaching_pct / 100.0) AS approaching_mult
    FROM stock_config LIMIT 1
  ),
  pres_factors AS (
    SELECT product_id, UPPER(descripcion) AS desc_key, MAX(factor) AS factor
    FROM product_precios
    GROUP BY product_id, UPPER(descripcion)
  ),
  inv AS (
    SELECT i.erp_product_id, i.erp_sucursal_id,
      SUM(i.cantidad * COALESCE(pf.factor, 1))::bigint AS stock
    FROM inventory i
    LEFT JOIN pres_factors pf ON pf.product_id = i.erp_product_id AND pf.desc_key = UPPER(i.detalle)
    WHERE i.is_vencidos = false
    GROUP BY i.erp_product_id, i.erp_sucursal_id
  ),
  params AS (
    SELECT erp_product_id, erp_sucursal_id,
      (COALESCE(min_units, 0) + COALESCE(manual_min, 0)) AS eff_min,
      (COALESCE(max_units, 0) + COALESCE(manual_max, 0)) AS eff_max,
      COALESCE(daily_velocity, 0)       AS daily_velocity,
      abc_class, revenue_6m
    FROM product_stock_params
  ),
  pairs AS (
    SELECT
      p.erp_product_id, p.erp_sucursal_id,
      COALESCE(i.stock, 0)              AS current_stock,
      p.eff_min, p.eff_max,
      p.daily_velocity, p.abc_class, p.revenue_6m,
      CASE
        WHEN COALESCE(i.stock, 0) = 0                                                           THEN 'out_of_stock'
        WHEN COALESCE(i.stock, 0) < p.eff_min                                                  THEN 'below_min'
        WHEN COALESCE(i.stock, 0)::numeric < p.eff_min * (SELECT approaching_mult FROM config) THEN 'approaching'
        WHEN COALESCE(i.stock, 0) > p.eff_max AND p.eff_max > 0                                THEN 'overstocked'
        ELSE 'ok'
      END AS alert_status
    FROM params p
    LEFT JOIN inv i ON i.erp_product_id = p.erp_product_id AND i.erp_sucursal_id = p.erp_sucursal_id
  ),
  agg AS (
    SELECT
      pr.erp_product_id,
      COALESCE(prod.nombre, '(sin nombre)') AS product_name,
      MAX(pr.abc_class)                     AS abc_class,
      MAX(pr.revenue_6m)                    AS max_revenue_6m,
      SUM(CASE pr.alert_status
        WHEN 'out_of_stock' THEN 4
        WHEN 'below_min'    THEN 3
        WHEN 'approaching'  THEN 1
        WHEN 'overstocked'  THEN 1
        ELSE 0
      END)::integer AS alert_severity,
      jsonb_object_agg(
        pr.erp_sucursal_id::text,
        jsonb_build_object(
          'stk', pr.current_stock,
          'min', pr.eff_min,
          'max', pr.eff_max,
          'vel', pr.daily_velocity,
          'alr', pr.alert_status
        )
      ) AS branches
    FROM pairs pr
    JOIN products prod ON prod.id = pr.erp_product_id
    GROUP BY pr.erp_product_id, prod.nombre
  )
  SELECT coalesce(json_agg(to_json(t)), '[]'::json)
  FROM (
    SELECT * FROM agg ORDER BY alert_severity DESC, max_revenue_6m DESC NULLS LAST
  ) t;
$function$;

REVOKE ALL ON FUNCTION public.get_network_summary_json() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_network_summary_json() TO authenticated, service_role;
