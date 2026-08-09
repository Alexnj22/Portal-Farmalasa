SET lock_timeout = '5s';

-- ════════════════════════════════════════════════════════════════════════════
-- D5 · Una sola definición de superusuario.
--
-- Había DOS y no coincidían:
--   · `sufarmasalud`  — system_role = SUPERADMIN, SIN cargo → SU para el SERVIDOR
--   · `edwin.nunez`   — cargo con roles.is_su = true        → SU para el FRONTEND
-- Ninguna lo era bajo ambas. Costó una vista que salía en el menú y contestaba
-- «Acceso denegado», y dos rodeos el mismo día otorgando permisos explícitos.
--
-- EL DEFECTO DE FONDO no es que hubiera dos banderas: es que UNA DE ELLAS NO ES
-- UNA BANDERA DE PERMISOS. `employees.system_role` es la jerarquía de aprobación
-- (EMPLEADO 36, JEFE 7, SUBJEFE 2, SUPERVISOR 2, ADMIN 1, SUPERADMIN 1) y la usa
-- `src/data/requests.js` para decidir QUIÉN APRUEBA una solicitud
-- (ADMIN_SYSTEM_ROLES, el último recurso del enrutador) y
-- `WidgetAnnulmentRequest.jsx` para encontrar un administrador. Su valor
-- SUPERADMIN se tomó prestado como atajo de autorización en tres funciones.
--
-- Desde acá manda `roles.is_su`, que vive en el CARGO, al lado del resto de los
-- permisos. `system_role` conserva su trabajo real y deja de decidir accesos.
--
-- ── El paso 1 no es opcional ni se puede separar ────────────────────────────
-- `sufarmasalud` no tenía cargo. En cuanto el servidor deja de mirar
-- `system_role`, esa cuenta pierde TODO. Por eso el cargo y las funciones van en
-- la MISMA migración: separadas, un fallo en el medio deja la cuenta de sistema
-- afuera.
--
-- ── ROLLBACK ────────────────────────────────────────────────────────────────
-- Las tres funciones eran idénticas salvo la primera línea, que decía:
--     COALESCE((SELECT public.auth_employee_system_role()), '') = 'SUPERADMIN'
-- Volver a poner esa expresión donde ahora dice `(SELECT public.auth_is_su())`
-- restaura el comportamiento anterior. El resto del cuerpo NO se tocó.
--
-- Ensayado en staging con 10 casos sobre las tres funciones, incluido el que
-- debe cambiar: SUPERADMIN sin is_su ahora NIEGA.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1 · El cargo, primero ───────────────────────────────────────────────────
INSERT INTO public.roles (name, is_su)
SELECT 'Superusuario del Sistema', true
WHERE NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Superusuario del Sistema');

UPDATE public.employees e
   SET role_id = (SELECT id FROM public.roles WHERE name = 'Superusuario del Sistema')
 WHERE e.system_role = 'SUPERADMIN' AND e.role_id IS NULL;

-- ── 2 · Las tres funciones dejan de mirar `system_role` ─────────────────────
CREATE OR REPLACE FUNCTION public.auth_has_module_permission(p_module_key text, p_action text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $fn$
  SELECT
    (SELECT public.auth_is_su())
    OR EXISTS (
      SELECT 1 FROM public.role_permissions rp
      WHERE rp.role_id = public.auth_employee_role_id()
        AND rp.module_key = p_module_key
        AND CASE p_action
              WHEN 'can_view'    THEN rp.can_view
              WHEN 'can_edit'    THEN rp.can_edit
              WHEN 'can_approve' THEN rp.can_approve
              ELSE false
            END
    )
    OR EXISTS (
      SELECT 1 FROM public.role_permissions rp
      WHERE rp.role_id = public.auth_employee_secondary_role_id()
        AND rp.module_key = p_module_key
        AND CASE p_action
              WHEN 'can_view'    THEN rp.can_view
              WHEN 'can_edit'    THEN rp.can_edit
              WHEN 'can_approve' THEN rp.can_approve
              ELSE false
            END
    );
$fn$;

-- El atajo queda ANTES de `auth_module_locked` a propósito, igual que estaba:
-- el superusuario salta el candado de mantenimiento. Con una sola definición,
-- un solo comportamiento.
CREATE OR REPLACE FUNCTION public.auth_can_edit_any(p_modules text[])
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $fn$
  SELECT
    (SELECT public.auth_is_su())
    OR (
      NOT public.auth_module_locked(p_modules)
      AND (
        EXISTS (
          SELECT 1 FROM public.role_permissions rp
          WHERE rp.role_id = public.auth_employee_role_id()
            AND rp.module_key = ANY(p_modules)
            AND rp.can_edit
        )
        OR EXISTS (
          SELECT 1 FROM public.role_permissions rp
          WHERE rp.role_id = public.auth_employee_secondary_role_id()
            AND rp.module_key = ANY(p_modules)
            AND rp.can_edit
        )
      )
    );
$fn$;

CREATE OR REPLACE FUNCTION public.auth_can_edit_scope_all(p_modules text[])
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $fn$
  SELECT
    (SELECT public.auth_is_su())
    OR EXISTS (
      SELECT 1 FROM public.role_permissions rp
      WHERE rp.role_id IN (public.auth_employee_role_id(), public.auth_employee_secondary_role_id())
        AND rp.module_key = ANY(p_modules)
        AND rp.can_edit
        AND COALESCE(rp.scope, 'ALL') = 'ALL'
    );
$fn$;

-- ── 3 · Los rodeos, que son la prueba de que funcionó ───────────────────────
-- `sesiones` y `bloqueos` se le habían otorgado al cargo 13 para esquivar este
-- mismo defecto. Si el arreglo es correcto ya no hacen falta, y dejarlos puestos
-- escondería si funcionó. Verificado después de borrarlos: ese cargo sigue
-- viendo, cerrando y bloqueando, por ser is_su.
DELETE FROM public.role_permissions
 WHERE role_id = 13 AND module_key IN ('sesiones','bloqueos');
