SET lock_timeout = '5s';

-- Los laboratorios que SÍ tienen productos activos, con cuántos.
--
-- Medido el 2026-09-05: hay **358 laboratorios y sólo 324 con productos
-- activos**. Los 34 restantes en un desplegable de «agregar los productos de un
-- laboratorio» sólo pueden devolver vacío — y un vacío se lee como «ese
-- laboratorio no tiene nada en promoción» en vez de «ese laboratorio no tiene
-- productos». Es la misma decisión que dejó fuera el filtro por categoría.
--
-- El conteo viaja para que el desplegable pueda decir «MEDIKEM · 150»: con 324
-- opciones y un umbral de búsqueda de 80, quien elige escribe a ciegas y el
-- número es lo único que anticipa cuántos va a traer.
--
-- `RETURNS json` para no caer bajo el techo de las 1000 filas.
CREATE OR REPLACE FUNCTION public.get_laboratorios_con_productos()
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
        SELECT l.id, l.nombre, count(p.id)::int AS productos
          FROM public.laboratorios l
          JOIN public.products p ON p.laboratorio_id = l.id AND p.activo
         GROUP BY l.id, l.nombre
      ) x;

    RETURN v_out;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_laboratorios_con_productos() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_laboratorios_con_productos() TO authenticated, service_role;
