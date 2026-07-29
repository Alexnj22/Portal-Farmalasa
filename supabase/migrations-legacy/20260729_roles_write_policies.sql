-- 20260729_roles_write_policies
--
-- AUDITORIA-SUPABASE-2026-07-29.md, S2: `roles` tenía INSERT y UPDATE con
-- `true`, es decir que CUALQUIER usuario autenticado —incluido el rol más bajo
-- del portal— podía crear roles nuevos o modificar los existentes.
--
-- Es escalada de privilegios por la vía de los datos: los permisos del portal se
-- resuelven contra `role_permissions` a partir del rol del empleado, así que
-- poder editar `roles` es poder reescribir quién puede qué. No hacía falta
-- ninguna vulnerabilidad de código: bastaba un PostgREST directo con la sesión
-- de cualquier empleado.
--
-- El gate correcto ya existía en la MISMA tabla: `roles_delete` usa
-- `auth_can_edit_any(ARRAY['roles','permissions'])`. El hardening del
-- 2026-07-02 cubrió las lecturas y el DELETE, y dejó INSERT/UPDATE afuera. Acá
-- se alinean con su propia policy de borrado — no se inventa un criterio nuevo.
--
-- El wrapper `(SELECT ...)` es obligatorio (incidente 2026-07-08): sin él
-- Postgres evalúa la función POR FILA.

SET lock_timeout = '5s';

ALTER POLICY admin_write  ON public.roles
    WITH CHECK ((SELECT auth_can_edit_any(ARRAY['roles', 'permissions'])));

ALTER POLICY admin_update ON public.roles
    USING      ((SELECT auth_can_edit_any(ARRAY['roles', 'permissions'])))
    WITH CHECK ((SELECT auth_can_edit_any(ARRAY['roles', 'permissions'])));
