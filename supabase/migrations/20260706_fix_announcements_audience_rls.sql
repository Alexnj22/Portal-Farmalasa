-- BUG CRÍTICO confirmado: la policy de SELECT en announcements comparaba
-- target_type='ALL' (la app nunca escribe eso, escribe 'GLOBAL') y no tenía
-- ninguna cláusula para 'EMPLOYEE'. Además comparaba target_value::text
-- (cast de jsonb, que incluye comillas: '"3"') contra valores planos sin
-- comillas — la comparación de BRANCH tampoco habría matcheado nunca. Y ROLE
-- comparaba target_value (la app guarda el NOMBRE del rol, ej. "Regente")
-- contra auth_employee_role_id() (un id numérico) — tampoco podía matchear.
-- Resultado real en producción: empleados sin permiso can_edit en
-- announcements (o sea, todos los no-admin) no veían NINGÚN aviso dirigido
-- a ellos por GLOBAL, ROLE o EMPLOYEE. Solo BRANCH tenía intención correcta
-- pero fallaba igual por el problema de comillas del cast jsonb.

-- auth_employee_branch_id() no tenía el mismo fallback por username/code que
-- sus funciones hermanas (auth_employee_id, auth_employee_role_id) — los
-- logins por carné (@staff.local, donde auth.uid() != employees.id) nunca
-- resolvían su sucursal.
CREATE OR REPLACE FUNCTION public.auth_employee_branch_id()
RETURNS integer
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
  SELECT e.branch_id FROM public.employees e
  WHERE e.id = (select auth.uid())
     OR (e.username IS NOT NULL AND e.username = split_part((select auth.email()), '@', 1))
     OR (e.code IS NOT NULL AND upper(e.code) = upper(COALESCE(((select auth.jwt()) -> 'user_metadata') ->> 'code', '')))
  ORDER BY (e.id = (select auth.uid())) DESC
  LIMIT 1;
$function$;

DROP POLICY IF EXISTS announcements_audience ON public.announcements;
CREATE POLICY announcements_audience ON public.announcements
  FOR SELECT
  USING (
    target_type = 'GLOBAL'
    OR (target_type = 'BRANCH' AND (target_value #>> '{}') = auth_employee_branch_id()::text)
    OR (target_type = 'ROLE' AND (target_value #>> '{}') = (SELECT r.name FROM public.roles r WHERE r.id = auth_employee_role_id()))
    OR (target_type = 'EMPLOYEE' AND target_value @> to_jsonb(auth_employee_id()::text))
    OR auth_has_module_permission('announcements', 'can_edit')
  );
