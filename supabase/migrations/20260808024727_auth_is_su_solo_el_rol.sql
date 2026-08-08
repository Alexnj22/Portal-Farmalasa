SET lock_timeout = '5s';

-- Se va la válvula de SUPERADMIN: manda el rol y nada más (decisión del
-- usuario, 2026-08-07).
--
-- La versión original abría por `system_role = 'SUPERADMIN'` además de por
-- `roles.is_su`, copiando lo que hace `auth_can_edit_any`. Sobraba: esa cuenta
-- tiene `role_id` NULL, así que la interfaz la trata como no-SU y nunca le
-- muestra el botón — o sea que la rama sólo servía para escribir por fuera de
-- la pantalla, y para eso ya está `service_role`, que se salta el RLS entero.
-- Una autorización que ninguna pantalla ejerce es superficie sin dueño.
--
-- Ahora la función es espejo EXACTO del `isSU` de AuthContext: `roles.is_su`
-- del rol primario, punto. Las dos mitades dicen lo mismo, que es lo que evita
-- que la interfaz ofrezca un botón que el servidor rechaza (o al revés).
CREATE OR REPLACE FUNCTION public.auth_is_su()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.roles r
    WHERE r.id = (SELECT public.auth_employee_role_id())
      AND r.is_su
  );
$function$;

REVOKE EXECUTE ON FUNCTION public.auth_is_su() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.auth_is_su() TO authenticated, service_role;
