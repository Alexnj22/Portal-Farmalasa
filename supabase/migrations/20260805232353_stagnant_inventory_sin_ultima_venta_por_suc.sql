SET lock_timeout = '5s';

-- `ultima_venta_por_suc` no la lee nadie: se va.
--
-- La devolvía para el tooltip «Última venta por suc.» de `UltimaVentaCell`, que
-- solo se dibuja con `allBranches`. El único sitio que monta esa celda la llama
-- con `allBranches={false}` fijo —no es una prop que alguien pueda encender, es
-- un literal—, así que la rama estaba muerta y la columna viajaba para nada.
--
-- Y no era gratis: son 611 de los 1,899 kB del JSON de Bodega (32%), más el
-- jsonb_agg que la arma. Medido con json_agg sobre el resultado de la función.
--
-- `get_stagnant_inventory` tiene un solo consumidor en todo el repo
-- (TabSinVenta, vía el wrapper _jsonb), y el bundle que hoy está en producción
-- tampoco se rompe: lee `row.ultima_venta_por_suc || []` y nunca lo usa.
--
-- Cambia el tipo de retorno, así que hay que DROP + CREATE: CREATE OR REPLACE no
-- puede quitar una columna. El wrapper depende de ella y se rehace igual.

DROP FUNCTION IF EXISTS public.get_stagnant_inventory_jsonb(integer);
DROP FUNCTION IF EXISTS public.get_stagnant_inventory(integer);

CREATE FUNCTION public.get_stagnant_inventory(p_erp_sucursal_id integer DEFAULT NULL::integer)
RETURNS TABLE(erp_product_id integer, product_name text, laboratorio text, current_stock bigint,
              cost_value numeric, fecha_vencimiento_min date, in_minmax boolean, min_qty numeric,
              max_qty numeric, sold_in jsonb, ultima_venta date)
