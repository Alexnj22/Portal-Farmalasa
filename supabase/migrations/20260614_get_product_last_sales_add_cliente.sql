-- Agrega campo cliente a get_product_last_sales y muestra transacciones individuales
CREATE OR REPLACE FUNCTION public.get_product_last_sales(
  p_erp_product_id  integer,
  p_erp_sucursal_id integer
)
RETURNS TABLE (
  fecha       date,
  cantidad    numeric,
  total_linea numeric,
  cliente     text
)
LANGUAGE sql STABLE AS $function$
  SELECT
    inv.fecha::date,
    (ii.cantidad::numeric
      * COALESCE((regexp_match(ii.presentacion, '[0-9]+[xX]([0-9]+)'))[1]::int, 1)) AS cantidad,
    ii.total_linea,
    inv.cliente
  FROM sales_invoice_items ii
  JOIN sales_invoices inv   ON inv.id = ii.invoice_id
  JOIN erp_sucursal_map bm  ON bm.branch_id = inv.branch_id
  WHERE ii.erp_product_id   = p_erp_product_id
    AND bm.erp_sucursal_id  = p_erp_sucursal_id
    AND inv.estado          != 'ANULADA'
    AND ii.cantidad          > 0
  ORDER BY inv.fecha DESC, inv.id DESC
  LIMIT 8;
$function$;

GRANT EXECUTE ON FUNCTION public.get_product_last_sales(integer, integer) TO authenticated, service_role;
