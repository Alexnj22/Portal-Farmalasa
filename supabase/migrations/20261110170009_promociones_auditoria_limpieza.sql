-- Limpieza tras 20261110162527 (auditoría de Promociones).
--  · `descuentos_espejo_borrar` pasa a plpgsql: como LANGUAGE sql con SET nacía
--    con plan genérico (gate:perf, sección E). Es un UPDATE por PK; el cuerpo
--    no cambia.
--  · `promocion_descuentos_por_ligar` queda sin uso: la ventana de reactivar
--    lee `promocion_descuentos`, que trae ligados y candidatos en una llamada.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.descuentos_espejo_borrar(p_id integer)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE n integer;
BEGIN
    UPDATE public.descuentos_espejo SET borrado_at = now(), updated_at = now()
     WHERE id = p_id AND borrado_at IS NULL;
    GET DIAGNOSTICS n = ROW_COUNT;
    RETURN n > 0;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.descuentos_espejo_borrar(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.descuentos_espejo_borrar(integer) TO service_role;

DROP FUNCTION IF EXISTS public.promocion_descuentos_por_ligar(bigint);
