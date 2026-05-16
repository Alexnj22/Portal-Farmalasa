-- =============================================================================
-- SECURITY FIXES — 2026-05-16
-- Apply in Supabase Dashboard → SQL Editor
-- =============================================================================

-- ─── 1. RLS: Anuncios filtrados por audiencia ─────────────────────────────────
-- Asegúrate que RLS está habilitado en la tabla announcements
ALTER TABLE announcements ENABLE ROW LEVEL SECURITY;

-- Eliminar política previa si existe
DROP POLICY IF EXISTS "announcements_audience" ON announcements;

-- Solo ver anuncios que aplican al rol/sucursal del usuario autenticado
CREATE POLICY "announcements_audience" ON announcements
  FOR SELECT USING (
    -- Anuncios globales
    target_type = 'ALL'
    -- Anuncios por sucursal (branch_id del JWT user_metadata)
    OR (
      target_type = 'BRANCH'
      AND target_value::text = (auth.jwt()->'user_metadata'->>'branchId')
    )
    -- Anuncios por rol (role_id del JWT user_metadata)
    OR (
      target_type = 'ROLE'
      AND target_value::text = (auth.jwt()->'user_metadata'->>'roleId')
    )
    -- Admins ven todos
    OR (auth.jwt()->'user_metadata'->>'isAdmin')::boolean = true
  );

-- Política de inserción: solo admins pueden crear anuncios
DROP POLICY IF EXISTS "announcements_insert_admin" ON announcements;
CREATE POLICY "announcements_insert_admin" ON announcements
  FOR INSERT WITH CHECK (
    (auth.jwt()->'user_metadata'->>'isAdmin')::boolean = true
  );

-- ─── 2. RLS: Validación de headcount en asignación de empleados ───────────────
-- Función server-side para validar límite de headcount antes de asignar rol
CREATE OR REPLACE FUNCTION validate_role_headcount(p_role_id INT, p_branch_id INT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_max_limit INT;
  v_current   INT;
BEGIN
  SELECT max_limit INTO v_max_limit FROM roles WHERE id = p_role_id;
  IF v_max_limit IS NULL OR v_max_limit <= 0 THEN
    RETURN TRUE; -- sin límite configurado
  END IF;

  SELECT COUNT(*) INTO v_current
  FROM employees
  WHERE role_id = p_role_id
    AND branch_id = p_branch_id
    AND status = 'ACTIVO';

  RETURN v_current < v_max_limit;
END;
$$;

-- ─── 3. RLS: role_permissions — usuarios solo leen sus propios permisos ────────
ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "role_permissions_own_role" ON role_permissions;
CREATE POLICY "role_permissions_own_role" ON role_permissions
  FOR SELECT USING (
    -- El usuario ve los permisos de su propio role_id
    role_id = (auth.jwt()->'user_metadata'->>'roleId')::int
    -- O si es admin, ve todos
    OR (auth.jwt()->'user_metadata'->>'isAdmin')::boolean = true
    -- O si coincide con su system_role
    OR system_role = (auth.jwt()->'user_metadata'->>'systemRole')
  );

-- Solo admins pueden modificar permisos
DROP POLICY IF EXISTS "role_permissions_admin_write" ON role_permissions;
CREATE POLICY "role_permissions_admin_write" ON role_permissions
  FOR ALL USING (
    (auth.jwt()->'user_metadata'->>'isAdmin')::boolean = true
  );

-- ─── 4. RLS: payroll_entries — filtrar por sucursal del usuario ───────────────
ALTER TABLE payroll_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "payroll_entries_own_branch" ON payroll_entries;
-- Admins ven todo; otros ven solo su sucursal a través del período
CREATE POLICY "payroll_entries_own_branch" ON payroll_entries
  FOR SELECT USING (
    (auth.jwt()->'user_metadata'->>'isAdmin')::boolean = true
    OR EXISTS (
      SELECT 1 FROM employees e
      WHERE e.id = payroll_entries.employee_id
        AND e.branch_id = (auth.jwt()->'user_metadata'->>'branchId')::int
    )
  );