LANGUAGE sql STABLE
SET search_path TO 'public', 'extensions'
AS $function$
  WITH branch_map(bid, esid) AS (
    VALUES (4::bigint,1),(25::bigint,2),(27::bigint,3),(28::bigint,4),(2::bigint,5),(29::bigint,7)
  ),
  inv_cur AS (
    SELECT inv.erp_sucursal_id AS suc_id, inv.erp_product_id AS prod_id,
      SUM(inv.cantidad * COALESCE((regexp_match(inv.detalle,'\d+[xX](\d+)'))[1]::int,1))::bigint AS total_units,
      MIN(inv.fecha_vencimiento) FILTER (WHERE inv.fecha_vencimiento IS NOT NULL) AS min_venc
    FROM inventory inv
    WHERE inv.is_vencidos = false AND inv.cantidad > 0
      AND (p_erp_sucursal_id IS NULL OR inv.erp_sucursal_id = p_erp_sucursal_id)
    GROUP BY inv.erp_sucursal_id, inv.erp_product_id
  ),
  universo AS (
    SELECT prod_id FROM inv_cur
    UNION
    SELECT psp.erp_product_id FROM product_stock_params psp
    WHERE (p_erp_sucursal_id IS NULL OR psp.erp_sucursal_id = p_erp_sucursal_id)
      AND COALESCE(psp.manual_max, psp.max_units, 0) > 0
  ),
  sales_6m AS (
    SELECT bm.esid AS suc_id, ii.erp_product_id AS prod_id,
      SUM(ii.cantidad::numeric * ii.factor_unidades)::bigint AS units_sold,
      ROUND(SUM(ii.total_linea)::numeric, 2) AS revenue
    FROM sales_invoice_items ii
    JOIN sales_invoices inv ON inv.id = ii.invoice_id
    JOIN branch_map bm ON bm.bid = inv.branch_id
    WHERE inv.fecha >= CURRENT_DATE - INTERVAL '6 months'
      AND inv.estado != 'ANULADA'
      AND ii.erp_product_id IS NOT NULL AND ii.cantidad > 0
      AND ii.erp_product_id IN (SELECT prod_id FROM universo)
    GROUP BY bm.esid, ii.erp_product_id
  ),
  candidates AS (
    SELECT ic.suc_id, ic.prod_id, ic.total_units, ic.min_venc
    FROM inv_cur ic
    WHERE NOT EXISTS (SELECT 1 FROM sales_6m s WHERE s.suc_id = ic.suc_id AND s.prod_id = ic.prod_id)
      AND (p_erp_sucursal_id IS NULL OR ic.suc_id = p_erp_sucursal_id)
    UNION
    SELECT psp.erp_sucursal_id, psp.erp_product_id, 0::bigint, NULL::date
    FROM product_stock_params psp
    WHERE (p_erp_sucursal_id IS NULL OR psp.erp_sucursal_id = p_erp_sucursal_id)
      AND COALESCE(psp.manual_max, psp.max_units, 0) > 0
      AND NOT EXISTS (SELECT 1 FROM sales_6m s  WHERE s.suc_id  = psp.erp_sucursal_id AND s.prod_id  = psp.erp_product_id)
      AND NOT EXISTS (SELECT 1 FROM inv_cur ic  WHERE ic.suc_id = psp.erp_sucursal_id AND ic.prod_id = psp.erp_product_id)
  ),
  candidates_agg AS (
    SELECT prod_id, SUM(total_units)::bigint AS total_units, MIN(min_venc) AS min_venc
    FROM candidates GROUP BY prod_id
  ),
  sold_in_agg AS (
    SELECT s.prod_id,
      jsonb_agg(jsonb_build_object('esid', s.suc_id, 'units', s.units_sold, 'rev', s.revenue)
                ORDER BY s.revenue DESC, s.suc_id) AS sold_in
    FROM sales_6m s
    WHERE (p_erp_sucursal_id IS NULL OR s.suc_id != p_erp_sucursal_id)
      AND s.prod_id IN (SELECT prod_id FROM candidates_agg)
    GROUP BY s.prod_id
  ),
  last_sale_agg AS (
    SELECT pls.erp_product_id AS prod_id, MAX(pls.last_sale_date) AS ultima_venta
    FROM product_last_sale pls
    WHERE pls.erp_product_id IN (SELECT prod_id FROM candidates_agg)
      AND (p_erp_sucursal_id IS NULL OR pls.erp_sucursal_id = p_erp_sucursal_id)
    GROUP BY pls.erp_product_id
  ),
  minmax AS (
    SELECT psp.erp_product_id AS prod_id,
      bool_or(COALESCE(psp.manual_max, psp.max_units, 0) > 0) AS in_minmax,
      (array_agg(COALESCE(psp.manual_min, psp.min_units) ORDER BY psp.erp_sucursal_id))[1] AS min_qty,
      (array_agg(COALESCE(psp.manual_max, psp.max_units) ORDER BY psp.erp_sucursal_id))[1] AS max_qty
    FROM product_stock_params psp
    WHERE (p_erp_sucursal_id IS NULL OR psp.erp_sucursal_id = p_erp_sucursal_id)
      AND psp.erp_product_id IN (SELECT prod_id FROM candidates_agg)
    GROUP BY psp.erp_product_id
  ),
  unit_costs AS (
    SELECT DISTINCT ON (product_id) product_id, (costo / factor::numeric) AS unit_cost
    FROM product_precios
    WHERE activo = true AND costo > 0 AND factor > 0
      AND product_id IN (SELECT prod_id FROM candidates_agg)
    ORDER BY product_id, factor ASC
  )
  SELECT c.prod_id, p.nombre, COALESCE(l.nombre, '—'), c.total_units,
    ROUND(c.total_units * COALESCE(uc.unit_cost, 0), 2), c.min_venc,
    COALESCE(mm.in_minmax, false), mm.min_qty, mm.max_qty,
    COALESCE(si.sold_in, '[]'::jsonb), ls.ultima_venta
  FROM candidates_agg c
  JOIN products p            ON p.id = c.prod_id AND p.activo = true
  LEFT JOIN laboratorios l   ON l.id = p.laboratorio_id
  LEFT JOIN unit_costs uc    ON uc.product_id = c.prod_id
  LEFT JOIN sold_in_agg si   ON si.prod_id    = c.prod_id
  LEFT JOIN last_sale_agg ls ON ls.prod_id    = c.prod_id
  LEFT JOIN minmax mm        ON mm.prod_id    = c.prod_id
  ORDER BY ROUND(c.total_units * COALESCE(uc.unit_cost, 0), 2) DESC NULLS LAST;
$function$;

CREATE FUNCTION public.get_stagnant_inventory_jsonb(p_erp_sucursal_id integer)
RETURNS json LANGUAGE sql STABLE
SET search_path TO 'public', 'extensions'
AS $function$
  SELECT coalesce(json_agg(to_json(t)), '[]'::json)
  FROM public.get_stagnant_inventory(p_erp_sucursal_id) t;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_stagnant_inventory(integer)       FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_stagnant_inventory_jsonb(integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_stagnant_inventory(integer)       TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.get_stagnant_inventory_jsonb(integer) TO authenticated, service_role;
