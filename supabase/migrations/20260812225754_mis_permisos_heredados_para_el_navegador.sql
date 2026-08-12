-- Lo que heredo hoy por la ausencia de un cargo que depende de mí.
--
-- La base ya lo respeta —`auth_has_module_permission` incluye la herencia desde
-- v2.577.0— pero el navegador arma su mapa de permisos LEYENDO
-- `role_permissions` de mis dos cargos, y ahí la herencia no aparece: depende
-- de quién esté hoy de vacaciones, así que sólo lo sabe el servidor.
--
-- Sin esto el suplente entra y la pantalla le esconde todo aunque la base se lo
-- permita: los botones no se dibujan y las rutas se bloquean antes de llegar a
-- consultar nada. O sea que el mecanismo funcionaba y no servía.
--
-- Mismo criterio de unión que usa el cargo secundario en `AuthContext`: el
-- permiso efectivo es el OR y en el alcance gana el más permisivo. `max()`
-- sobre el texto NO sirve para eso —alfabéticamente 'MINE' > 'BRANCH' > 'ALL',
-- justo al revés de lo que se necesita—, así que el orden va escrito.

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.mis_permisos_heredados()
RETURNS TABLE (module_key text, can_view boolean, can_edit boolean,
               can_approve boolean, scope text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT rp.module_key,
         bool_or(rp.can_view)    AS can_view,
         bool_or(rp.can_edit)    AS can_edit,
         bool_or(rp.can_approve) AS can_approve,
         CASE WHEN bool_or(rp.scope = 'ALL')    THEN 'ALL'
              WHEN bool_or(rp.scope = 'BRANCH') THEN 'BRANCH'
              ELSE 'MINE' END    AS scope
  FROM public.roles hijo
  JOIN public.role_permissions rp ON rp.role_id = hijo.id
  WHERE rp.delega_en_ausencia
    AND hijo.parent_role_id = (SELECT public.auth_employee_role_id())
    AND (rp.can_view OR rp.can_edit OR rp.can_approve)
    -- El cargo tiene gente…
    AND EXISTS (SELECT 1 FROM public.employees e
                 WHERE e.role_id = hijo.id AND e.status = 'ACTIVO')
    -- …y no queda ni una disponible. Mismas dos condiciones que
    -- `hereda_por_ausencia_rol`: sin la primera, un cargo vacío delegaría para
    -- siempre.
    AND NOT EXISTS (SELECT 1 FROM public.employees e
                     WHERE e.role_id = hijo.id AND e.status = 'ACTIVO'
                       AND NOT public.empleado_no_disponible(e.id))
  GROUP BY rp.module_key;
$$;

REVOKE EXECUTE ON FUNCTION public.mis_permisos_heredados() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.mis_permisos_heredados() TO authenticated, service_role;

COMMENT ON FUNCTION public.mis_permisos_heredados() IS
  'Los modulos que quien consulta hereda hoy por la ausencia de un cargo que depende del suyo. El navegador los une a los de sus dos cargos.';
