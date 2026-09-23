-- Gestión de stock › Sin venta › «Sin Min/Max»: sumar primero, buscar después.
--
-- `get_products_sold_no_minmax` unía cada LÍNEA de venta de seis meses con
-- `products`, `laboratorios` y el NOT EXISTS de `product_stock_params`, y recién
-- después agrupaba: 53,073 búsquedas de producto y otras tantas de Mín·Máx para
-- 592 productos (sala 1). `gate:perf` sección F: 3,099 MB por llamada contra un
-- techo declarado de 3,008.
--
-- Ahora agrega por producto en `vendido` y hace esas búsquedas una vez por
-- producto. Agrupar por (producto, nombre, laboratorio) y por producto a secas
-- es lo mismo: nombre y laboratorio dependen del producto. El orden por venta
-- descendente se conserva.
--
-- Medido como QA antes/después en una transacción deshecha, md5 idéntico:
-- sala 1 461 → 240 ms (592 filas), sala 7 201 → 107 ms (513), todas las salas
-- 2,053 → 1,043 ms (683). Lo que queda es leer las líneas de venta de seis
-- meses a través del RLS, que es el trabajo de verdad.

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.get_products_sold_no_minmax(p_erp_sucursal_id integer DEFAULT NULL::integer)
 RETURNS TABLE(erp_product_id integer, product_name text, laboratorio text, units_sold bigint, revenue numeric, months_with_sales integer, invoice_count integer)
 LANGUAGE sql STABLE SET search_path TO 'public', 'extensions'
AS $function$
  WITH branch_map(bid, esid) AS (
    VALUES (4::bigint,1),(25::bigint,2),(27::bigint,3),
           (28::bigint,4),(2::bigint,5),(29::bigint,7)
  ),
  vendido AS (
    SELECT ii.erp_product_id,
           SUM(ii.cantidad::numeric) AS unidades,
           SUM(ii.total_linea) AS total,
           COUNT(DISTINCT DATE_TRUNC('month', inv.fecha)) AS meses,
           COUNT(DISTINCT ii.invoice_id) AS facturas
    FROM sales_invoice_items ii
    JOIN sales_invoices inv ON inv.id = ii.invoice_id
    JOIN branch_map bm      ON bm.bid = inv.branch_id
      AND (p_erp_sucursal_id IS NULL OR bm.esid = p_erp_sucursal_id)
    WHERE inv.fecha  >= CURRENT_DATE - INTERVAL '6 months'
      AND inv.estado NOT IN ('NULA', 'DTE INVALIDADO EN MH')
      AND ii.erp_product_id IS NOT NULL AND ii.cantidad > 0
    GROUP BY ii.erp_product_id
  )
  SELECT v.erp_product_id, p.nombre, COALESCE(l.nombre, '—'),
         v.unidades::bigint, ROUND(v.total::numeric, 2), v.meses::integer, v.facturas::integer
  FROM vendido v
  JOIN products p          ON p.id = v.erp_product_id AND p.activo = true
  LEFT JOIN laboratorios l ON l.id = p.laboratorio_id
  WHERE NOT EXISTS (
      SELECT 1 FROM product_stock_params psp
      WHERE psp.erp_product_id = v.erp_product_id
        AND (p_erp_sucursal_id IS NULL OR psp.erp_sucursal_id = p_erp_sucursal_id)
        AND COALESCE(psp.manual_max, psp.max_units, 0) > 0
  )
  ORDER BY v.total DESC;
$function$;
