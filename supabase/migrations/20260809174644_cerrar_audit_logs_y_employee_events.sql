SET lock_timeout = '5s';

-- ════════════════════════════════════════════════════════════════════════════
-- D3 y D4b. Se aplican DESPUÉS de que los llamadores dejaran de leer estas
-- tablas — con `audit_log_de_sucursal`, `audit_log_de_producto` y
-- `empleado_no_disponible` ya en su lugar.
--
-- El orden importaba: cerrar primero habría dejado a `isUnavailable` devolviendo
-- «disponible» sin error, y las solicitudes se habrían ido a aprobadores de
-- vacaciones. Un fallo callado, que es el peor.
-- ════════════════════════════════════════════════════════════════════════════

-- La bitácora: quién hizo qué en todo el portal. Sólo la Bitácora General.
DROP POLICY IF EXISTS admin_read ON public.audit_logs;
CREATE POLICY audit_logs_select ON public.audit_logs
  FOR SELECT TO authenticated
  USING ((SELECT public.auth_has_module_permission('auditview','can_view')));

-- El historial del expediente: el propio, o el módulo. Su INSERT y UPDATE ya
-- estaban gateados con auth_can_edit_any(['staff_detail']); el agujero era sólo
-- la lectura.
DROP POLICY IF EXISTS employee_events_select ON public.employee_events;
CREATE POLICY employee_events_select ON public.employee_events
  FOR SELECT TO authenticated
  USING (employee_id = (SELECT public.auth_employee_id())
      OR (SELECT public.auth_has_module_permission('staff_detail','can_view')));
