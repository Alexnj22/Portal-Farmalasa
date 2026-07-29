-- HOTFIX CRÍTICO: TODAS las policies escritas en esta sesión (desde
-- announcements_audience en adelante) llamaban a auth_has_module_permission(),
-- auth_module_scope(), auth_employee_branch_id(), auth_employee_erp_sucursal_id()
-- SIN envolver en (select ...) — el mismo problema de auth_rls_initplan que
-- YA se había corregido para auth.uid()/auth.role() en la migración
-- 20260706_fix_rls_initplan_and_dup_policies.sql, pero no se aplicó a estas
-- funciones nuevas. Sin el (select ...), Postgres re-evalúa la función POR
-- CADA FILA en vez de una sola vez por consulta.
--
-- Confirmado con EXPLAIN ANALYZE en producción: sales_invoices, 2001 filas,
-- pasó de 1561ms a 6.7ms al envolver las llamadas — 230x más rápido. Esto es
-- la causa real de "tarda demasiado en ventas" / MinMax vacío / timeouts en
-- consola reportados por el usuario.
--
-- Reescribe TODAS las policies de esta sesión con el wrapping correcto.
-- Ninguna condición cambia — mismo comportamiento, solo se fuerza a
-- evaluarse UNA vez (InitPlan) en vez de por fila.

