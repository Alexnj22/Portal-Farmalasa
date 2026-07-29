-- ROLLBACK de 20260729_module_locks_maintenance_gate.sql
--
-- NO se aplica en el flujo normal. Es la salida de emergencia si el candado
-- rompe la escritura del portal: restaura auth_can_edit_any() a su cuerpo
-- exacto anterior (verificado contra prod el 2026-07-29 vía pg_proc.prosrc).
--
-- Aplicar SOLO esta primera sentencia alcanza para desarmar el candado por
-- completo: sin la llamada a auth_module_locked(), las 59 policies y 23 RPCs
-- vuelven al comportamiento previo aunque la tabla y las RPCs sigan existiendo.

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.auth_can_edit_any(p_modules text[])
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $fn$
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
$fn$;

-- ── Desmontaje completo (opcional; solo si se descarta la feature entera) ────
-- Dejar comentado: liberar el candado NO requiere borrar la tabla, y borrarla
-- pierde el historial de quién bloqueó qué.
--
-- DROP FUNCTION IF EXISTS public.lock_module(text, text, int);
-- DROP FUNCTION IF EXISTS public.unlock_module(text);
-- DROP FUNCTION IF EXISTS public.auth_module_locked(text[]);
-- DROP TABLE IF EXISTS public.module_locks;

-- ── Salida rápida sin migración ──────────────────────────────────────────────
-- Si lo único que hace falta es destrabar un módulo YA (sin revertir código):
--   DELETE FROM public.module_locks WHERE module_key = '<modulo>';
-- o vaciar todos:
--   TRUNCATE public.module_locks;
