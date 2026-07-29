-- get_stock_analysis v3: add laboratorio_nombre via LEFT JOIN laboratorios
-- Preserves all v2 columns (foto_url, published_by, draft velocity fallback)

DROP FUNCTION IF EXISTS get_stock_analysis(integer);

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
  laboratorio_nombre       text
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
      psp.published_by
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
    combined.laboratorio_nombre
  FROM (
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
      lab.nombre                                        AS laboratorio_nombre
    FROM params pr
    JOIN products p ON p.id = pr.erp_product_id
    LEFT JOIN laboratorios lab ON lab.id = p.laboratorio_id
    LEFT JOIN inv_summary inv ON inv.erp_product_id = pr.erp_product_id

    UNION ALL

    SELECT
      inv2.erp_product_id,
      COALESCE(p2.nombre, d.descripcion, '(sin nombre)'),
      'D'::text,
      0::numeric, 0::numeric, 0::numeric, 'X'::text,
      0::integer, 0::integer,
      false::boolean,
      0::integer, 0::numeric,
      inv2.total_units, inv2.presentations,
      NULL::timestamptz,
      'dead_stock'::text,
      true::boolean,
      NULL::int, NULL::int, NULL::text, NULL::text,
      NULL::timestamptz, 'none'::text,
      p2.foto_url,
      NULL::text,
      lab2.nombre
    FROM inv_summary inv2
    LEFT JOIN products p2 ON p2.id = inv2.erp_product_id
    LEFT JOIN laboratorios lab2 ON lab2.id = p2.laboratorio_id
    LEFT JOIN LATERAL (
      SELECT descripcion FROM inventory
      WHERE erp_sucursal_id = p_erp_sucursal_id
        AND erp_product_id  = inv2.erp_product_id
      LIMIT 1
    ) d ON true
    WHERE NOT EXISTS (
      SELECT 1 FROM params pr WHERE pr.erp_product_id = inv2.erp_product_id
    )
    AND inv2.total_units > 0
  ) combined
  ORDER BY
    CASE combined.alert_status
      WHEN 'out_of_stock' THEN 1
      WHEN 'below_min'    THEN 2
      WHEN 'approaching'  THEN 3
      WHEN 'dead_stock'   THEN 4
      WHEN 'overstocked'  THEN 5
      ELSE                     6
    END,
    combined.revenue_6m DESC NULLS LAST;
$function$;

GRANT EXECUTE ON FUNCTION get_stock_analysis(integer) TO anon, authenticated, service_role;
