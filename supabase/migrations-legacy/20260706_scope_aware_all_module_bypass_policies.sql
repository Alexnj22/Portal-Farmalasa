-- Auditoría completa: el mismo patrón de announcements (bypass de
-- auth_has_module_permission ignorando role_permissions.scope) existe en
-- TODAS las policies que usan ese helper. Confirmado EXPLOTADO ahora mismo
-- en minmax_change_requests: Cendy Quintanilla (Jefe/a de Compras y
-- Logistica, scope=BRANCH, can_approve=true, sucursal Bodega/erp_sucursal_id
-- 6) veía y podía decidir solicitudes de MinMax de CUALQUIER sucursal, no
-- solo la suya — verificado con RLS simulado antes de este fix. Las demás
-- tablas de abajo (approval_requests/attendance/employees/employee_branches/
-- payroll_entries) no tienen HOY ningún rol activo con scope=BRANCH en el
-- permiso relevante, pero el mecanismo estaba igual de roto — se corrige
-- para que no reaparezca el día que alguien configure ese rol.

-- minmax_change_requests: erp_sucursal_id no tiene columna directa de
-- branch_id — se resuelve vía erp_sucursal_map (branch_id → erp_sucursal_id).
DROP POLICY IF EXISTS mmcr_select ON public.minmax_change_requests;
CREATE POLICY mmcr_select ON public.minmax_change_requests
  FOR SELECT
  USING (
    (requested_by_id = (select auth.uid()))
    OR (
      auth_has_module_permission('minmax', 'can_approve')
      AND (
        auth_module_scope('minmax') = 'ALL'
        OR erp_sucursal_id = (SELECT esm.erp_sucursal_id FROM public.erp_sucursal_map esm WHERE esm.branch_id = auth_employee_branch_id())
      )
    )
  );

DROP POLICY IF EXISTS mmcr_update ON public.minmax_change_requests;
CREATE POLICY mmcr_update ON public.minmax_change_requests
  FOR UPDATE
  USING (
    auth_has_module_permission('minmax', 'can_approve')
    AND (
      auth_module_scope('minmax') = 'ALL'
      OR erp_sucursal_id = (SELECT esm.erp_sucursal_id FROM public.erp_sucursal_map esm WHERE esm.branch_id = auth_employee_branch_id())
    )
  );

-- approval_requests: sin branch_id propio — se resuelve vía employees del
-- solicitante (employee_id).
DROP POLICY IF EXISTS approval_requests_select ON public.approval_requests;
CREATE POLICY approval_requests_select ON public.approval_requests
  FOR SELECT
  USING (
    (employee_id = (select auth.uid()))
    OR (
      auth_has_module_permission('requests', 'can_approve')
      AND (
        auth_module_scope('requests') = 'ALL'
        OR EXISTS (SELECT 1 FROM public.employees e WHERE e.id = approval_requests.employee_id AND e.branch_id = auth_employee_branch_id())
      )
    )
  );

DROP POLICY IF EXISTS approval_requests_insert ON public.approval_requests;
CREATE POLICY approval_requests_insert ON public.approval_requests
  FOR INSERT
  WITH CHECK (
    (employee_id = (select auth.uid()))
    OR (
      auth_has_module_permission('requests', 'can_approve')
      AND (
        auth_module_scope('requests') = 'ALL'
        OR EXISTS (SELECT 1 FROM public.employees e WHERE e.id = approval_requests.employee_id AND e.branch_id = auth_employee_branch_id())
      )
    )
  );

DROP POLICY IF EXISTS approval_requests_update ON public.approval_requests;
CREATE POLICY approval_requests_update ON public.approval_requests
  FOR UPDATE
  USING (
    auth_has_module_permission('requests', 'can_approve')
    AND (
      auth_module_scope('requests') = 'ALL'
      OR EXISTS (SELECT 1 FROM public.employees e WHERE e.id = approval_requests.employee_id AND e.branch_id = auth_employee_branch_id())
    )
  )
  WITH CHECK (
    auth_has_module_permission('requests', 'can_approve')
    AND (
      auth_module_scope('requests') = 'ALL'
      OR EXISTS (SELECT 1 FROM public.employees e WHERE e.id = approval_requests.employee_id AND e.branch_id = auth_employee_branch_id())
    )
  );

