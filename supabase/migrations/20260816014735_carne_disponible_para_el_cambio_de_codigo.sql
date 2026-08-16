SET lock_timeout = '5s';

-- ¿Está libre este código de carné?
--
-- `FormNovedad` y el alta/edición de personal comprobaban el choque en el
-- navegador, cruzando el código nuevo contra la lista de empleados ya cargada.
-- Sin `code` en esa lista la comprobación no encontraría nunca un choque — y
-- «no encontré» se ve igual que «no hay». Dos personas con el mismo código son
-- dos personas con la misma contraseña del portal.
--
-- Contesta sí/no y NADA más: decir de quién es el código convertiría esto en el
-- oráculo que `identificar_por_carne` evita. Mira también `username` y
-- `kiosk_pin` porque los tres son formas de entrar, y el trigger
-- `enforce_numeric_employee_code` sólo cuida el formato, no la unicidad.
CREATE OR REPLACE FUNCTION public.carne_disponible(p_code text, p_excluir uuid DEFAULT NULL)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
    SELECT (SELECT auth_has_module_permission('staff_list','can_edit'))
       AND NOT EXISTS (
        SELECT 1 FROM public.employees e
         WHERE e.status = 'ACTIVO'
           AND (p_excluir IS NULL OR e.id <> p_excluir)
           AND (
                upper(btrim(coalesce(e.code,'')))      = upper(btrim(coalesce(p_code,'')))
             OR upper(btrim(coalesce(e.kiosk_pin,''))) = upper(btrim(coalesce(p_code,'')))
             OR lower(btrim(coalesce(e.username,'')))  = lower(btrim(coalesce(p_code,'')))
           )
           AND btrim(coalesce(p_code,'')) <> ''
    );
$function$;

REVOKE EXECUTE ON FUNCTION public.carne_disponible(text, uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.carne_disponible(text, uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.carne_disponible(text, uuid) IS
 'Si/no sobre si un codigo de carne esta libre. No dice de quien es: eso lo convertiria en el oraculo que identificar_por_carne evita.';
