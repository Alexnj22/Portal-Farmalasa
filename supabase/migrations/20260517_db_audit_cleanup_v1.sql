-- ============================================================
-- DB AUDIT CLEANUP v1  (2026-05-17)
-- 1. Drop duplicate/redundant indexes and constraints
-- 2. Add missing foreign keys
-- 3. Fix branch_id type mismatches (integer → bigint)
-- 4. Add missing useful indexes
-- ============================================================

-- ============================================================
-- PART 1: DROP DUPLICATE / REDUNDANT INDEXES & CONSTRAINTS
-- ============================================================

-- employee_rosters: two identical UNIQUE constraints + one non-unique index on same columns.
-- Keep: employee_rosters_unique_week. Drop the duplicate constraint + the redundant plain index.
ALTER TABLE employee_rosters DROP CONSTRAINT IF EXISTS employee_rosters_week_unique;
DROP INDEX IF EXISTS idx_rosters_emp_week;

-- attendance: two identical non-unique indexes on (employee_id, timestamp)
-- Keep: idx_attendance_employee_timestamp
DROP INDEX IF EXISTS idx_attendance_emp_time;

-- approval_requests: each column has two identical non-unique indexes
-- Keep: idx_approval_requests_employee, idx_approval_requests_status
DROP INDEX IF EXISTS approval_requests_employee_id_idx;
DROP INDEX IF EXISTS approval_requests_status_idx;

-- employees: unique constraints already enforce lookups; plain duplicates waste space
-- Keep: employees_code_unique, employees_username_key
DROP INDEX IF EXISTS idx_employees_code;
DROP INDEX IF EXISTS idx_employees_username;

-- timesheets: plain index duplicates the unique constraint on same columns
-- Keep: timesheets_emp_date_unique (UNIQUE constraint)
DROP INDEX IF EXISTS idx_timesheets_emp_date;

-- ============================================================
-- PART 2: ADD MISSING FOREIGN KEYS
-- (all verified with 0 orphan rows before applying)
-- ============================================================

-- product_precios_changelog → products + presentaciones
ALTER TABLE product_precios_changelog
  ADD CONSTRAINT fk_ppc_product      FOREIGN KEY (product_id)      REFERENCES products(id)        ON DELETE CASCADE,
  ADD CONSTRAINT fk_ppc_presentacion FOREIGN KEY (id_presentacion) REFERENCES presentaciones(id)  ON DELETE CASCADE;

-- product_precios_history → products + presentaciones
ALTER TABLE product_precios_history
  ADD CONSTRAINT fk_pph_product      FOREIGN KEY (product_id)      REFERENCES products(id)        ON DELETE CASCADE,
  ADD CONSTRAINT fk_pph_presentacion FOREIGN KEY (id_presentacion) REFERENCES presentaciones(id)  ON DELETE CASCADE;

-- products_changelog → products
ALTER TABLE products_changelog
  ADD CONSTRAINT fk_pc_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE;

-- sales_gap_resolutions → branches
ALTER TABLE sales_gap_resolutions
  ADD CONSTRAINT fk_sgr_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE;

-- sync_log → branches (RESTRICT so sync history is never silently orphaned)
ALTER TABLE sync_log
  ADD CONSTRAINT fk_synclog_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE RESTRICT;

-- cotizacion_items → products + presentaciones (nullable — SET NULL on delete)
ALTER TABLE cotizacion_items
  ADD CONSTRAINT fk_ci_product      FOREIGN KEY (product_id)      REFERENCES products(id)       ON DELETE SET NULL,
  ADD CONSTRAINT fk_ci_presentacion FOREIGN KEY (presentacion_id) REFERENCES presentaciones(id) ON DELETE SET NULL;

-- cotizaciones → employees via created_by
ALTER TABLE cotizaciones
  ADD CONSTRAINT fk_cot_created_by FOREIGN KEY (created_by) REFERENCES employees(id) ON DELETE SET NULL;

-- sales_invoice_items → presentaciones (nullable ERP field)
ALTER TABLE sales_invoice_items
  ADD CONSTRAINT fk_sii_presentacion FOREIGN KEY (id_presentacion) REFERENCES presentaciones(id) ON DELETE SET NULL;

-- sales_invoice_changelog → branches
ALTER TABLE sales_invoice_changelog
  ADD CONSTRAINT fk_sic_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE;

-- ============================================================
-- PART 3: FIX TYPE MISMATCHES — align branch_id to bigint
-- ============================================================

-- cotizaciones.branch_id (integer → bigint)
ALTER TABLE cotizaciones DROP CONSTRAINT IF EXISTS cotizaciones_branch_id_fkey;
ALTER TABLE cotizaciones ALTER COLUMN branch_id TYPE bigint;
ALTER TABLE cotizaciones
  ADD CONSTRAINT cotizaciones_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL;

-- sync_log.branch_id (integer → bigint; drop + recreate the FK we just added)
ALTER TABLE sync_log DROP CONSTRAINT IF EXISTS fk_synclog_branch;
ALTER TABLE sync_log ALTER COLUMN branch_id TYPE bigint;
ALTER TABLE sync_log
  ADD CONSTRAINT fk_synclog_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE RESTRICT;

-- ventas_monthly_stats.branch_id (integer → bigint; no FK — -1 sentinel rows intentionally exist)
ALTER TABLE ventas_monthly_stats ALTER COLUMN branch_id TYPE bigint;

-- ============================================================
-- PART 4: ADD MISSING USEFUL INDEXES
-- ============================================================

-- cotizaciones: branch scope filtering, status filter, date sorting, creator lookup
CREATE INDEX IF NOT EXISTS idx_cotizaciones_branch     ON cotizaciones(branch_id);
CREATE INDEX IF NOT EXISTS idx_cotizaciones_status     ON cotizaciones(status);
CREATE INDEX IF NOT EXISTS idx_cotizaciones_fecha      ON cotizaciones(fecha DESC);
CREATE INDEX IF NOT EXISTS idx_cotizaciones_created_by ON cotizaciones(created_by);

-- cotizacion_items: product lookup per quote
CREATE INDEX IF NOT EXISTS idx_cotizacion_items_product ON cotizacion_items(product_id) WHERE product_id IS NOT NULL;

-- customers: erp_id used in sync upserts
CREATE INDEX IF NOT EXISTS idx_customers_erp_id ON customers(erp_id) WHERE erp_id IS NOT NULL;

-- sales_gap_resolutions: gap detection always filters by branch + doc type
CREATE INDEX IF NOT EXISTS idx_sgr_branch_tipo ON sales_gap_resolutions(branch_id, tipo_documento);