-- attendance: mismo patrón, vía employees del marcaje.
DROP POLICY IF EXISTS attendance_update ON public.attendance;
CREATE POLICY attendance_update ON public.attendance
  FOR UPDATE
  USING (
    auth_has_module_permission('time_audit', 'can_edit')
    AND (
      auth_module_scope('time_audit') = 'ALL'
      OR EXISTS (SELECT 1 FROM public.employees e WHERE e.id = attendance.employee_id AND e.branch_id = auth_employee_branch_id())
    )
  );

DROP POLICY IF EXISTS attendance_delete ON public.attendance;
CREATE POLICY attendance_delete ON public.attendance
  FOR DELETE
  USING (
    auth_has_module_permission('time_audit', 'can_edit')
    AND (
      auth_module_scope('time_audit') = 'ALL'
      OR EXISTS (SELECT 1 FROM public.employees e WHERE e.id = attendance.employee_id AND e.branch_id = auth_employee_branch_id())
    )
  );

-- employees: columna branch_id directa.
DROP POLICY IF EXISTS employees_update ON public.employees;
CREATE POLICY employees_update ON public.employees
  FOR UPDATE
  USING (
    auth_has_module_permission('staff_list', 'can_edit')
    AND (auth_module_scope('staff_list') = 'ALL' OR employees.branch_id = auth_employee_branch_id())
  );

DROP POLICY IF EXISTS employees_delete ON public.employees;
CREATE POLICY employees_delete ON public.employees
  FOR DELETE
  USING (
    auth_has_module_permission('staff_list', 'can_edit')
    AND (auth_module_scope('staff_list') = 'ALL' OR employees.branch_id = auth_employee_branch_id())
  );

-- employee_branches (asignaciones multi-sucursal): vía employees del
-- empleado asignado (employee_id), no el branch_id de la fila — un editor
-- BRANCH solo debe gestionar asignaciones de SU PROPIA gente.
DROP POLICY IF EXISTS eb_insert ON public.employee_branches;
CREATE POLICY eb_insert ON public.employee_branches
  FOR INSERT
  WITH CHECK (
    auth_has_module_permission('staff_list', 'can_edit')
    AND (
      auth_module_scope('staff_list') = 'ALL'
      OR EXISTS (SELECT 1 FROM public.employees e WHERE e.id = employee_branches.employee_id AND e.branch_id = auth_employee_branch_id())
    )
  );

DROP POLICY IF EXISTS eb_update ON public.employee_branches;
CREATE POLICY eb_update ON public.employee_branches
  FOR UPDATE
  USING (
    auth_has_module_permission('staff_list', 'can_edit')
    AND (
      auth_module_scope('staff_list') = 'ALL'
      OR EXISTS (SELECT 1 FROM public.employees e WHERE e.id = employee_branches.employee_id AND e.branch_id = auth_employee_branch_id())
    )
  );

DROP POLICY IF EXISTS eb_delete ON public.employee_branches;
CREATE POLICY eb_delete ON public.employee_branches
  FOR DELETE
  USING (
    auth_has_module_permission('staff_list', 'can_edit')
    AND (
      auth_module_scope('staff_list') = 'ALL'
      OR EXISTS (SELECT 1 FROM public.employees e WHERE e.id = employee_branches.employee_id AND e.branch_id = auth_employee_branch_id())
    )
  );

-- payroll_entries: ya tenía un fallback branch-aware (own-branch employees),
-- pero el primer OR (auth_has_module_permission) bypaseaba scope igual.
DROP POLICY IF EXISTS payroll_entries_read ON public.payroll_entries;
CREATE POLICY payroll_entries_read ON public.payroll_entries
  FOR SELECT
  USING (
    (
      auth_has_module_permission('payroll', 'can_view')
      AND auth_module_scope('payroll') = 'ALL'
    )
    OR EXISTS (SELECT 1 FROM public.employees e WHERE e.id = payroll_entries.employee_id AND e.branch_id = auth_employee_branch_id())
  );
