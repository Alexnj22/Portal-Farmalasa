-- ============================================================
-- DB AUDIT CLEANUP v2 — Constraints, CHECK, Junction Table
-- ============================================================

-- 1. Drop the problematic unique constraint on customer name
ALTER TABLE customers DROP CONSTRAINT IF EXISTS customers_name_unique;

-- 2. Add NOT NULL on columns that are always required and have 0 nulls
ALTER TABLE products  ALTER COLUMN nombre SET NOT NULL;
ALTER TABLE products  ALTER COLUMN activo SET NOT NULL;
ALTER TABLE employees ALTER COLUMN first_names SET NOT NULL;
ALTER TABLE employees ALTER COLUMN last_names  SET NOT NULL;

-- 3. CHECK constraints on status enum fields
ALTER TABLE employees
  ADD CONSTRAINT chk_employees_status
  CHECK (status IN ('ACTIVO','INACTIVO','BAJA','LIQUIDADO'));

ALTER TABLE cotizaciones
  ADD CONSTRAINT chk_cotizaciones_status
  CHECK (status IN ('ACTIVA','ANULADA','CERRADA'));

ALTER TABLE approval_requests
  ADD CONSTRAINT chk_approval_requests_status
  CHECK (status IN ('PENDING','APPROVED','REJECTED','CANCELLED'));

ALTER TABLE employee_rosters
  ADD CONSTRAINT chk_employee_rosters_status
  CHECK (status IN ('DRAFT','PUBLISHED','APPROVED'));

-- 4. Give the test employee a real role so system_role fallback is no longer needed
UPDATE employees SET role_id = 30 WHERE code = 'EMP9934' AND role_id IS NULL;

-- 5. Create proper junction table to replace assigned_branch_ids JSONB
CREATE TABLE IF NOT EXISTS employee_branches (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    employee_id uuid   NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    branch_id   bigint NOT NULL REFERENCES branches(id)  ON DELETE CASCADE,
    created_at  timestamptz NOT NULL DEFAULT now(),
    UNIQUE (employee_id, branch_id)
);

CREATE INDEX IF NOT EXISTS idx_employee_branches_employee ON employee_branches(employee_id);
CREATE INDEX IF NOT EXISTS idx_employee_branches_branch   ON employee_branches(branch_id);

ALTER TABLE employee_branches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "eb_select" ON employee_branches FOR SELECT TO authenticated USING (true);

CREATE POLICY "eb_write" ON employee_branches FOR ALL TO authenticated
  USING     (auth_has_module_permission('staff_list', 'edit'))
  WITH CHECK (auth_has_module_permission('staff_list', 'edit'));
