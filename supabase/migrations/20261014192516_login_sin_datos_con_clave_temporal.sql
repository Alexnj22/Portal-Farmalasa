-- Auditoría de login y sesiones 2026-10-14 · servidor (2/2).
--
-- Mientras la contraseña sea la que puso otro (`app_metadata.cambio_de_clave =
-- 'primer_acceso'`, que el navegador no puede escribir), la sesión no lee ni
-- escribe datos: sólo puede cambiar la clave. Antes el cambio obligatorio vivía
-- en el navegador y el token valía entero contra la API mientras tanto, así que
-- alguien podía quedarse con la temporal —la que conoce quien dio el alta— y
-- usar el portal igual.
--
-- `auth_no_bloqueado()` es la que usa la policy RESTRICTIVE `bloqueo_global`
-- de las 183 tablas, así que una condición acá alcanza a todas. Se aplica
-- DESPUÉS de publicar el portal que renueva la sesión al cambiar la clave
-- (v2.1290.1): con el portal viejo, quien cambiaba su clave seguía con el JWT
-- marcado hasta la próxima renovación.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.auth_no_bloqueado()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT coalesce((SELECT auth.jwt() -> 'app_metadata' ->> 'cambio_de_clave'), '') <> 'primer_acceso'
     AND NOT EXISTS (
    SELECT 1 FROM public.employees e
    WHERE (e.id = (SELECT auth.uid())
        OR e.id = (SELECT l.employee_id FROM public.employee_auth_accounts l
                    WHERE l.auth_user_id = (SELECT auth.uid())))
      AND e.blocked_until IS NOT NULL
      AND e.blocked_until > now()
  );
$function$;
