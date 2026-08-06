-- Cierra las dos policies de INSERT con WITH CHECK (true) que quedaron abiertas
-- (auditoría 2026-07-30, Fase A3). Con `true` cualquier autenticado podía:
--   · fabricar una marcación de asistencia a nombre de cualquier empleado, y
--   · escribir en la bitácora con el user_id de otro — o sea falsificarla.
--
-- La regla de CLAUDE.md ya prohibía `USING (true)` en UPDATE/DELETE; lo que
-- faltaba escrito era que el INSERT también necesita decir QUIÉN puede escribir
-- QUÉ. Una tabla append-only no necesita policy de DELETE, pero sí ésta.
--
-- Contexto medido antes de aplicar (2026-08-05):
--   · `attendance` tiene 0 filas — el kiosco vive en /kiosk, FUERA del guard de
--     autenticación (App.jsx:541), así que hoy entra como `anon` y no tiene
--     policy de INSERT: no escribe nada. Endurecer el lado `authenticated` no
--     puede romper lo que no está escribiendo. Cuando el kiosco se active va a
--     necesitar un RPC SECURITY DEFINER, no una policy más laxa.
--   · `audit_logs` tiene 12,818 filas; las 16 con user_id NULL son de `source`
--     SYSTEM, escritas por service_role, que no pasa por RLS.
--   · employees.id ES el id de auth.users en los 50 empleados, así que
--     `auth.uid()` es la clave correcta para la autoría.

SET lock_timeout = '5s';

-- ── audit_logs ────────────────────────────────────────────────────────────
-- La autoría sale del servidor, nunca del cliente: hoy `appendAuditLog` manda
-- `user_id` desde localStorage (`sb_user`), que el navegador escribe.
DROP POLICY IF EXISTS admin_insert ON public.audit_logs;

CREATE POLICY audit_logs_insert ON public.audit_logs
    FOR INSERT TO authenticated
    WITH CHECK (user_id = (SELECT auth.uid()));

COMMENT ON POLICY audit_logs_insert ON public.audit_logs IS
    'Cada quien firma con su propia identidad: user_id tiene que ser el auth.uid() de la sesión. Reemplaza a admin_insert, que tenía WITH CHECK (true). Las entradas de sistema entran por service_role, que no pasa por RLS.';

-- ── attendance ────────────────────────────────────────────────────────────
-- Dos caminos legítimos: marcar lo propio, o corregir marcaciones con el
-- permiso que YA gobierna el UPDATE y el DELETE de esta misma tabla
-- (`time_audit.can_edit`, con su alcance por sucursal). Las llamadas a auth_*
-- van envueltas en (SELECT ...) — sin el initplan, Postgres las evalúa por fila
-- (incidente 2026-07-08).
DROP POLICY IF EXISTS attendance_insert ON public.attendance;

CREATE POLICY attendance_insert ON public.attendance
    FOR INSERT TO authenticated
    WITH CHECK (
        employee_id = (SELECT public.auth_employee_id())
        OR (
            (SELECT public.auth_has_module_permission('time_audit', 'can_edit'))
            AND (
                (SELECT public.auth_module_scope('time_audit')) = 'ALL'
                OR EXISTS (
                    SELECT 1 FROM public.employees e
                     WHERE e.id = attendance.employee_id
                       AND e.branch_id = (SELECT public.auth_employee_branch_id())
                )
            )
        )
    );

COMMENT ON POLICY attendance_insert ON public.attendance IS
    'Marcar lo propio, o corregir con time_audit.can_edit dentro del alcance. Reemplaza a la policy homónima que tenía WITH CHECK (true). El kiosco entra como anon y necesita un RPC SECURITY DEFINER cuando se active.';
