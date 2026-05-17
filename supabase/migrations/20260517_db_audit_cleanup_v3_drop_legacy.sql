-- ============================================================
-- DB AUDIT CLEANUP v3 — Drop legacy columns
-- Runs after code has been updated to use new patterns.
-- ============================================================

-- 1. Drop assigned_branch_ids from employees
--    Replaced by employee_branches junction table.
--    employees_safe view never included this column.
ALTER TABLE employees DROP COLUMN IF EXISTS assigned_branch_ids;

-- 2. Clean up role_permissions.system_role
--    All real employees now have role_id. SUPERADMIN bypasses RLS entirely.
--    93 legacy rows with system_role only were dead weight.
DELETE FROM role_permissions WHERE system_role IS NOT NULL AND role_id IS NULL;

ALTER TABLE role_permissions DROP CONSTRAINT IF EXISTS role_permissions_system_role_module_key_key;
ALTER TABLE role_permissions DROP COLUMN IF EXISTS system_role;
