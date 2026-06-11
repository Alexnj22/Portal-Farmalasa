-- MinMax: funciones auxiliares para última venta y ventas recientes
-- get_last_sale_dates  → última venta por producto en una sucursal (batch, para el listado principal)
-- get_product_last_sales → últimas N ventas de un producto (panel expandido)

CREATE OR REPLACE FUNCTION public.get_last_sale_dates(p_erp_sucursal_id integer)
RETURNS TABLE(erp_product_id integer, last_sale_date date)
LANGUAGE sql STABLE AS $function$
  SELECT
    ii.erp_product_id,
    MAX(inv.fecha)::date AS last_sale_date
  FROM sales_invoice_items ii
  JOIN sales_invoices inv       ON inv.id = ii.invoice_id
  JOIN erp_sucursal_map bm      ON bm.branch_id = inv.branch_id
  WHERE bm.erp_sucursal_id = p_erp_sucursal_id
    AND inv.estado         != 'ANULADA'
    AND ii.erp_product_id  IS NOT NULL
    AND ii.cantidad         > 0
  GROUP BY ii.erp_product_id;
$function$;

GRANT EXECUTE ON FUNCTION public.get_last_sale_dates(integer) TO authenticated, service_role;

-- Últimas ventas agrupadas por día para el panel expandido
CREATE OR REPLACE FUNCTION public.get_product_last_sales(
  p_erp_product_id  integer,
  p_erp_sucursal_id integer
)
RETURNS TABLE (
  fecha       date,
  cantidad    numeric,
  total_linea numeric
)
LANGUAGE sql STABLE AS $function$
  SELECT
    inv.fecha::date,
    SUM(ii.cantidad::numeric
        * COALESCE((regexp_match(ii.presentacion, '[0-9]+[xX]([0-9]+)'))[1]::int, 1)) AS cantidad,
    SUM(ii.total_linea) AS total_linea
  FROM sales_invoice_items ii
  JOIN sales_invoices inv   ON inv.id = ii.invoice_id
  JOIN erp_sucursal_map bm  ON bm.branch_id = inv.branch_id
  WHERE ii.erp_product_id   = p_erp_product_id
    AND bm.erp_sucursal_id  = p_erp_sucursal_id
    AND inv.estado          != 'ANULADA'
    AND ii.cantidad          > 0
  GROUP BY inv.fecha::date
  ORDER BY inv.fecha DESC
  LIMIT 6;
$function$;

GRANT EXECUTE ON FUNCTION public.get_product_last_sales(integer, integer) TO authenticated, service_role;
