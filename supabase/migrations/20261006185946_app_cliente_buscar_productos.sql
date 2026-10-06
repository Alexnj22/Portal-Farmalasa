-- App de clientes: «¿Lo tienen?» (2026-10-06). PREPARADA, sin usar todavía:
-- el usuario decidió que el catálogo completo va después; por ahora la app
-- sólo reserva productos de ofertas activas.
--
-- Busca con el MISMO buscador del portal (`buscar_productos_ids`) y devuelve,
-- por producto, precio desde, foto, si va bajo receta y en qué sucursales hay
-- («hay» / «pocas», nunca la cantidad exacta). Sólo farmacias, sin vencidos.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.app_cliente_buscar_productos(p_q text)
 RETURNS json
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'extensions'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
  v_ids bigint[];
  v_res json;
BEGIN
  IF length(trim(coalesce(p_q, ''))) < 3 THEN
    RETURN json_build_object('productos', '[]'::json);
  END IF;
  SELECT array_agg((x)::bigint) INTO v_ids
    FROM json_array_elements_text((public.buscar_productos_ids(p_q, 20, true, false, true))->'ids') x;
  IF v_ids IS NULL THEN
    RETURN json_build_object('productos', '[]'::json);
  END IF;

  SELECT json_agg(r ORDER BY array_position(v_ids, r.id)) INTO v_res
  FROM (
    SELECT p.id, p.nombre, p.foto_url AS foto,
           (coalesce(p.es_antibiotico, false) OR coalesce(p.requiere_receta, false)) AS bajo_receta,
           (SELECT min(pr.vineta) FROM public.product_precios pr
             WHERE pr.product_id = p.id AND pr.activo IS DISTINCT FROM false AND pr.vineta > 0) AS precio,
           coalesce((
             SELECT json_agg(json_build_object('branch_id', s.branch_id, 'nivel', CASE WHEN s.cant >= 5 THEN 'hay' ELSE 'pocas' END)
                             ORDER BY s.branch_id)
               FROM (SELECT m.branch_id, sum(i.cantidad) AS cant
                       FROM public.inventory i
                       JOIN public.erp_sucursal_map m ON m.erp_sucursal_id = i.erp_sucursal_id AND NOT m.es_bodega
                      WHERE i.erp_product_id = p.id AND NOT coalesce(i.is_vencidos, false)
                      GROUP BY m.branch_id
                     HAVING sum(i.cantidad) > 0) s
           ), '[]'::json) AS existencias
      FROM public.products p
     WHERE p.id = ANY (v_ids) AND p.activo IS DISTINCT FROM false AND NOT coalesce(p.oculto_en_ventas, false)
  ) r;
  RETURN json_build_object('productos', coalesce(v_res, '[]'::json));
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.app_cliente_buscar_productos(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_cliente_buscar_productos(text) TO service_role;
