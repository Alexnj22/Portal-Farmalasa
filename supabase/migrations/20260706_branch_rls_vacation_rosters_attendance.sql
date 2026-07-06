-- Continúa el hardening de "sin permiso = sin acceso". Estas 3 tablas SÍ
-- las leen vistas self-service directamente (EmployeeHomeView,
-- EmployeeScheduleView, EmployeeProfileView) — por eso cada policy conserva
-- una cláusula de "mi propio registro" y, para employee_rosters, también
-- "compañeros de mi misma sucursal" (así funciona hoy "quién trabaja hoy"
-- en el home de cualquier empleado, sin necesitar el permiso admin de
-- 'schedules'). payrollSlice también lee vacation_plans de TODOS los
-- empleados para el cálculo de nómina — se preserva vía el permiso 'payroll'.

-- vacation_plans
DROP POLICY IF EXISTS vacation_plans_select ON public.vacation_plans;
CREATE POLICY vacation_plans_select ON public.vacation_plans
  FOR SELECT
  USING (
    employee_id = auth_employee_id()
    OR auth_has_module_permission('payroll', 'can_view')
    OR (
      auth_has_module_permission('vacation_plan', 'can_view')
      AND (auth_module_scope('vacation_plan') = 'ALL' OR branch_id = auth_employee_branch_id())
    )
  );

DROP POLICY IF EXISTS vacation_plans_insert ON public.vacation_plans;
CREATE POLICY vacation_plans_insert ON public.vacation_plans
  FOR INSERT
  WITH CHECK (
    auth_has_module_permission('vacation_plan', 'can_edit')
    AND (auth_module_scope('vacation_plan') = 'ALL' OR branch_id = auth_employee_branch_id())
  );

-- UPDATE: el propio empleado puede pedir cambio de fecha de SU plan
-- (EmployeeScheduleView) — el resto de campos ya se controla client-side,
-- igual que antes de este fix (no había ninguna restricción de columna).
DROP POLICY IF EXISTS vacation_plans_update ON public.vacation_plans;
CREATE POLICY vacation_plans_update ON public.vacation_plans
  FOR UPDATE
  USING (
    employee_id = auth_employee_id()
    OR (
      auth_has_module_permission('vacation_plan', 'can_edit')
      AND (auth_module_scope('vacation_plan') = 'ALL' OR branch_id = auth_employee_branch_id())
    )
  );

-- employee_rosters: sin branch_id propio, se resuelve vía employees.
DROP POLICY IF EXISTS employee_rosters_select ON public.employee_rosters;
CREATE POLICY employee_rosters_select ON public.employee_rosters
  FOR SELECT
  USING (
    employee_id = auth_employee_id()
    OR EXISTS (SELECT 1 FROM public.employees e WHERE e.id = employee_rosters.employee_id AND e.branch_id = auth_employee_branch_id())
    OR (auth_has_module_permission('schedules', 'can_view') AND auth_module_scope('schedules') = 'ALL')
  );

DROP POLICY IF EXISTS employee_rosters_insert ON public.employee_rosters;
CREATE POLICY employee_rosters_insert ON public.employee_rosters
  FOR INSERT
  WITH CHECK (
    auth_has_module_permission('schedules', 'can_edit')
    AND (
      auth_module_scope('schedules') = 'ALL'
      OR EXISTS (SELECT 1 FROM public.employees e WHERE e.id = employee_rosters.employee_id AND e.branch_id = auth_employee_branch_id())
    )
  );

DROP POLICY IF EXISTS employee_rosters_update ON public.employee_rosters;
CREATE POLICY employee_rosters_update ON public.employee_rosters
  FOR UPDATE
  USING (
    auth_has_module_permission('schedules', 'can_edit')
    AND (
      auth_module_scope('schedules') = 'ALL'
      OR EXISTS (SELECT 1 FROM public.employees e WHERE e.id = employee_rosters.employee_id AND e.branch_id = auth_employee_branch_id())
    )
  );

-- attendance (lectura — el módulo 'monitor' es el que gatea /monitor en la
-- app, no 'time_audit' que ya se corrigió para UPDATE/DELETE). Cada quien ve
-- su propio marcaje siempre; ver el de otros requiere permiso de monitor.
DROP POLICY IF EXISTS attendance_select ON public.attendance;
CREATE POLICY attendance_select ON public.attendance
  FOR SELECT
  USING (
    employee_id = auth_employee_id()
    OR (
      auth_has_module_permission('monitor', 'can_view')
      AND (
        auth_module_scope('monitor') = 'ALL'
        OR EXISTS (SELECT 1 FROM public.employees e WHERE e.id = attendance.employee_id AND e.branch_id = auth_employee_branch_id())
      )
    )
  );
