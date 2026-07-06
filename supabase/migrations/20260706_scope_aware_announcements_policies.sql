-- Fix de mecanismo, no solo de dato: el bypass `auth_has_module_permission(...,
-- 'can_edit')` en announcements_audience/insert/update/delete ignoraba por
-- completo la columna `role_permissions.scope` — cualquier rol con
-- can_edit=true (sin importar scope='BRANCH') veía y podía escribir avisos de
-- TODA la empresa. Ya se corrigió el dato para "Dependiente de Farmacia"
-- (20260706_fix_dependiente_farmacia_announcements_perm.sql), pero sin este
-- fix el mismo bug reaparece con cualquier otro rol que reciba can_edit+scope
-- BRANCH en el futuro. Este helper y las 4 policies hacen que el bypass
-- respete scope: scope='ALL' → sigue viendo/editando toda la empresa;
-- scope='BRANCH' → el bypass no aporta nada más allá de lo que ya ve/edita
-- cualquier empleado de su propia sucursal (las cláusulas de audiencia ya
-- cubren BRANCH-propia); scope ausente (sin fila) → default 'ALL', sin
-- cambio de comportamiento para roles que no usan `scope` explícito.

CREATE OR REPLACE FUNCTION public.auth_module_scope(p_module_key text)
RETURNS text
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
  SELECT COALESCE(
    (SELECT rp.scope FROM public.role_permissions rp
     WHERE rp.role_id = public.auth_employee_role_id() AND rp.module_key = p_module_key),
    'ALL'
  );
$function$;

REVOKE EXECUTE ON FUNCTION public.auth_module_scope(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.auth_module_scope(text) TO authenticated, service_role;

DROP POLICY IF EXISTS announcements_audience ON public.announcements;
CREATE POLICY announcements_audience ON public.announcements
  FOR SELECT
  USING (
    target_type = 'GLOBAL'
    OR (target_type = 'BRANCH' AND (target_value #>> '{}') = auth_employee_branch_id()::text)
    OR (target_type = 'ROLE' AND (target_value #>> '{}') = (SELECT r.name FROM public.roles r WHERE r.id = auth_employee_role_id()))
    OR (target_type = 'EMPLOYEE' AND target_value @> to_jsonb(auth_employee_id()::text))
    OR (auth_has_module_permission('announcements', 'can_edit') AND auth_module_scope('announcements') = 'ALL')
  );

DROP POLICY IF EXISTS announcements_insert ON public.announcements;
CREATE POLICY announcements_insert ON public.announcements
  FOR INSERT
  WITH CHECK (
    auth_has_module_permission('announcements', 'can_edit')
    AND (
      auth_module_scope('announcements') = 'ALL'
      OR (target_type = 'BRANCH' AND (target_value #>> '{}') = auth_employee_branch_id()::text)
    )
  );

DROP POLICY IF EXISTS announcements_update ON public.announcements;
CREATE POLICY announcements_update ON public.announcements
  FOR UPDATE
  USING (
    auth_has_module_permission('announcements', 'can_edit')
    AND (
      auth_module_scope('announcements') = 'ALL'
      OR (target_type = 'BRANCH' AND (target_value #>> '{}') = auth_employee_branch_id()::text)
    )
  );

DROP POLICY IF EXISTS announcements_delete ON public.announcements;
CREATE POLICY announcements_delete ON public.announcements
  FOR DELETE
  USING (
    auth_has_module_permission('announcements', 'can_edit')
    AND (
      auth_module_scope('announcements') = 'ALL'
      OR (target_type = 'BRANCH' AND (target_value #>> '{}') = auth_employee_branch_id()::text)
    )
  );
