SET lock_timeout = '5s';

-- get_stock_analysis: catalog_pres/catalog_base_pres (fallback presentaciones
-- tomadas de product_precios cuando el producto no tiene inventario en esa
-- presentacion) no filtraban activo=true, a diferencia de get_pedido_preview
-- que si lo hace. Caso detectado: producto 985 (ALCANFOR SOBRE X 6 UNIDADES)
-- tiene una presentacion "1x190" (factor 190) marcada activo=false junto a la
-- real "1x1" (factor 1, activo=true) -- el CSV de MinMax mostraba la 1x190
-- inactiva como "presentacion mayor disponible".
CREATE OR REPLACE FUNCTION public.get_stock_analysis(p_erp_sucursal_id integer)
 RETURNS TABLE(erp_product_id integer, product_name text, abc_class text, daily_velocity numeric, velocity_30d numeric, cv numeric, demand_variability text, effective_min integer, effective_max integer, has_manual boolean, units_sold_6m integer, revenue_6m numeric, current_stock bigint, presentations jsonb, calculated_at timestamp with time zone, alert_status text, is_dead_stock boolean, draft_min integer, draft_max integer, draft_abc_class text, draft_demand_variability text, draft_calculated_at timestamp with time zone, draft_status text, foto_url text, published_by text, laboratorio_nombre text, is_hidden boolean, calc_min integer, calc_max integer, last_sale_date date, last_sale_sucursal_id integer, is_catalog_only boolean, dispatch_multiplo smallint, dispatch_pres_factor numeric, dispatch_tipo text, pub_min integer, pub_max integer, has_pending_branches boolean)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  WITH config AS (
    SELECT (1.0 + approaching_pct / 100.0) AS approaching_mult,
           analysis_days
    FROM stock_config LIMIT 1
  ),
  live_sales AS (
    SELECT
      ii.erp_product_id,
      SUM(ii.cantidad::numeric * ii.factor_unidades)::integer AS units_sold_live,
      SUM(CASE WHEN inv.fecha >= CURRENT_DATE - 30
          THEN ii.cantidad::numeric * ii.factor_unidades
          ELSE 0 END) / 30.0 AS velocity_30d_live
    FROM sales_invoice_items ii
    JOIN sales_invoices inv ON inv.id = ii.invoice_id
    JOIN erp_sucursal_map bm ON bm.branch_id = inv.branch_id AND bm.es_bodega = false
    WHERE (p_erp_sucursal_id = 6 OR bm.erp_sucursal_id = p_erp_sucursal_id)
      AND inv.fecha >= CURRENT_DATE - (SELECT analysis_days::int FROM config)
      AND inv.estado != 'ANULADA'
      AND ii.erp_product_id IS NOT NULL
      AND ii.cantidad > 0
    GROUP BY ii.erp_product_id
  ),
  pres_factors AS (
    SELECT product_id, UPPER(descripcion) AS desc_key, MAX(factor) AS factor
    FROM product_precios
    GROUP BY product_id, UPPER(descripcion)
  ),
  dispatch_pres_factor AS (
    SELECT DISTINCT ON (dr.erp_product_id) dr.erp_product_id,
      pp.factor::numeric AS dp_factor,
      COALESCE(dr.dispatch_multiplo,1)::numeric AS dp_multiplo,
      COALESCE(dr.dispatch_label, pres.tipo) AS dp_tipo
    FROM dispatch_rules dr
    JOIN product_precios pp ON pp.product_id = dr.erp_product_id AND pp.id_presentacion = dr.dispatch_id_presentacion
    JOIN presentaciones pres ON pres.id = dr.dispatch_id_presentacion
    WHERE dr.dispatch_id_presentacion IS NOT NULL
    ORDER BY dr.erp_product_id, pp.factor DESC
  ),
  inv_base AS (
    SELECT i.erp_product_id, i.presentacion AS tipo,
      COALESCE(pf.factor, 1) AS factor, i.cantidad
    FROM inventory i
    LEFT JOIN pres_factors pf ON pf.product_id = i.erp_product_id AND pf.desc_key = UPPER(i.detalle)
    WHERE i.erp_sucursal_id = p_erp_sucursal_id AND i.is_vencidos = false
  ),
  inv_grouped AS (
    SELECT erp_product_id, tipo, factor, SUM(cantidad) AS qty
    FROM inv_base GROUP BY erp_product_id, tipo, factor
  ),
  inv_summary AS (
    SELECT erp_product_id,
      SUM(qty * factor)::bigint AS total_units,
      COALESCE(
        jsonb_agg(jsonb_build_object('tipo', tipo, 'factor', factor) ORDER BY factor DESC)
          FILTER (WHERE factor > 1),
        '[]'::jsonb
      ) AS presentations
    FROM inv_grouped GROUP BY erp_product_id
  ),
  inv_all_pres AS (
    SELECT DISTINCT ON (i.erp_product_id, COALESCE(pf.factor, 1))
      i.erp_product_id, i.presentacion AS tipo, COALESCE(pf.factor, 1) AS factor
    FROM inventory i
    LEFT JOIN pres_factors pf ON pf.product_id = i.erp_product_id AND pf.desc_key = UPPER(i.detalle)
    WHERE i.is_vencidos = false
      AND (p_erp_sucursal_id = 6 OR i.erp_sucursal_id = p_erp_sucursal_id)
    ORDER BY i.erp_product_id, COALESCE(pf.factor, 1), i.presentacion
  ),
  inv_base_pres AS (
    SELECT DISTINCT ON (erp_product_id)
      erp_product_id, jsonb_build_object('tipo', tipo, 'factor', factor) AS base_pres
    FROM inv_all_pres ORDER BY erp_product_id, factor ASC
  ),
  inv_other_pres_agg AS (
    SELECT erp_product_id,
      jsonb_agg(jsonb_build_object('tipo', tipo, 'factor', factor) ORDER BY factor DESC) AS presentations
    FROM inv_all_pres WHERE factor > 1
    GROUP BY erp_product_id
  ),
  catalog_pres AS (
    SELECT product_id,
      jsonb_agg(jsonb_build_object('tipo', descripcion, 'factor', factor) ORDER BY factor DESC) AS presentations
    FROM product_precios WHERE factor > 1 AND activo = true
    GROUP BY product_id
  ),
  catalog_base_pres AS (
    SELECT DISTINCT ON (pp.product_id)
      pp.product_id AS erp_product_id,
      jsonb_build_object('tipo', pr.tipo, 'factor', pp.factor) AS base_pres
    FROM product_precios pp
    JOIN presentaciones pr ON pr.id = pp.id_presentacion
    WHERE pp.activo = true
    ORDER BY pp.product_id, pp.factor ASC
  ),
  last_sale AS (
    SELECT
      pls.erp_product_id,
      MAX(pls.last_sale_date) AS last_sale_date,
      CASE WHEN p_erp_sucursal_id = 6 THEN (
        SELECT pls2.erp_sucursal_id FROM product_last_sale pls2
        WHERE pls2.erp_product_id = pls.erp_product_id
        ORDER BY pls2.last_sale_date DESC LIMIT 1
      ) ELSE NULL END AS last_sale_sucursal_id
    FROM product_last_sale pls
    WHERE p_erp_sucursal_id = 6 OR pls.erp_sucursal_id = p_erp_sucursal_id
    GROUP BY pls.erp_product_id
  ),
  pending_branches AS (
    SELECT erp_product_id, true AS has_pending
    FROM product_stock_params
    WHERE erp_sucursal_id != 6 AND draft_status = 'pending'
    GROUP BY erp_product_id
  ),
  params AS (
    SELECT
      psp.erp_product_id, psp.abc_class,
      COALESCE(psp.daily_velocity, psp.draft_velocity)         AS daily_velocity,
      COALESCE(psp.velocity_30d,   psp.draft_velocity_30d, 0) AS velocity_30d,
      psp.cv, psp.demand_variability,
      minmax_effective(COALESCE(psp.min_units, psp.draft_min, 0), psp.manual_min)::int AS eff_min,
      minmax_effective(COALESCE(psp.max_units, psp.draft_max, 0), psp.manual_max)::int AS eff_max,
      (psp.manual_min IS NOT NULL OR psp.manual_max IS NOT NULL) AS has_manual,
      COALESCE(psp.units_sold_6m, psp.draft_units_sold)       AS units_sold_6m,
      COALESCE(psp.revenue_6m,    psp.draft_revenue)          AS revenue_6m,
      psp.calculated_at, psp.draft_min, psp.draft_max,
      psp.draft_abc_class, psp.draft_demand_variability, psp.draft_calculated_at,
      COALESCE(psp.draft_status, 'none') AS draft_status,
      psp.published_by, psp.is_hidden, psp.calc_min, psp.calc_max,
      COALESCE(psp.min_units, 0)::int AS pub_min,
      COALESCE(psp.max_units, 0)::int AS pub_max
    FROM product_stock_params psp
    WHERE psp.erp_sucursal_id = p_erp_sucursal_id
  )
  SELECT
    combined.erp_product_id, combined.product_name, combined.abc_class,
    combined.daily_velocity,
    COALESCE(ls.velocity_30d_live::numeric, combined.velocity_30d)        AS velocity_30d,
    combined.cv, combined.demand_variability,
    combined.effective_min, combined.effective_max, combined.has_manual,
    COALESCE(ls.units_sold_live, combined.units_sold_6m)                  AS units_sold_6m,
    combined.revenue_6m, combined.current_stock,
    CASE
      WHEN cbp.base_pres IS NOT NULL THEN jsonb_build_array(cbp.base_pres)
      WHEN ibp.base_pres IS NOT NULL THEN jsonb_build_array(ibp.base_pres)
      ELSE '[]'::jsonb
    END || (CASE
      WHEN combined.presentations != '[]'::jsonb AND combined.presentations IS NOT NULL
           THEN combined.presentations
      WHEN iop.presentations IS NOT NULL THEN iop.presentations
      ELSE COALESCE(cp.presentations, '[]'::jsonb)
    END) AS presentations,
    combined.calculated_at, combined.alert_status, combined.is_dead_stock,
    combined.draft_min, combined.draft_max, combined.draft_abc_class, combined.draft_demand_variability,
    combined.draft_calculated_at, combined.draft_status,
    combined.foto_url, combined.published_by, combined.laboratorio_nombre, combined.is_hidden,
    combined.calc_min, combined.calc_max,
    ls_date.last_sale_date, ls_date.last_sale_sucursal_id,
    combined.is_catalog_only,
    COALESCE(dpf.dp_multiplo, 1)::smallint AS dispatch_multiplo,
    dpf.dp_factor AS dispatch_pres_factor,
    dpf.dp_tipo AS dispatch_tipo,
    combined.pub_min, combined.pub_max,
    COALESCE(pb.has_pending, false) AS has_pending_branches
  FROM (
    SELECT p.id AS erp_product_id, p.nombre AS product_name,
      pr.abc_class, pr.daily_velocity, pr.velocity_30d, pr.cv, pr.demand_variability,
      pr.eff_min AS effective_min, pr.eff_max AS effective_max, pr.has_manual,
      pr.units_sold_6m, pr.revenue_6m,
      COALESCE(inv.total_units, 0::bigint) AS current_stock,
      COALESCE(inv.presentations, '[]'::jsonb) AS presentations,
      pr.calculated_at,
      CASE
        WHEN COALESCE(inv.total_units,0) = 0 THEN 'out_of_stock'
        WHEN COALESCE(inv.total_units,0) < pr.eff_min THEN 'below_min'
        WHEN COALESCE(inv.total_units,0)::numeric < pr.eff_min*(SELECT approaching_mult FROM config)
             THEN 'approaching'
        WHEN COALESCE(inv.total_units,0) > pr.eff_max AND pr.eff_max > 0 THEN 'overstocked'
        ELSE 'ok'
      END AS alert_status,
      false::boolean AS is_dead_stock,
      pr.draft_min, pr.draft_max, pr.draft_abc_class, pr.draft_demand_variability,
      pr.draft_calculated_at, pr.draft_status, p.foto_url, pr.published_by,
      lab.nombre AS laboratorio_nombre, pr.is_hidden, pr.calc_min, pr.calc_max,
      false::boolean AS is_catalog_only, pr.pub_min, pr.pub_max
    FROM params pr
    JOIN products p ON p.id = pr.erp_product_id
    LEFT JOIN laboratorios lab ON lab.id = p.laboratorio_id
    LEFT JOIN inv_summary inv ON inv.erp_product_id = pr.erp_product_id
    WHERE (lab.ocultar_en_minmax IS NOT TRUE) AND p.activo = true AND pr.daily_velocity IS NOT NULL

    UNION ALL

    SELECT inv2.erp_product_id, p2.nombre,
      'D'::text, 0::numeric, 0::numeric, 0::numeric, 'X'::text,
      0::int, 0::int, false::boolean, NULL::int, NULL::numeric,
      inv2.total_units, inv2.presentations, NULL::timestamptz, 'dead_stock'::text, true::boolean,
      NULL::int, NULL::int, NULL::text, NULL::text, NULL::timestamptz, 'none'::text,
      p2.foto_url, NULL::text, lab2.nombre, false::boolean, NULL::int, NULL::int,
      false::boolean, 0::int, 0::int
    FROM inv_summary inv2
    JOIN products p2 ON p2.id = inv2.erp_product_id
    LEFT JOIN laboratorios lab2 ON lab2.id = p2.laboratorio_id
    WHERE NOT EXISTS (SELECT 1 FROM product_stock_params psp2
                      WHERE psp2.erp_product_id = inv2.erp_product_id
                        AND psp2.erp_sucursal_id = p_erp_sucursal_id)
      AND p2.activo = true AND (lab2.ocultar_en_minmax IS NOT TRUE)

    UNION ALL

    SELECT p3.id, p3.nombre, 'D'::text, 0::numeric, 0::numeric, 0::numeric, 'X'::text,
      minmax_effective(COALESCE(psp3.min_units, psp3.draft_min,0), psp3.manual_min)::int,
      minmax_effective(COALESCE(psp3.max_units, psp3.draft_max,0), psp3.manual_max)::int,
      (psp3.manual_min IS NOT NULL OR psp3.manual_max IS NOT NULL)::boolean,
      0::int, NULL::numeric,
      COALESCE(inv3b.total_units, 0::bigint), COALESCE(inv3b.presentations, '[]'::jsonb),
      NULL::timestamptz, 'dead_stock'::text, true::boolean,
      psp3.draft_min, psp3.draft_max, NULL::text, NULL::text,
      psp3.draft_calculated_at, COALESCE(psp3.draft_status,'none'),
      p3.foto_url, psp3.published_by, lab3.nombre, COALESCE(psp3.is_hidden,false)::boolean,
      psp3.calc_min, psp3.calc_max,
      false::boolean, COALESCE(psp3.min_units,0)::int, COALESCE(psp3.max_units,0)::int
    FROM product_stock_params psp3
    JOIN products p3 ON p3.id = psp3.erp_product_id
    LEFT JOIN laboratorios lab3 ON lab3.id = p3.laboratorio_id
    LEFT JOIN inv_summary inv3b ON inv3b.erp_product_id = psp3.erp_product_id
    WHERE psp3.erp_sucursal_id = p_erp_sucursal_id AND p3.activo = true
      AND psp3.daily_velocity IS NULL AND psp3.draft_velocity IS NULL
      AND (lab3.ocultar_en_minmax IS NOT TRUE)

    UNION ALL

    SELECT p4.id, p4.nombre, 'D'::text, 0::numeric, 0::numeric, 0::numeric, 'X'::text,
      0::int, 0::int, false::boolean, 0::int, NULL::numeric,
      0::bigint, '[]'::jsonb, NULL::timestamptz, 'no_data'::text, false::boolean,
      NULL::int, NULL::int, NULL::text, NULL::text, NULL::timestamptz, 'none'::text,
      p4.foto_url, NULL::text, lab4.nombre, false::boolean, NULL::int, NULL::int,
      true::boolean, 0::int, 0::int
    FROM products p4
    LEFT JOIN laboratorios lab4 ON lab4.id = p4.laboratorio_id
    WHERE p4.activo = true AND (lab4.ocultar_en_minmax IS NOT TRUE)
      AND NOT EXISTS (SELECT 1 FROM product_stock_params psp4
                      WHERE psp4.erp_product_id = p4.id AND psp4.erp_sucursal_id = p_erp_sucursal_id)
      AND NOT EXISTS (SELECT 1 FROM inv_summary inv4b WHERE inv4b.erp_product_id = p4.id)
  ) combined
  LEFT JOIN live_sales       ls   ON ls.erp_product_id   = combined.erp_product_id
  LEFT JOIN last_sale        ls_date ON ls_date.erp_product_id = combined.erp_product_id
  LEFT JOIN dispatch_pres_factor dpf ON dpf.erp_product_id = combined.erp_product_id
  LEFT JOIN catalog_pres     cp   ON cp.product_id       = combined.erp_product_id
  LEFT JOIN inv_base_pres    ibp  ON ibp.erp_product_id  = combined.erp_product_id
  LEFT JOIN inv_other_pres_agg iop ON iop.erp_product_id = combined.erp_product_id
  LEFT JOIN catalog_base_pres cbp ON cbp.erp_product_id  = combined.erp_product_id
  LEFT JOIN pending_branches pb   ON pb.erp_product_id   = combined.erp_product_id;
$function$
;