-- ── announcements ────────────────────────────────────────────────────────
DROP POLICY IF EXISTS announcements_audience ON public.announcements;
CREATE POLICY announcements_audience ON public.announcements
  FOR SELECT
  USING (
    target_type = 'GLOBAL'
    OR (target_type = 'BRANCH' AND (target_value #>> '{}') = (select auth_employee_branch_id())::text)
    OR (target_type = 'ROLE' AND (target_value #>> '{}') = (SELECT r.name FROM public.roles r WHERE r.id = (select auth_employee_role_id())))
    OR (target_type = 'EMPLOYEE' AND target_value @> to_jsonb((select auth_employee_id())::text))
    OR ((select auth_has_module_permission('announcements', 'can_edit')) AND (select auth_module_scope('announcements')) = 'ALL')
  );

DROP POLICY IF EXISTS announcements_insert ON public.announcements;
CREATE POLICY announcements_insert ON public.announcements
  FOR INSERT
  WITH CHECK (
    (select auth_has_module_permission('announcements', 'can_edit'))
    AND (
      (select auth_module_scope('announcements')) = 'ALL'
      OR (target_type = 'BRANCH' AND (target_value #>> '{}') = (select auth_employee_branch_id())::text)
    )
  );

DROP POLICY IF EXISTS announcements_update ON public.announcements;
CREATE POLICY announcements_update ON public.announcements
  FOR UPDATE
  USING (
    (select auth_has_module_permission('announcements', 'can_edit'))
    AND (
      (select auth_module_scope('announcements')) = 'ALL'
      OR (target_type = 'BRANCH' AND (target_value #>> '{}') = (select auth_employee_branch_id())::text)
    )
  );

DROP POLICY IF EXISTS announcements_delete ON public.announcements;
CREATE POLICY announcements_delete ON public.announcements
  FOR DELETE
  USING (
    (select auth_has_module_permission('announcements', 'can_edit'))
    AND (
      (select auth_module_scope('announcements')) = 'ALL'
      OR (target_type = 'BRANCH' AND (target_value #>> '{}') = (select auth_employee_branch_id())::text)
    )
  );

-- ── minmax_change_requests ───────────────────────────────────────────────
DROP POLICY IF EXISTS mmcr_select ON public.minmax_change_requests;
CREATE POLICY mmcr_select ON public.minmax_change_requests
  FOR SELECT
  USING (
    (requested_by_id = (select auth.uid()))
    OR (
      (select auth_has_module_permission('minmax', 'can_approve'))
      AND (
        (select auth_module_scope('minmax')) = 'ALL'
        OR erp_sucursal_id = (select auth_employee_erp_sucursal_id())
      )
    )
  );

DROP POLICY IF EXISTS mmcr_update ON public.minmax_change_requests;
CREATE POLICY mmcr_update ON public.minmax_change_requests
  FOR UPDATE
  USING (
    (select auth_has_module_permission('minmax', 'can_approve'))
    AND (
      (select auth_module_scope('minmax')) = 'ALL'
      OR erp_sucursal_id = (select auth_employee_erp_sucursal_id())
    )
  );

-- ── approval_requests ────────────────────────────────────────────────────
DROP POLICY IF EXISTS approval_requests_select ON public.approval_requests;
CREATE POLICY approval_requests_select ON public.approval_requests
  FOR SELECT
  USING (
    (employee_id = (select auth.uid()))
    OR (
      (select auth_has_module_permission('requests', 'can_approve'))
      AND (
        (select auth_module_scope('requests')) = 'ALL'
        OR EXISTS (SELECT 1 FROM public.employees e WHERE e.id = approval_requests.employee_id AND e.branch_id = (select auth_employee_branch_id()))
      )
    )
  );

DROP POLICY IF EXISTS approval_requests_insert ON public.approval_requests;
CREATE POLICY approval_requests_insert ON public.approval_requests
  FOR INSERT
  WITH CHECK (
    (employee_id = (select auth.uid()))
    OR (
      (select auth_has_module_permission('requests', 'can_approve'))
      AND (
        (select auth_module_scope('requests')) = 'ALL'
        OR EXISTS (SELECT 1 FROM public.employees e WHERE e.id = approval_requests.employee_id AND e.branch_id = (select auth_employee_branch_id()))
      )
    )
  );

DROP POLICY IF EXISTS approval_requests_update ON public.approval_requests;
CREATE POLICY approval_requests_update ON public.approval_requests
  FOR UPDATE
  USING (
    (select auth_has_module_permission('requests', 'can_approve'))
    AND (
      (select auth_module_scope('requests')) = 'ALL'
      OR EXISTS (SELECT 1 FROM public.employees e WHERE e.id = approval_requests.employee_id AND e.branch_id = (select auth_employee_branch_id()))
    )
  )
  WITH CHECK (
    (select auth_has_module_permission('requests', 'can_approve'))
    AND (
      (select auth_module_scope('requests')) = 'ALL'
      OR EXISTS (SELECT 1 FROM public.employees e WHERE e.id = approval_requests.employee_id AND e.branch_id = (select auth_employee_branch_id()))
    )
  );

-- ── attendance ───────────────────────────────────────────────────────────
DROP POLICY IF EXISTS attendance_select ON public.attendance;
CREATE POLICY attendance_select ON public.attendance
  FOR SELECT
  USING (
    employee_id = (select auth_employee_id())
    OR (
      (select auth_has_module_permission('monitor', 'can_view'))
      AND (
        (select auth_module_scope('monitor')) = 'ALL'
        OR EXISTS (SELECT 1 FROM public.employees e WHERE e.id = attendance.employee_id AND e.branch_id = (select auth_employee_branch_id()))
      )
    )
  );

DROP POLICY IF EXISTS attendance_update ON public.attendance;
CREATE POLICY attendance_update ON public.attendance
  FOR UPDATE
  USING (
    (select auth_has_module_permission('time_audit', 'can_edit'))
    AND (
      (select auth_module_scope('time_audit')) = 'ALL'
      OR EXISTS (SELECT 1 FROM public.employees e WHERE e.id = attendance.employee_id AND e.branch_id = (select auth_employee_branch_id()))
    )
  );

DROP POLICY IF EXISTS attendance_delete ON public.attendance;
CREATE POLICY attendance_delete ON public.attendance
  FOR DELETE
  USING (
    (select auth_has_module_permission('time_audit', 'can_edit'))
    AND (
      (select auth_module_scope('time_audit')) = 'ALL'
      OR EXISTS (SELECT 1 FROM public.employees e WHERE e.id = attendance.employee_id AND e.branch_id = (select auth_employee_branch_id()))
    )
  );

-- ── employees / employee_branches ───────────────────────────────────────
DROP POLICY IF EXISTS employees_update ON public.employees;
CREATE POLICY employees_update ON public.employees
  FOR UPDATE
  USING (
    (select auth_has_module_permission('staff_list', 'can_edit'))
    AND ((select auth_module_scope('staff_list')) = 'ALL' OR employees.branch_id = (select auth_employee_branch_id()))
  );

DROP POLICY IF EXISTS employees_delete ON public.employees;
CREATE POLICY employees_delete ON public.employees
  FOR DELETE
  USING (
    (select auth_has_module_permission('staff_list', 'can_edit'))
    AND ((select auth_module_scope('staff_list')) = 'ALL' OR employees.branch_id = (select auth_employee_branch_id()))
  );

DROP POLICY IF EXISTS eb_insert ON public.employee_branches;
CREATE POLICY eb_insert ON public.employee_branches
  FOR INSERT
  WITH CHECK (
    (select auth_has_module_permission('staff_list', 'can_edit'))
    AND (
      (select auth_module_scope('staff_list')) = 'ALL'
      OR EXISTS (SELECT 1 FROM public.employees e WHERE e.id = employee_branches.employee_id AND e.branch_id = (select auth_employee_branch_id()))
    )
  );

DROP POLICY IF EXISTS eb_update ON public.employee_branches;
CREATE POLICY eb_update ON public.employee_branches
  FOR UPDATE
  USING (
    (select auth_has_module_permission('staff_list', 'can_edit'))
    AND (
      (select auth_module_scope('staff_list')) = 'ALL'
      OR EXISTS (SELECT 1 FROM public.employees e WHERE e.id = employee_branches.employee_id AND e.branch_id = (select auth_employee_branch_id()))
    )
  );

DROP POLICY IF EXISTS eb_delete ON public.employee_branches;
CREATE POLICY eb_delete ON public.employee_branches
  FOR DELETE
  USING (
    (select auth_has_module_permission('staff_list', 'can_edit'))
    AND (
      (select auth_module_scope('staff_list')) = 'ALL'
      OR EXISTS (SELECT 1 FROM public.employees e WHERE e.id = employee_branches.employee_id AND e.branch_id = (select auth_employee_branch_id()))
    )
  );

-- ── payroll_entries ──────────────────────────────────────────────────────
DROP POLICY IF EXISTS payroll_entries_read ON public.payroll_entries;
CREATE POLICY payroll_entries_read ON public.payroll_entries
  FOR SELECT
  USING (
    (
      (select auth_has_module_permission('payroll', 'can_view'))
      AND (select auth_module_scope('payroll')) = 'ALL'
    )
    OR EXISTS (SELECT 1 FROM public.employees e WHERE e.id = payroll_entries.employee_id AND e.branch_id = (select auth_employee_branch_id()))
  );

-- ── sales_invoices ───────────────────────────────────────────────────────
DROP POLICY IF EXISTS sales_invoices_select ON public.sales_invoices;
CREATE POLICY sales_invoices_select ON public.sales_invoices
  FOR SELECT
  USING (
    (select auth_has_module_permission('ventas', 'can_view'))
    AND ((select auth_module_scope('ventas')) = 'ALL' OR branch_id = (select auth_employee_branch_id()))
  );

-- ── cotizaciones ─────────────────────────────────────────────────────────
DROP POLICY IF EXISTS cotizaciones_select ON public.cotizaciones;
CREATE POLICY cotizaciones_select ON public.cotizaciones
  FOR SELECT
  USING (
    (select auth_has_module_permission('cotizaciones', 'can_view'))
    AND ((select auth_module_scope('cotizaciones')) = 'ALL' OR branch_id = (select auth_employee_branch_id()))
  );

DROP POLICY IF EXISTS cotizaciones_insert ON public.cotizaciones;
CREATE POLICY cotizaciones_insert ON public.cotizaciones
  FOR INSERT
  WITH CHECK (
    (select auth_has_module_permission('cotizaciones', 'can_edit'))
    AND ((select auth_module_scope('cotizaciones')) = 'ALL' OR branch_id = (select auth_employee_branch_id()))
  );

DROP POLICY IF EXISTS cotizaciones_update ON public.cotizaciones;
CREATE POLICY cotizaciones_update ON public.cotizaciones
  FOR UPDATE
  USING (
    (select auth_has_module_permission('cotizaciones', 'can_edit'))
    AND ((select auth_module_scope('cotizaciones')) = 'ALL' OR branch_id = (select auth_employee_branch_id()))
  );

DROP POLICY IF EXISTS cotizaciones_delete ON public.cotizaciones;
CREATE POLICY cotizaciones_delete ON public.cotizaciones
  FOR DELETE
  USING (
    (select auth_has_module_permission('cotizaciones', 'can_edit'))
    AND ((select auth_module_scope('cotizaciones')) = 'ALL' OR branch_id = (select auth_employee_branch_id()))
  );

-- ── vacation_plans ───────────────────────────────────────────────────────
DROP POLICY IF EXISTS vacation_plans_select ON public.vacation_plans;
CREATE POLICY vacation_plans_select ON public.vacation_plans
  FOR SELECT
  USING (
    employee_id = (select auth_employee_id())
    OR (select auth_has_module_permission('payroll', 'can_view'))
    OR (
      (select auth_has_module_permission('vacation_plan', 'can_view'))
      AND ((select auth_module_scope('vacation_plan')) = 'ALL' OR branch_id = (select auth_employee_branch_id()))
    )
  );

DROP POLICY IF EXISTS vacation_plans_insert ON public.vacation_plans;
CREATE POLICY vacation_plans_insert ON public.vacation_plans
  FOR INSERT
  WITH CHECK (
    (select auth_has_module_permission('vacation_plan', 'can_edit'))
    AND ((select auth_module_scope('vacation_plan')) = 'ALL' OR branch_id = (select auth_employee_branch_id()))
  );

DROP POLICY IF EXISTS vacation_plans_update ON public.vacation_plans;
CREATE POLICY vacation_plans_update ON public.vacation_plans
  FOR UPDATE
  USING (
    employee_id = (select auth_employee_id())
    OR (
      (select auth_has_module_permission('vacation_plan', 'can_edit'))
      AND ((select auth_module_scope('vacation_plan')) = 'ALL' OR branch_id = (select auth_employee_branch_id()))
    )
  );

-- ── employee_rosters ─────────────────────────────────────────────────────
DROP POLICY IF EXISTS employee_rosters_select ON public.employee_rosters;
CREATE POLICY employee_rosters_select ON public.employee_rosters
  FOR SELECT
  USING (
    employee_id = (select auth_employee_id())
    OR EXISTS (SELECT 1 FROM public.employees e WHERE e.id = employee_rosters.employee_id AND e.branch_id = (select auth_employee_branch_id()))
    OR ((select auth_has_module_permission('schedules', 'can_view')) AND (select auth_module_scope('schedules')) = 'ALL')
  );

DROP POLICY IF EXISTS employee_rosters_insert ON public.employee_rosters;
CREATE POLICY employee_rosters_insert ON public.employee_rosters
  FOR INSERT
  WITH CHECK (
    (select auth_has_module_permission('schedules', 'can_edit'))
    AND (
      (select auth_module_scope('schedules')) = 'ALL'
      OR EXISTS (SELECT 1 FROM public.employees e WHERE e.id = employee_rosters.employee_id AND e.branch_id = (select auth_employee_branch_id()))
    )
  );

DROP POLICY IF EXISTS employee_rosters_update ON public.employee_rosters;
CREATE POLICY employee_rosters_update ON public.employee_rosters
  FOR UPDATE
  USING (
    (select auth_has_module_permission('schedules', 'can_edit'))
    AND (
      (select auth_module_scope('schedules')) = 'ALL'
      OR EXISTS (SELECT 1 FROM public.employees e WHERE e.id = employee_rosters.employee_id AND e.branch_id = (select auth_employee_branch_id()))
    )
  );

-- ── pedidos family ───────────────────────────────────────────────────────
DROP POLICY IF EXISTS pedidos_select ON public.pedidos;
CREATE POLICY pedidos_select ON public.pedidos
  FOR SELECT
  USING (
    (select auth_has_module_permission('pedidos', 'can_view'))
    AND ((select auth_module_scope('pedidos')) = 'ALL' OR (select auth_employee_erp_sucursal_id()) = ANY (sucursal_ids))
  );

DROP POLICY IF EXISTS snapshots_select ON public.pedidos_snapshots;
CREATE POLICY snapshots_select ON public.pedidos_snapshots
  FOR SELECT
  USING (
    created_by = (select auth.uid())
    OR (
      (select auth_has_module_permission('pedidos', 'can_view'))
      AND ((select auth_module_scope('pedidos')) = 'ALL' OR (select auth_employee_erp_sucursal_id()) = ANY (sucursal_ids))
    )
  );

DROP POLICY IF EXISTS pss_select ON public.pedido_sucursal_status;
CREATE POLICY pss_select ON public.pedido_sucursal_status
  FOR SELECT
  USING (
    (select auth_has_module_permission('pedidos', 'can_view'))
    AND ((select auth_module_scope('pedidos')) = 'ALL' OR erp_sucursal_id = (select auth_employee_erp_sucursal_id()))
  );
DROP POLICY IF EXISTS pss_insert ON public.pedido_sucursal_status;
CREATE POLICY pss_insert ON public.pedido_sucursal_status
  FOR INSERT
  WITH CHECK (
    (select auth_has_module_permission('pedidos', 'can_edit'))
    AND ((select auth_module_scope('pedidos')) = 'ALL' OR erp_sucursal_id = (select auth_employee_erp_sucursal_id()))
  );
DROP POLICY IF EXISTS pss_update ON public.pedido_sucursal_status;
CREATE POLICY pss_update ON public.pedido_sucursal_status
  FOR UPDATE
  USING (
    (select auth_has_module_permission('pedidos', 'can_edit'))
    AND ((select auth_module_scope('pedidos')) = 'ALL' OR erp_sucursal_id = (select auth_employee_erp_sucursal_id()))
  );

DROP POLICY IF EXISTS pedido_items_select ON public.pedido_items;
CREATE POLICY pedido_items_select ON public.pedido_items
  FOR SELECT
  USING (
    (select auth_has_module_permission('pedidos', 'can_view'))
    AND ((select auth_module_scope('pedidos')) = 'ALL' OR erp_sucursal_id = (select auth_employee_erp_sucursal_id()))
  );

DROP POLICY IF EXISTS pie_select ON public.pedido_item_eventos;
CREATE POLICY pie_select ON public.pedido_item_eventos
  FOR SELECT
  USING (
    (select auth_has_module_permission('pedidos', 'can_view'))
    AND ((select auth_module_scope('pedidos')) = 'ALL' OR erp_sucursal_id = (select auth_employee_erp_sucursal_id()))
  );

DROP POLICY IF EXISTS pph_select ON public.pedido_pausa_historial;
CREATE POLICY pph_select ON public.pedido_pausa_historial
  FOR SELECT
  USING (
    (select auth_has_module_permission('pedidos', 'can_view'))
    AND ((select auth_module_scope('pedidos')) = 'ALL' OR erp_sucursal_id = (select auth_employee_erp_sucursal_id()))
  );
DROP POLICY IF EXISTS pph_insert ON public.pedido_pausa_historial;
CREATE POLICY pph_insert ON public.pedido_pausa_historial
  FOR INSERT
  WITH CHECK (
    (select auth_has_module_permission('pedidos', 'can_edit'))
    AND ((select auth_module_scope('pedidos')) = 'ALL' OR erp_sucursal_id = (select auth_employee_erp_sucursal_id()))
  );
DROP POLICY IF EXISTS pph_update ON public.pedido_pausa_historial;
CREATE POLICY pph_update ON public.pedido_pausa_historial
  FOR UPDATE
  USING (
    (select auth_has_module_permission('pedidos', 'can_edit'))
    AND ((select auth_module_scope('pedidos')) = 'ALL' OR erp_sucursal_id = (select auth_employee_erp_sucursal_id()))
  );

DROP POLICY IF EXISTS pre_select ON public.pedido_recepcion_extras;
CREATE POLICY pre_select ON public.pedido_recepcion_extras
  FOR SELECT
  USING (
    (select auth_has_module_permission('pedidos', 'can_view'))
    AND ((select auth_module_scope('pedidos')) = 'ALL' OR erp_sucursal_id = (select auth_employee_erp_sucursal_id()))
  );
DROP POLICY IF EXISTS pre_insert ON public.pedido_recepcion_extras;
CREATE POLICY pre_insert ON public.pedido_recepcion_extras
  FOR INSERT
  WITH CHECK (
    (select auth_has_module_permission('pedidos', 'can_edit'))
    AND ((select auth_module_scope('pedidos')) = 'ALL' OR erp_sucursal_id = (select auth_employee_erp_sucursal_id()))
  );

DROP POLICY IF EXISTS prf_select ON public.pedido_recepcion_firmas;
CREATE POLICY prf_select ON public.pedido_recepcion_firmas
  FOR SELECT
  USING (
    (select auth_has_module_permission('pedidos', 'can_view'))
    AND ((select auth_module_scope('pedidos')) = 'ALL' OR erp_sucursal_id = (select auth_employee_erp_sucursal_id()))
  );
DROP POLICY IF EXISTS prf_insert ON public.pedido_recepcion_firmas;
CREATE POLICY prf_insert ON public.pedido_recepcion_firmas
  FOR INSERT
  WITH CHECK (
    (select auth_has_module_permission('pedidos', 'can_edit'))
    AND ((select auth_module_scope('pedidos')) = 'ALL' OR erp_sucursal_id = (select auth_employee_erp_sucursal_id()))
  );

DROP POLICY IF EXISTS pedido_apoyo_select ON public.pedido_apoyo;
CREATE POLICY pedido_apoyo_select ON public.pedido_apoyo
  FOR SELECT
  USING (
    (select auth_has_module_permission('pedidos', 'can_view'))
    AND ((select auth_module_scope('pedidos')) = 'ALL' OR erp_sucursal_id = (select auth_employee_erp_sucursal_id()))
  );
DROP POLICY IF EXISTS pedido_apoyo_insert ON public.pedido_apoyo;
CREATE POLICY pedido_apoyo_insert ON public.pedido_apoyo
  FOR INSERT
  WITH CHECK (
    (select auth_has_module_permission('pedidos', 'can_edit'))
    AND ((select auth_module_scope('pedidos')) = 'ALL' OR erp_sucursal_id = (select auth_employee_erp_sucursal_id()))
  );
DROP POLICY IF EXISTS pedido_apoyo_update ON public.pedido_apoyo;
CREATE POLICY pedido_apoyo_update ON public.pedido_apoyo
  FOR UPDATE
  USING (
    (select auth_has_module_permission('pedidos', 'can_edit'))
    AND ((select auth_module_scope('pedidos')) = 'ALL' OR erp_sucursal_id = (select auth_employee_erp_sucursal_id()))
  );

-- ── purchase_receipts / items / sync_log ────────────────────────────────
DROP POLICY IF EXISTS purchase_receipts_select ON public.purchase_receipts;
CREATE POLICY purchase_receipts_select ON public.purchase_receipts
  FOR SELECT
  USING (
    (select auth_has_module_permission('compras', 'can_view'))
    AND ((select auth_module_scope('compras')) = 'ALL' OR branch_id = (select auth_employee_branch_id()))
  );

DROP POLICY IF EXISTS purchase_receipt_items_select ON public.purchase_receipt_items;
CREATE POLICY purchase_receipt_items_select ON public.purchase_receipt_items
  FOR SELECT
  USING (
    (select auth_has_module_permission('compras', 'can_view'))
    AND (
      (select auth_module_scope('compras')) = 'ALL'
      OR EXISTS (SELECT 1 FROM public.purchase_receipts pr WHERE pr.id = purchase_receipt_items.receipt_id AND pr.branch_id = (select auth_employee_branch_id()))
    )
  );

DROP POLICY IF EXISTS purchase_sync_log_select ON public.purchase_sync_log;
CREATE POLICY purchase_sync_log_select ON public.purchase_sync_log
  FOR SELECT
  USING (
    (select auth_has_module_permission('compras', 'can_view'))
    AND ((select auth_module_scope('compras')) = 'ALL' OR branch_id = (select auth_employee_branch_id()))
  );

-- ── rutas / ruta_pedidos / ruta_locations ───────────────────────────────
DROP POLICY IF EXISTS rutas_select ON public.rutas;
CREATE POLICY rutas_select ON public.rutas
  FOR SELECT
  USING (
    (select auth_has_module_permission('pedidos_tab_rutas', 'can_view'))
    AND (
      (select auth_module_scope('pedidos_tab_rutas')) = 'ALL'
      OR EXISTS (SELECT 1 FROM public.ruta_pedidos rp WHERE rp.ruta_id = rutas.id AND rp.erp_sucursal_id = (select auth_employee_erp_sucursal_id()))
    )
  );
DROP POLICY IF EXISTS rutas_update ON public.rutas;
CREATE POLICY rutas_update ON public.rutas
  FOR UPDATE
  USING ((select auth_has_module_permission('pedidos_tab_rutas', 'can_edit')));

DROP POLICY IF EXISTS ruta_pedidos_select ON public.ruta_pedidos;
CREATE POLICY ruta_pedidos_select ON public.ruta_pedidos
  FOR SELECT
  USING (
    (select auth_has_module_permission('pedidos_tab_rutas', 'can_view'))
    AND ((select auth_module_scope('pedidos_tab_rutas')) = 'ALL' OR erp_sucursal_id = (select auth_employee_erp_sucursal_id()))
  );
DROP POLICY IF EXISTS ruta_pedidos_update ON public.ruta_pedidos;
CREATE POLICY ruta_pedidos_update ON public.ruta_pedidos
  FOR UPDATE
  USING ((select auth_has_module_permission('pedidos_tab_rutas', 'can_edit')));

DROP POLICY IF EXISTS ruta_locations_select ON public.ruta_locations;
CREATE POLICY ruta_locations_select ON public.ruta_locations
  FOR SELECT
  USING (
    (select auth_has_module_permission('pedidos_tab_rutas', 'can_view'))
    AND (
      (select auth_module_scope('pedidos_tab_rutas')) = 'ALL'
      OR EXISTS (SELECT 1 FROM public.ruta_pedidos rp WHERE rp.ruta_id = ruta_locations.ruta_id AND rp.erp_sucursal_id = (select auth_employee_erp_sucursal_id()))
    )
  );
DROP POLICY IF EXISTS ruta_locations_write ON public.ruta_locations;
CREATE POLICY ruta_locations_write ON public.ruta_locations
  FOR ALL
  USING ((select auth_has_module_permission('pedidos_tab_rutas', 'can_edit')));
