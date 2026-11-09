SET lock_timeout = '5s';

-- «Ver todos» de la Tienda: cada laboratorio con algún producto a la venta en la app.
CREATE OR REPLACE FUNCTION public.app_catalogo_laboratorios()
 RETURNS json
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT coalesce(json_agg(json_build_object('id', t.id, 'nombre', t.nombre, 'foto', t.foto) ORDER BY t.nombre), '[]'::json)
    FROM (
      SELECT l.id, trim(regexp_replace(l.nombre, '^[0-9]+\s*-\s*', '')) AS nombre, l.foto
        FROM public.laboratorios l
       WHERE EXISTS (
         SELECT 1 FROM public.products p
          WHERE p.laboratorio_id = l.id
            AND p.activo IS DISTINCT FROM false AND NOT coalesce(p.oculto_en_ventas, false)
            AND NOT EXISTS (SELECT 1 FROM public.app_catalogo_ocultos o WHERE o.product_id = p.id)
            AND EXISTS (SELECT 1 FROM public.product_precios pp WHERE pp.product_id = p.id AND pp.activo AND pp.vineta > 0))
    ) t;
$function$;

REVOKE EXECUTE ON FUNCTION public.app_catalogo_laboratorios() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_catalogo_laboratorios() TO service_role;
