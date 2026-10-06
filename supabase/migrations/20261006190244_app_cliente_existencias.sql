-- Para reservar: en qué sucursales hay un producto. «hay» (5 o más),
-- «pocas» (1 a 4) o «sin» (se puede reservar igual: queda esperando que
-- llegue). Nunca la cantidad exacta. Sólo farmacias, sin lotes vencidos.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.app_cliente_existencias(p_producto_id bigint)
 RETURNS json
 LANGUAGE sql STABLE
 SET search_path = public, extensions
AS $$
  SELECT coalesce(json_agg(json_build_object(
           'branch_id', b.id, 'sala', b.name,
           'nivel', CASE WHEN coalesce(s.cant, 0) >= 5 THEN 'hay' WHEN coalesce(s.cant, 0) > 0 THEN 'pocas' ELSE 'sin' END)
         ORDER BY coalesce(s.cant, 0) > 0 DESC, b.name), '[]'::json)
    FROM public.branches b
    LEFT JOIN (SELECT m.branch_id, sum(i.cantidad) AS cant
                 FROM public.inventory i
                 JOIN public.erp_sucursal_map m ON m.erp_sucursal_id = i.erp_sucursal_id AND NOT m.es_bodega
                WHERE i.erp_product_id = p_producto_id AND NOT coalesce(i.is_vencidos, false)
                GROUP BY m.branch_id) s ON s.branch_id = b.id
   WHERE b.type = 'FARMACIA';
$$;
REVOKE EXECUTE ON FUNCTION public.app_cliente_existencias(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_cliente_existencias(bigint) TO service_role;
