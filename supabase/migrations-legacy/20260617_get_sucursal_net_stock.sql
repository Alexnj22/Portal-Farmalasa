-- get_sucursal_net_stock: stock total en sucursales (excl. bodega=6) por producto.
-- Usado por el CSV de bodega para calcular días de cobertura de la red completa.
-- Sin este dato, la alerta solo veía el stock de bodega vs su MIN, ignorando
-- lo que las sucursales ya tienen en anaquel.

CREATE OR REPLACE FUNCTION public.get_sucursal_net_stock(
  p_product_ids integer[]
)
RETURNS TABLE (
  erp_product_id integer,
  net_stock      bigint
)
LANGUAGE sql STABLE AS $function$
  SELECT
    i.erp_product_id,
    SUM(
      i.cantidad
      * COALESCE((regexp_match(i.presentacion, '[0-9]+[xX]([0-9]+)'))[1]::int, 1)
    )::bigint AS net_stock
  FROM inventory i
  WHERE i.erp_product_id = ANY(p_product_ids)
    AND i.erp_sucursal_id != 6
    AND i.is_vencidos = false
  GROUP BY i.erp_product_id;
$function$;

GRANT EXECUTE ON FUNCTION public.get_sucursal_net_stock(integer[]) TO authenticated, service_role;
