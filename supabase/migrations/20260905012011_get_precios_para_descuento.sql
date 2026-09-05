SET lock_timeout = '5s';

-- Precio y costo de unos productos, para ver EN QUÉ QUEDA el precio mientras se
-- arma un descuento.
--
-- Se toma el precio MÁS BAJO de cada producto y el costo MÁS ALTO: el peor caso
-- es el que decide. Si la presentación con menos margen aguanta el descuento,
-- todas aguantan; al revés, un promedio esconde justo la que se vendería
-- perdiendo.
--
-- `RETURNS json` y no `SETOF`: así no cae bajo el techo de las 1000 filas de
-- PostgREST. NO lleva `plan_cache_mode = 'force_custom_plan'` a propósito —
-- `id = ANY(...)` entra por la clave primaria valga el arreglo 1 o 50, o sea
-- que el plan bueno NO depende de los argumentos y forzarlo sólo agregaría el
-- costo de replanificar en cada llamada.
CREATE OR REPLACE FUNCTION public.get_precios_para_descuento(p_ids int[])
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
    v_out json;
BEGIN
    IF NOT public.auth_has_module_permission('promociones','can_view') THEN
        RETURN NULL;
    END IF;

    SELECT coalesce(json_agg(to_json(x) ORDER BY x.nombre), '[]'::json)
      INTO v_out
      FROM (
        SELECT p.id,
               p.nombre,
               min(pp.vineta) FILTER (WHERE pp.activo AND pp.vineta > 0) AS precio,
               max(pp.costo)  FILTER (WHERE pp.activo AND pp.costo  > 0) AS costo
          FROM public.products p
          LEFT JOIN public.product_precios pp ON pp.product_id = p.id
         WHERE p.id = ANY(p_ids)
         GROUP BY p.id, p.nombre
      ) x;

    RETURN v_out;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_precios_para_descuento(int[]) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_precios_para_descuento(int[]) TO authenticated, service_role;
