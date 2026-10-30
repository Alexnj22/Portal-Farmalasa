SET lock_timeout = '5s';
-- Los números de compra que entraron desde el portal, para el filtro «Desde
-- el portal / A mano» de Compras. Devuelve json (no SETOF): no cae bajo el
-- techo de 1000 filas. Hoy son pocos (una carga por factura); el filtro los
-- manda en la URL, así que si un día pasan de ~1500 hay que mover el filtro
-- a la base.
CREATE OR REPLACE FUNCTION public.compras_erp_ids_desde_portal()
RETURNS json LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions AS $$
  SELECT coalesce(json_agg(DISTINCT c.erp_compra_id), '[]'::json)
    FROM public.compra_carga c
   WHERE c.erp_compra_id IS NOT NULL
     AND ((SELECT auth_has_module_permission('compras','can_view'))
       OR (SELECT auth_has_module_permission('cargar_compra','can_view')));
$$;
REVOKE EXECUTE ON FUNCTION public.compras_erp_ids_desde_portal() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.compras_erp_ids_desde_portal() TO authenticated, service_role;
