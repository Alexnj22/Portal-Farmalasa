SET lock_timeout = '5s';

-- ════════════════════════════════════════════════════════════════════════════
-- El desajuste que dejó D4b: la puerta de la BASE y la de la PANTALLA no
-- nombran el mismo permiso.
--
-- El arranque (`systemSlice.js`) pide TODOS los `employee_events` y
-- `employee_documents` cuando el cargo tiene `staff_list`. La policy de ayer
-- los entrega con `staff_detail`. No da error: RLS devuelve sólo las filas
-- propias y la pantalla queda vacía en silencio — el fallo que no se ve.
-- Hoy alcanza a un cargo (Administrador, 1 persona) y no se nota porque
-- `employee_documents` tiene 0 filas y `employee_events` 1; el mecanismo es
-- lo que se arregla, no el síntoma.
--
-- El criterio sale de QUIÉN CONSUME el dato, no de qué vista lo pide:
--
--   · `employee_events`     → el expediente (`staff_detail`) Y el calendario de
--     horarios (`schedules`): `emp.history` marca vacaciones e incapacidades en
--     ScheduleCalendar/FormPlanificador. Hoy los 3 cargos con `schedules` tienen
--     también `staff_detail`, así que nadie lo estaba sufriendo — pero la
--     próxima persona con horarios y sin expediente perdía el calendario sin un
--     solo error en consola.
--
--   · `employee_documents`  → sólo el expediente. Se QUITA la rama
--     `emp_documents`: ese módulo es «Mis Documentos», que arma su vista con
--     `fetchOwnApprovalRequests` y NO lee esta tabla. La rama no habilitaba
--     nada y sí abría de más — un cargo la tiene sin `staff_detail` (Técnico de
--     Mantenimiento, 2 personas) y con ella leía los adjuntos de CUALQUIER
--     empleado. Lo propio ya lo cubre la primera condición.
--
-- El llamador se corrigió en el MISMO commit (`systemSlice.js`): cada consulta
-- se acota con el permiso que la BD le va a exigir.
-- ════════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS employee_events_select ON public.employee_events;
CREATE POLICY employee_events_select ON public.employee_events
  FOR SELECT TO authenticated
  USING (employee_id = (SELECT public.auth_employee_id())
      OR (SELECT public.auth_has_module_permission('staff_detail','can_view'))
      OR (SELECT public.auth_has_module_permission('schedules','can_view')));

DROP POLICY IF EXISTS employee_documents_select ON public.employee_documents;
CREATE POLICY employee_documents_select ON public.employee_documents
  FOR SELECT TO authenticated
  USING (employee_id = (SELECT public.auth_employee_id())
      OR (SELECT public.auth_has_module_permission('staff_detail','can_view')));
