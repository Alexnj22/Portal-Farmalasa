-- ============================================================
-- DB AUDIT CLEANUP v7 — Fix Supabase CRITICAL advisor alerts
-- 1. security_invoker = true on 4 SECURITY DEFINER views
-- 2. Wrap auth.jwt() / auth.uid() in (select ...) in RLS
-- 3. Replace stale isAdmin JWT field with proper permission checks
-- ============================================================

-- ── 1. Views: switch to security_invoker ──────────────────────
ALTER VIEW employees_safe      SET (security_invoker = true);
ALTER VIEW sales_invoice_gaps  SET (security_invoker = true);
ALTER VIEW branch_hourly_sales SET (security_invoker = true);
ALTER VIEW sales_invoice_nulls SET (security_invoker = true);

-- ── 2. announcements_audience ─────────────────────────────────
-- Old: bare auth.jwt() + references removed isAdmin JWT field
DROP POLICY IF EXISTS "announcements_audience" ON announcements;
CREATE POLICY "announcements_audience" ON announcements
  FOR SELECT TO authenticated
  USING (
    (target_type = 'ALL')
    OR (target_type = 'BRANCH'
        AND target_value::text = ((select auth.jwt()) -> 'user_metadata' ->> 'branchId'))
    OR (target_type = 'ROLE'
        AND target_value::text = ((select auth.jwt()) -> 'user_metadata' ->> 'roleId'))
    OR auth_has_module_permission('announcements', 'can_edit')
  );

-- ── 3. approval_requests: wrap auth.uid() ─────────────────────
DROP POLICY IF EXISTS "approval_requests_select" ON approval_requests;
CREATE POLICY "approval_requests_select" ON approval_requests
  FOR SELECT TO authenticated
  USING (
    employee_id = (select auth.uid())
    OR auth_has_module_permission('requests', 'can_approve')
  );

DROP POLICY IF EXISTS "employee_create_requests" ON approval_requests;
CREATE POLICY "employee_create_requests" ON approval_requests
  FOR INSERT TO authenticated
  WITH CHECK (employee_id = (select auth.uid()));

-- ── 4. payroll_entries: wrap auth.jwt() ───────────────────────
DROP POLICY IF EXISTS "payroll_entries_read" ON payroll_entries;
CREATE POLICY "payroll_entries_read" ON payroll_entries
  FOR SELECT TO authenticated
  USING (
    auth_has_module_permission('payroll', 'can_view')
    OR EXISTS (
      SELECT 1 FROM employees e
      WHERE e.id = payroll_entries.employee_id
        AND e.branch_id = (((select auth.jwt()) -> 'user_metadata' ->> 'branchId'))::integer
    )
  );

-- ── 5. sync_log: replace stale isAdmin with permission check ──
DROP POLICY IF EXISTS "sync_log_admin_read" ON sync_log;
CREATE POLICY "sync_log_admin_read" ON sync_log
  FOR SELECT TO authenticated
  USING (auth_has_module_permission('dte_sync', 'can_view'));
