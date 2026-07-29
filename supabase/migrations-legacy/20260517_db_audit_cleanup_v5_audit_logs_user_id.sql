-- ============================================================
-- DB AUDIT CLEANUP v5 — audit_logs.user_id TEXT → UUID FK
-- Verificado: 107 valores son UUIDs válidos, 0 orphans, 2 NULL
-- ============================================================

-- Cambiar tipo de TEXT a UUID
ALTER TABLE audit_logs
  ALTER COLUMN user_id TYPE uuid USING user_id::uuid;

-- FK con SET NULL: logs de procesos automáticos no tienen empleado
ALTER TABLE audit_logs
  ADD CONSTRAINT fk_audit_logs_user FOREIGN KEY (user_id)
  REFERENCES employees(id) ON DELETE SET NULL;
