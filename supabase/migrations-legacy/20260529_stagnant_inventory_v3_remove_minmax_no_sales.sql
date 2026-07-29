-- get_stagnant_inventory v3: revierte minmax_no_sales (causaba stock=0 en stock retenido)
-- Mantiene ultima_venta, ultima_venta_por_suc y DEFAULT NULL en la firma
DROP FUNCTION IF EXISTS public.get_stagnant_inventory(integer);

CREATE OR REPLACE FUNCTION public.get_stagnant_inventory(
  p_erp_sucursal_id integer DEFAULT NULL
)
RETURNS TABLE(
  erp_product_id        integer,
  product_name          text,
  laboratorio           text,
  current_stock         bigint,
  cost_value            numeric,
  fecha_vencimiento_min date,
  in_minmax             boolean,
  sold_in               jsonb,
  ultima_venta          date,
  ultima_venta_por_suc  jsonb
)
LANGUAGE sql STABLE AS $$
  WITH branch_map(bid, esid) AS (
    VALUES (4::bigint,1),(25::bigint,2),(27::bigint,3),
           (28::bigint,4),(2::bigint,5),(29::bigint,7)
  ),
  sales_6m AS (
    SELECT bm.esid AS suc_id, ii.erp_product_id AS prod_id,
      SUM(ii.cantidad::numeric
          * COALESCE((regexp_match(ii.presentacion,'\d+[xX](\d+)'))[1]::int,1))::bigint AS units_sold,
      ROUND(SUM(ii.total_linea)::numeric, 2) AS revenue
    FROM sales_invoice_items ii
    JOIN sales_invoices inv ON inv.id = ii.invoice_id
    JOIN branch_map bm ON bm.bid = inv.branch_id
    WHERE inv.fecha >= CURRENT_DATE - INTERVAL '6 months'
      AND inv.estado != 'ANULADA'
      AND ii.erp_product_id IS NOT NULL AND ii.cantidad > 0
    GROUP BY bm.esid, ii.erp_product_id
  ),
  last_sale_all AS (
    SELECT bm.esid AS suc_id, ii.erp_product_id AS prod_id, MAX(inv.fecha) AS last_date
    FROM sales_invoice_items ii
    JOIN sales_invoices inv ON inv.id = ii.invoice_id
    JOIN branch_map bm ON bm.bid = inv.branch_id
    WHERE inv.estado != 'ANULADA' AND ii.erp_product_id IS NOT NULL
    GROUP BY bm.esid, ii.erp_product_id
  ),
  inv_cur AS (
    SELECT inv.erp_sucursal_id AS suc_id, inv.erp_product_id AS prod_id,
      SUM(inv.cantidad
          * COALESCE((regexp_match(inv.detalle,'\d+[xX](\d+)'))[1]::int,1))::bigint AS total_units,
      MIN(inv.fecha_vencimiento) FILTER (WHERE inv.fecha_vencimiento IS NOT NULL) AS min_venc
    FROM inventory inv
    WHERE inv.is_vencidos = false AND inv.cantidad > 0
    GROUP BY inv.erp_sucursal_id, inv.erp_product_id
  ),
  unit_costs AS (
    SELECT DISTINCT ON (product_id) product_id, (costo / factor::numeric) AS unit_cost
    FROM product_precios WHERE activo = true AND costo > 0 AND factor > 0
    ORDER BY product_id, factor ASC
  ),
  candidates AS (
    SELECT ic.suc_id, ic.prod_id, ic.total_units, ic.min_venc
    FROM inv_cur ic
    WHERE NOT EXISTS (SELECT 1 FROM sales_6m s WHERE s.suc_id = ic.suc_id AND s.prod_id = ic.prod_id)
      AND (p_erp_sucursal_id IS NULL OR ic.suc_id = p_erp_sucursal_id)
  ),
  candidates_agg AS (
    SELECT prod_id,
      SUM(total_units)::bigint AS total_units,
      MIN(min_venc) AS min_venc
    FROM candidates
    GROUP BY prod_id
  )
  SELECT
    c.prod_id,
    p.nombre,
    COALESCE(l.nombre, '—'),
    c.total_units,
    ROUND(c.total_units * COALESCE(uc.unit_cost, 0), 2),
    c.min_venc,
    CASE
      WHEN p_erp_sucursal_id IS NOT NULL
        THEN EXISTS (SELECT 1 FROM erp_minmax mm WHERE mm.erp_sucursal_id = p_erp_sucursal_id AND mm.erp_product_id = c.prod_id)
      ELSE
        EXISTS (SELECT 1 FROM erp_minmax mm WHERE mm.erp_product_id = c.prod_id)
    END AS in_minmax,
    COALESCE(
      (SELECT jsonb_agg(jsonb_build_object('esid', s.suc_id, 'units', s.units_sold, 'rev', s.revenue)
               ORDER BY s.revenue DESC)
       FROM sales_6m s
       WHERE s.prod_id = c.prod_id
         AND (p_erp_sucursal_id IS NULL OR s.suc_id != p_erp_sucursal_id)),
      '[]'::jsonb
    ) AS sold_in,
    (SELECT MAX(ls.last_date) FROM last_sale_all ls
     WHERE ls.prod_id = c.prod_id
       AND (p_erp_sucursal_id IS NULL OR ls.suc_id = p_erp_sucursal_id)) AS ultima_venta,
    COALESCE(
      (SELECT jsonb_agg(jsonb_build_object('esid', ls.suc_id, 'fecha', ls.last_date)
               ORDER BY ls.last_date DESC NULLS LAST)
       FROM last_sale_all ls WHERE ls.prod_id = c.prod_id),
      '[]'::jsonb
    ) AS ultima_venta_por_suc
  FROM candidates_agg c
  JOIN products p ON p.id = c.prod_id AND p.activo = true
  LEFT JOIN laboratorios l ON l.id = p.laboratorio_id
  LEFT JOIN unit_costs uc ON uc.product_id = c.prod_id
  ORDER BY ROUND(c.total_units * COALESCE(uc.unit_cost, 0), 2) DESC NULLS LAST;
$$;
