SET lock_timeout = '5s';

-- Portal sólo en computadora (2026-11-26). En un teléfono el portal no abre:
-- en iPhone se manda a App Store y en Android se pide el correo de Google.
-- Esa pantalla sale ANTES de iniciar sesión, así que la consulta es de `anon`.
-- Sólo responde el estado de UN correo exacto ('lista' | 'esperando' | 'no'):
-- no lista correos ni devuelve a quién pertenece.
CREATE OR REPLACE FUNCTION public.app_android_acceso(p_email text)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions AS $$
  SELECT CASE
           WHEN bool_or(agregado_at IS NOT NULL) THEN 'lista'
           WHEN count(*) > 0 THEN 'esperando'
           ELSE 'no'
         END
    FROM public.app_pruebas_android
   WHERE lower(email) = lower(trim(coalesce(p_email, '')))
     AND length(trim(coalesce(p_email, ''))) BETWEEN 6 AND 254;
$$;

REVOKE EXECUTE ON FUNCTION public.app_android_acceso(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_android_acceso(text) TO anon, authenticated, service_role;
