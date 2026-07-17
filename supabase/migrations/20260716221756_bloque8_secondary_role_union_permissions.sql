SET lock_timeout = '5s';

-- Bloque 8: el cargo secundario (employees.secondary_role_id) ahora SUMA
-- permisos vía modelo de unión (primario OR secundario), en vez de ser
-- puramente cosmético. Ver PLAN-EJECUCION-2026-07.md Bloque 8.

CREATE OR REPLACE FUNCTION public.auth_employee_secondary_role_id()
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT e.secondary_role_id FROM public.employees e
  WHERE e.id = (select auth.uid())
     OR (e.username IS NOT NULL AND e.username = split_part((select auth.email()), '@', 1))
     OR (e.code IS NOT NULL AND upper(e.code) = upper(COALESCE(((select auth.jwt()) -> 'user_metadata') ->> 'code', '')))
  ORDER BY (e.id = (select auth.uid())) DESC
  LIMIT 1;
$function$;

REVOKE ALL ON FUNCTION public.auth_employee_secondary_role_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.auth_employee_secondary_role_id() FROM anon;
GRANT EXECUTE ON FUNCTION public.auth_employee_secondary_role_id() TO authenticated;

CREATE OR REPLACE FUNCTION public.auth_has_module_permission(p_module_key text, p_action text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT
    COALESCE(((select auth.jwt()) -> 'user_metadata') ->> 'systemRole', '') = 'SUPERADMIN'
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
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT
    COALESCE(((select auth.jwt()) -> 'user_metadata') ->> 'systemRole', '') = 'SUPERADMIN'
    OR EXISTS (
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
    );
$function$;

CREATE OR REPLACE FUNCTION public.auth_module_scope(p_module_key text)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT CASE
    WHEN 'ALL' IN (
      COALESCE((SELECT rp.scope FROM public.role_permissions rp WHERE rp.role_id = public.auth_employee_role_id() AND rp.module_key = p_module_key), ''),
      COALESCE((SELECT rp.scope FROM public.role_permissions rp WHERE rp.role_id = public.auth_employee_secondary_role_id() AND rp.module_key = p_module_key), '')
    ) THEN 'ALL'
    ELSE COALESCE(
      (SELECT rp.scope FROM public.role_permissions rp WHERE rp.role_id = public.auth_employee_role_id() AND rp.module_key = p_module_key),
      (SELECT rp.scope FROM public.role_permissions rp WHERE rp.role_id = public.auth_employee_secondary_role_id() AND rp.module_key = p_module_key),
      'ALL'
    )
  END;
$function$;
