SET lock_timeout = '5s';

-- search_ventas_ids: reemplaza el .or(erp_invoice_id.ilike,correlativo.ilike,cliente.ilike)
-- de VentasView (src/data/ventas.js). Cada columna es una alternativa (OR), no un
-- haystack combinado — son identificadores distintos de la misma factura, no campos
-- relacionados de una sola entidad como en el patrón de get_conteo_*.
CREATE OR REPLACE FUNCTION public.search_ventas_ids(p_search text, p_fini date DEFAULT NULL::date, p_ffin date DEFAULT NULL::date)
 RETURNS TABLE(id bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH pats AS (
    SELECT array_agg('%' || tok || '%') AS v_pats
    FROM unnest(string_to_array(public.norm_search(p_search), ' ')) AS tok
    WHERE tok <> ''
  )
  SELECT si.id
  FROM public.sales_invoices si, pats
  WHERE (p_fini IS NULL OR si.fecha >= p_fini)
    AND (p_ffin IS NULL OR si.fecha <= p_ffin)
    AND (pats.v_pats IS NULL
         OR public.norm_search(si.erp_invoice_id) LIKE ALL (pats.v_pats)
         OR public.norm_search(si.correlativo)    LIKE ALL (pats.v_pats)
         OR public.norm_search(si.cliente)        LIKE ALL (pats.v_pats));
$function$;

REVOKE EXECUTE ON FUNCTION public.search_ventas_ids(text, date, date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.search_ventas_ids(text, date, date) TO authenticated, service_role;

-- search_inventory_descripcion_ids: reemplaza el .ilike('descripcion', ...) /
-- or() de WidgetInventorySearch (src/data/inventory.js). `inventory` es la tabla
-- más caliente del proyecto (935M updates históricos sobre 24K filas) — no se le
-- agrega columna generada, se resuelve con RPC + expresión norm_search().
CREATE OR REPLACE FUNCTION public.search_inventory_descripcion_ids(p_search text, p_erp_sucursal_id integer DEFAULT NULL::integer)
 RETURNS TABLE(id bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH pats AS (
    SELECT array_agg('%' || tok || '%') AS v_pats
    FROM unnest(string_to_array(public.norm_search(p_search), ' ')) AS tok
    WHERE tok <> ''
  )
  SELECT i.id
  FROM public.inventory i, pats
  WHERE (p_erp_sucursal_id IS NULL OR i.erp_sucursal_id = p_erp_sucursal_id)
    AND (pats.v_pats IS NULL OR public.norm_search(i.descripcion) LIKE ALL (pats.v_pats));
$function$;

REVOKE EXECUTE ON FUNCTION public.search_inventory_descripcion_ids(text, integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.search_inventory_descripcion_ids(text, integer) TO authenticated, service_role;
