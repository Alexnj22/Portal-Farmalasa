-- ============================================================
-- DB AUDIT v9 — Eliminate remaining rls_references_user_metadata ERRORs
-- Root cause: announcements_audience and payroll_entries_read reference
-- auth.jwt() -> 'user_metadata' directly in policy text.
-- user_metadata is editable by end users → security risk.
-- Fix: read branchId/roleId from employees table via SECURITY DEFINER fn.
-- ============================================================

-- Helper: returns current user's branch_id from DB (bypasses RLS)
CREATE OR REPLACE FUNCTION public.auth_employee_branch_id()
  RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT branch_id FROM public.employees WHERE id = (select auth.uid());
$$;

-- Helper: returns current user's role_id from DB (bypasses RLS)
CREATE OR REPLACE FUNCTION public.auth_employee_role_id()
  RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT role_id FROM public.employees WHERE id = (select auth.uid());
$$;

-- Fix announcements_audience: read branchId/roleId from DB, not JWT metadata
DROP POLICY IF EXISTS "announcements_audience" ON announcements;
CREATE POLICY "announcements_audience" ON announcements
  FOR SELECT TO authenticated
  USING (
    (target_type = 'ALL')
    OR (target_type = 'BRANCH'
        AND target_value::text = auth_employee_branch_id()::text)
    OR (target_type = 'ROLE'
        AND target_value::text = auth_employee_role_id()::text)
    OR auth_has_module_permission('announcements', 'can_edit')
  );

-- Fix payroll_entries_read: read caller's branch_id from DB, not JWT metadata
DROP POLICY IF EXISTS "payroll_entries_read" ON payroll_entries;
CREATE POLICY "payroll_entries_read" ON payroll_entries
  FOR SELECT TO authenticated
  USING (
    auth_has_module_permission('payroll', 'can_view')
    OR EXISTS (
      SELECT 1 FROM public.employees e
      WHERE e.id = payroll_entries.employee_id
        AND e.branch_id = auth_employee_branch_id()
    )
  );
