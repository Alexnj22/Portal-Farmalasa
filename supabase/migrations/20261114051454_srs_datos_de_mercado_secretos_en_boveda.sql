-- La cuenta de la empresa en el sistema de Datos de Mercado de la SRS y el
-- secreto de carga de propuestas, leídos de la bóveda (2026-11-14). La función
-- `srs-datos-mercado` los pide por acá cuando no los tiene como variables de
-- entorno. Sólo service_role: nadie con sesión del portal los ve.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.srs_mercado_secretos()
 RETURNS json LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path = public, extensions
AS $function$
  SELECT coalesce(json_object_agg(s.name, s.decrypted_secret), '{}'::json)
    FROM vault.decrypted_secrets s
   WHERE s.name IN ('srs_dm_usuario', 'srs_dm_clave', 'srs_carga_secreto');
$function$;

REVOKE EXECUTE ON FUNCTION public.srs_mercado_secretos() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.srs_mercado_secretos() TO service_role;
