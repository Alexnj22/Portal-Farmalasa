-- Agrega Branch 4 a get_stock_analysis: productos del catálogo que no tienen
-- ninguna presencia en la sucursal (sin product_stock_params y sin inventario).
-- Devuelve is_catalog_only=true para que el frontend los oculte por defecto
-- y los muestre solo al buscar o al activar el filtro "Sin historial".

CREATE OR REPLACE FUNCTION public.get_stock_analysis(p_erp_sucursal_id integer)
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
  laboratorio_nombre       text,
  is_hidden                boolean,
  calc_min                 int,
  calc_max                 int,
  is_catalog_only          boolean
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
      psp.published_by,
      psp.is_hidden,
      psp.calc_min,
      psp.calc_max
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
    combined.laboratorio_nombre, combined.is_hidden,
    combined.calc_min, combined.calc_max,
    combined.is_catalog_only
  FROM (
    -- Branch 1: Productos con fila en product_stock_params
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
      lab.nombre                                        AS laboratorio_nombre,
      pr.is_hidden,
      pr.calc_min,
      pr.calc_max,
      false::boolean                                    AS is_catalog_only
    FROM params pr
    JOIN products p ON p.id = pr.erp_product_id
    LEFT JOIN laboratorios lab ON lab.id = p.laboratorio_id
    LEFT JOIN inv_summary inv ON inv.erp_product_id = pr.erp_product_id
    WHERE (lab.ocultar_en_minmax IS NOT TRUE)

    UNION ALL

    -- Branch 2: Dead stock — tiene inventario pero sin fila en params
    SELECT
      inv2.erp_product_id,
      COALESCE(p2.nombre, d.descripcion, '(sin nombre)'),
      'D'::text,
      0::numeric, 0::numeric, 0::numeric, 'X'::text,
      0::int, 0::int,
      false::boolean,
      NULL::int, NULL::numeric,
      inv2.total_units, inv2.presentations,
      NULL::timestamptz,
      'dead_stock'::text,
      true::boolean,
      NULL::int, NULL::int, NULL::text, NULL::text,
      NULL::timestamptz, 'none'::text,
      p2.foto_url,
      NULL::text,
      lab2.nombre,
      false::boolean,
      NULL::int, NULL::int,
      false::boolean                                    AS is_catalog_only
    FROM inv_summary inv2
    JOIN products p2        ON p2.id = inv2.erp_product_id
    LEFT JOIN laboratorios lab2 ON lab2.id = p2.laboratorio_id
    LEFT JOIN (
      SELECT DISTINCT ii.erp_product_id, bm.erp_sucursal_id AS esid
      FROM sales_invoice_items ii
      JOIN sales_invoices inv3 ON inv3.id = ii.invoice_id
      JOIN erp_sucursal_map bm ON bm.branch_id = inv3.branch_id
    ) d2 ON d2.erp_product_id = inv2.erp_product_id AND d2.esid = p_erp_sucursal_id
    LEFT JOIN LATERAL (
      SELECT ii2.descripcion FROM sales_invoice_items ii2
      JOIN sales_invoices inv4 ON inv4.id = ii2.invoice_id
      JOIN erp_sucursal_map bm2 ON bm2.branch_id = inv4.branch_id
      WHERE ii2.erp_product_id = inv2.erp_product_id AND bm2.erp_sucursal_id = p_erp_sucursal_id
      LIMIT 1
    ) d ON true
    WHERE NOT EXISTS (
      SELECT 1 FROM product_stock_params psp2
      WHERE psp2.erp_product_id = inv2.erp_product_id
        AND psp2.erp_sucursal_id = p_erp_sucursal_id
    )
      AND (lab2.ocultar_en_minmax IS NOT TRUE)

    UNION ALL

    -- Branch 3: Sin historial — fila en params pero nunca ha tenido ventas
    SELECT
      p3.id,
      p3.nombre,
      'D'::text,
      0::numeric, 0::numeric, 0::numeric, 'X'::text,
      COALESCE(psp3.manual_min, psp3.min_units, psp3.draft_min, 0)::int,
      COALESCE(psp3.manual_max, psp3.max_units, psp3.draft_max, 0)::int,
      (psp3.manual_min IS NOT NULL OR psp3.manual_max IS NOT NULL)::boolean,
      0::int, NULL::numeric,
      COALESCE(inv3b.total_units, 0::bigint),
      COALESCE(inv3b.presentations, '[]'::jsonb),
      NULL::timestamptz,
      CASE WHEN COALESCE(inv3b.total_units,0) = 0 THEN 'out_of_stock' ELSE 'ok' END,
      false::boolean,
      psp3.draft_min, psp3.draft_max, NULL::text, NULL::text,
      psp3.draft_calculated_at, COALESCE(psp3.draft_status,'none'),
      p3.foto_url,
      psp3.published_by,
      lab3.nombre,
      COALESCE(psp3.is_hidden, false)::boolean,
      psp3.calc_min,
      psp3.calc_max,
      false::boolean                                    AS is_catalog_only
    FROM product_stock_params psp3
    JOIN products p3          ON p3.id = psp3.erp_product_id
    LEFT JOIN laboratorios lab3 ON lab3.id = p3.laboratorio_id
    LEFT JOIN inv_summary inv3b ON inv3b.erp_product_id = psp3.erp_product_id
    WHERE psp3.erp_sucursal_id = p_erp_sucursal_id
      AND psp3.daily_velocity IS NULL
      AND psp3.draft_velocity IS NULL
      AND (lab3.ocultar_en_minmax IS NOT TRUE)
      AND NOT EXISTS (
        SELECT 1 FROM params pr2 WHERE pr2.erp_product_id = psp3.erp_product_id
      )

    UNION ALL

    -- Branch 4: En catálogo pero sin ninguna presencia en esta sucursal.
    -- is_catalog_only=true → el frontend los oculta por defecto y los muestra
    -- solo al buscar o al activar el filtro "Sin historial".
    SELECT
      p4.id,
      p4.nombre,
      'D'::text,
      0::numeric, 0::numeric, 0::numeric, 'X'::text,
      0::int, 0::int,
      false::boolean,
      0::int, NULL::numeric,
      0::bigint, '[]'::jsonb,
      NULL::timestamptz,
      'no_data'::text,
      false::boolean,
      NULL::int, NULL::int, NULL::text, NULL::text,
      NULL::timestamptz, 'none'::text,
      p4.foto_url,
      NULL::text,
      lab4.nombre,
      false::boolean,
      NULL::int, NULL::int,
      true::boolean                                     AS is_catalog_only
    FROM products p4
    LEFT JOIN laboratorios lab4 ON lab4.id = p4.laboratorio_id
    WHERE p4.activo = true
      AND (lab4.ocultar_en_minmax IS NOT TRUE)
      AND NOT EXISTS (
        SELECT 1 FROM product_stock_params psp4
        WHERE psp4.erp_product_id = p4.id
          AND psp4.erp_sucursal_id = p_erp_sucursal_id
      )
      AND NOT EXISTS (
        SELECT 1 FROM inv_summary inv4
        WHERE inv4.erp_product_id = p4.id
      )
  ) combined;
$function$;

GRANT EXECUTE ON FUNCTION public.get_stock_analysis(integer) TO authenticated, service_role;
