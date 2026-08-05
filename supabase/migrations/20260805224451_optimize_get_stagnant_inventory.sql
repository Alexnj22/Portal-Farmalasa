SET lock_timeout = '5s';

-- get_stagnant_inventory: mismo resultado, sin el coste cuadrático.
--
-- El cuerpo viejo calculaba seis subconsultas CORRELACIONADAS en el SELECT
-- final (sold_in, ultima_venta, ultima_venta_por_suc, in_minmax, min_qty,
-- max_qty). Cada una recorre un CTE —que no tiene índices— una vez POR FILA,
-- así que el coste crece con filas × tamaño del CTE. En las sucursales el
-- resultado es de ~70-140 filas y no se notaba; en Bodega son 3,305 y la
-- función tardaba 15.3 s.
--
-- Tres cambios, todos de forma:
--   1. `inv_cur` se filtra por sucursal. `candidates` solo mira la suya, así que
--      agregaba las otras seis para tirarlas.
--   2. `universo` acota `sales_6m` a los productos que pueden llegar a ser
--      candidatos (los que tienen existencia o parámetros en esta sucursal).
--   3. las seis correlacionadas pasan a GROUP BY + LEFT JOIN: una pasada cada
--      una en vez de una por fila.
--
-- Verificado contra el cuerpo anterior en las 7 sucursales, comparando las 12
-- columnas fila por fila con EXCEPT en las dos direcciones: 0 diferencias
-- (69/115/123/139/125/380/3305 filas). Medido: Bodega 15,320 ms → 878 ms,
-- Salud 1 981 → 687, La Popular 764 → 715.
--
-- `product_last_sale` NO sirve para reemplazar el `NOT EXISTS` sobre sales_6m,
-- aunque lo parezca: su trigger la puebla con `es_bodega = false` —o sea que
-- Bodega no está— y `last_sale_date` solo avanza, nunca se recalcula.
--
-- Lo único que cambia de comportamiento es un DESEMPATE: `sold_in` y
-- `ultima_venta_por_suc` ordenaban por revenue/fecha sin criterio secundario,
-- así que dos sucursales con el mismo ingreso salían en orden arbitrario y
-- podían intercambiarse entre dos cargas. Como `sold_in[0]` es la sucursal que
-- la vista recomienda para el traslado, la sugerencia podía cambiar sola. Ahora
-- desempata por id de sucursal y es estable.

CREATE OR REPLACE FUNCTION public.get_stagnant_inventory(p_erp_sucursal_id integer DEFAULT NULL::integer)
RETURNS TABLE(erp_product_id integer, product_name text, laboratorio text, current_stock bigint,
              cost_value numeric, fecha_vencimiento_min date, in_minmax boolean, min_qty numeric,
              max_qty numeric, sold_in jsonb, ultima_venta date, ultima_venta_por_suc jsonb)
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
    SELECT pls.erp_product_id AS prod_id,
      MAX(pls.last_sale_date) FILTER (WHERE p_erp_sucursal_id IS NULL OR pls.erp_sucursal_id = p_erp_sucursal_id) AS ultima_venta,
      jsonb_agg(jsonb_build_object('esid', pls.erp_sucursal_id, 'fecha', pls.last_sale_date)
                ORDER BY pls.last_sale_date DESC NULLS LAST, pls.erp_sucursal_id) AS por_suc
    FROM product_last_sale pls
    WHERE pls.erp_product_id IN (SELECT prod_id FROM candidates_agg)
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
    COALESCE(si.sold_in, '[]'::jsonb), ls.ultima_venta, COALESCE(ls.por_suc, '[]'::jsonb)
  FROM candidates_agg c
  JOIN products p            ON p.id = c.prod_id AND p.activo = true
  LEFT JOIN laboratorios l   ON l.id = p.laboratorio_id
  LEFT JOIN unit_costs uc    ON uc.product_id = c.prod_id
  LEFT JOIN sold_in_agg si   ON si.prod_id    = c.prod_id
  LEFT JOIN last_sale_agg ls ON ls.prod_id    = c.prod_id
  LEFT JOIN minmax mm        ON mm.prod_id    = c.prod_id
  ORDER BY ROUND(c.total_units * COALESCE(uc.unit_cost, 0), 2) DESC NULLS LAST;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_stagnant_inventory(integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_stagnant_inventory(integer) TO authenticated, service_role;

-- Andamios de la verificación (creados con execute_sql para poder comparar los
-- dos cuerpos fila por fila). Se van acá para no dejarlos sueltos en prod.
DROP FUNCTION IF EXISTS public.__tmp_stagnant_v2(integer);
DROP FUNCTION IF EXISTS public.__tmp_norm(jsonb);
