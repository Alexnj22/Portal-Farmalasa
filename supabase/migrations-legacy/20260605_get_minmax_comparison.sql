-- get_minmax_comparison: compara MIN/MAX del Portal (borrador o publicado) contra el ERP
-- Retorna FULL OUTER JOIN entre product_stock_params y erp_minmax para una sucursal.

CREATE OR REPLACE FUNCTION public.get_minmax_comparison(p_erp_sucursal_id integer)
RETURNS TABLE(
  erp_product_id     integer,
  product_name       text,
  laboratorio        text,
  abc_class          text,
  demand_variability text,
  pub_min            integer,
  pub_max            integer,
  draft_min          integer,
  draft_max          integer,
  erp_min            integer,
  erp_max            integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT
    COALESCE(psp.erp_product_id, em.erp_product_id)             AS erp_product_id,
    p.nombre                                                      AS product_name,
    l.nombre                                                      AS laboratorio,
    COALESCE(psp.draft_abc_class, psp.abc_class)                AS abc_class,
    COALESCE(psp.draft_demand_variability, psp.demand_variability) AS demand_variability,
    psp.min_units                                                 AS pub_min,
    psp.max_units                                                 AS pub_max,
    psp.draft_min,
    psp.draft_max,
    em.min_qty::integer                                           AS erp_min,
    em.max_qty::integer                                           AS erp_max
  FROM public.product_stock_params psp
  FULL OUTER JOIN public.erp_minmax em
    ON  em.erp_product_id  = psp.erp_product_id
    AND em.erp_sucursal_id = psp.erp_sucursal_id
  JOIN public.products p
    ON p.id = COALESCE(psp.erp_product_id, em.erp_product_id)
  LEFT JOIN public.laboratorios l
    ON l.id = p.laboratorio_id
  WHERE COALESCE(psp.erp_sucursal_id, em.erp_sucursal_id) = p_erp_sucursal_id
  ORDER BY p.nombre;
$function$;

GRANT EXECUTE ON FUNCTION public.get_minmax_comparison(integer) TO authenticated, service_role;
