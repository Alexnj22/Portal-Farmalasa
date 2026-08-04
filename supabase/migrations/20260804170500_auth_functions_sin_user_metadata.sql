SET lock_timeout = '5s';

-- ─────────────────────────────────────────────────────────────────────────────
-- Saca `user_metadata` de TODA decisión de autorización.
--
-- El navegador puede escribir su propio user_metadata con
-- `supabase.auth.updateUser({ data })` — no es una hipótesis: el portal lo usa
-- así en LoginView.jsx:356 para marcar must_change_password. Y siete funciones
-- lo leían para decidir permisos:
--
--   · auth_has_module_permission / auth_can_edit_any / auth_can_edit_scope_all
--     daban acceso TOTAL si user_metadata.systemRole = 'SUPERADMIN'.
--   · auth_employee_id / _role_id / _secondary_role_id / _branch_id resolvían
--     al empleado por user_metadata.code, o sea que el cliente elegía identidad.
--
-- Verificado en prod antes del cambio (empleado código 163, cargo 30
-- «Dependiente de Farmacia»): con su metadata real, auditview/can_view = false y
-- can_edit_any('compras') = false; agregando {"systemRole":"SUPERADMIN"} al
-- metadata, los dos pasaban a true.
--
-- Desde acá la identidad sale de `auth.uid()` (claim firmado, no manipulable) y,
-- para las cuentas del kiosco/carné, de employee_auth_accounts — que solo
-- service_role escribe. El correo tampoco se usa: las 50 cuentas del portal
-- tienen uid = employees.id por construcción (bulk-create-employee-users y
-- set-employee-password llaman a createUser con `id: employee.id`).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.auth_employee_id()
 RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT e.id FROM public.employees e
  WHERE e.id = (select auth.uid())
     OR e.id = (SELECT l.employee_id FROM public.employee_auth_accounts l
                 WHERE l.auth_user_id = (select auth.uid()))
  ORDER BY (e.id = (select auth.uid())) DESC
  LIMIT 1;
$function$;

CREATE OR REPLACE FUNCTION public.auth_employee_role_id()
 RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT e.role_id FROM public.employees e
  WHERE e.id = (select auth.uid())
     OR e.id = (SELECT l.employee_id FROM public.employee_auth_accounts l
                 WHERE l.auth_user_id = (select auth.uid()))
  ORDER BY (e.id = (select auth.uid())) DESC
  LIMIT 1;
$function$;

CREATE OR REPLACE FUNCTION public.auth_employee_secondary_role_id()
 RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT e.secondary_role_id FROM public.employees e
  WHERE e.id = (select auth.uid())
     OR e.id = (SELECT l.employee_id FROM public.employee_auth_accounts l
                 WHERE l.auth_user_id = (select auth.uid()))
  ORDER BY (e.id = (select auth.uid())) DESC
  LIMIT 1;
$function$;

CREATE OR REPLACE FUNCTION public.auth_employee_branch_id()
 RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT e.branch_id FROM public.employees e
  WHERE e.id = (select auth.uid())
     OR e.id = (SELECT l.employee_id FROM public.employee_auth_accounts l
                 WHERE l.auth_user_id = (select auth.uid()))
  ORDER BY (e.id = (select auth.uid())) DESC
  LIMIT 1;
$function$;

-- El system_role real, leído de la tabla. Reemplaza al claim del JWT como
-- única fuente del bypass de superadministrador.
CREATE OR REPLACE FUNCTION public.auth_employee_system_role()
 RETURNS text LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT e.system_role FROM public.employees e
  WHERE e.id = (select auth.uid())
     OR e.id = (SELECT l.employee_id FROM public.employee_auth_accounts l
                 WHERE l.auth_user_id = (select auth.uid()))
  ORDER BY (e.id = (select auth.uid())) DESC
  LIMIT 1;
$function$;

REVOKE EXECUTE ON FUNCTION public.auth_employee_system_role() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.auth_employee_system_role() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.auth_has_module_permission(p_module_key text, p_action text)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT
    COALESCE((SELECT public.auth_employee_system_role()), '') = 'SUPERADMIN'
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
$function$;

CREATE OR REPLACE FUNCTION public.auth_can_edit_any(p_modules text[])
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT
    COALESCE((SELECT public.auth_employee_system_role()), '') = 'SUPERADMIN'
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
$function$;

CREATE OR REPLACE FUNCTION public.auth_can_edit_scope_all(p_modules text[])
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT
    COALESCE((SELECT public.auth_employee_system_role()), '') = 'SUPERADMIN'
    OR EXISTS (
      SELECT 1 FROM public.role_permissions rp
      WHERE rp.role_id IN (public.auth_employee_role_id(), public.auth_employee_secondary_role_id())
        AND rp.module_key = ANY(p_modules)
        AND rp.can_edit
        AND COALESCE(rp.scope, 'ALL') = 'ALL'
    );
$function$;
