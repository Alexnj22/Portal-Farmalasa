-- La cobertura respeta la sala, y el catálogo deja de ser público
--
-- ── 1 · El alcance que faltaba ───────────────────────────────────────────────
-- `employee_rosters` y `schedule_coverage` guardan la misma clase de dato —a
-- quién se espera, dónde y cuándo— y sólo una respetaba el alcance por sala:
--
--   | tabla               | SELECT                        | UPDATE / DELETE            |
--   |---------------------|-------------------------------|----------------------------|
--   | `employee_rosters`  | propio · su sala · alcance ALL | edición **+ misma sala**   |
--   | `schedule_coverage` | **`USING (true)`**            | edición, **sin sala**      |
--
-- O sea que un jefe con alcance de una sola sala podía leer y BORRAR la
-- cobertura de cualquier otra. Y una cobertura dice dónde se espera a una
-- persona: de eso dependen la marcación del reloj y el reclamo de después —lo
-- dice el propio código al anotar la acción en la bitácora.
--
-- La regla nueva es la que la pantalla ya usaba de hecho: se ve y se escribe la
-- cobertura donde MI sala es una de las dos puntas —la que recibe o la que
-- presta—, porque hay que saber tanto quién viene como quién se va. La sala de
-- origen sale de `employees.branch_id` y no de `home_branch_id`, que es
-- opcional y puede venir vacío.
--
-- ── 2 · Lo que se podía leer sin iniciar sesión ──────────────────────────────
-- `shifts` y `holidays` tenían `read_all` con `USING (true)` para `anon`.
-- Estaba declarado en `auditoria/superficie-anon.json` como «revisar», con la
-- nota «no hay motivo escrito». Hoy se puede cerrar con una razón medida: el
-- kiosco los recibe dentro de `get_kiosk_boot_payload`, que es SECURITY DEFINER
-- y los arma adentro. Verificado que ninguna otra lectura corre antes del
-- login. La policy no hacía falta para nada.

SET lock_timeout = '5s';

-- ── Cobertura ────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS schedule_coverage_select ON public.schedule_coverage;
CREATE POLICY schedule_coverage_select ON public.schedule_coverage
  FOR SELECT TO authenticated
  USING (
    (SELECT auth_module_scope('schedules')) = 'ALL'
    OR coverage_branch_id = (SELECT auth_employee_branch_id())
    OR EXISTS (
      SELECT 1 FROM public.employees e
      WHERE e.id = schedule_coverage.employee_id
        AND e.branch_id = (SELECT auth_employee_branch_id())
    )
  );

DROP POLICY IF EXISTS schedule_coverage_write ON public.schedule_coverage;
CREATE POLICY schedule_coverage_write ON public.schedule_coverage
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT auth_can_edit_any(ARRAY['schedules', 'schedules_tab_calendar']))
    AND (
      (SELECT auth_module_scope('schedules')) = 'ALL'
      OR coverage_branch_id = (SELECT auth_employee_branch_id())
      OR EXISTS (
        SELECT 1 FROM public.employees e
        WHERE e.id = schedule_coverage.employee_id
          AND e.branch_id = (SELECT auth_employee_branch_id())
      )
    )
  );

DROP POLICY IF EXISTS schedule_coverage_update ON public.schedule_coverage;
CREATE POLICY schedule_coverage_update ON public.schedule_coverage
  FOR UPDATE TO authenticated
  USING (
    (SELECT auth_can_edit_any(ARRAY['schedules', 'schedules_tab_calendar']))
    AND (
      (SELECT auth_module_scope('schedules')) = 'ALL'
      OR coverage_branch_id = (SELECT auth_employee_branch_id())
      OR EXISTS (
        SELECT 1 FROM public.employees e
        WHERE e.id = schedule_coverage.employee_id
          AND e.branch_id = (SELECT auth_employee_branch_id())
      )
    )
  )
  WITH CHECK (
    (SELECT auth_can_edit_any(ARRAY['schedules', 'schedules_tab_calendar']))
    AND (
      (SELECT auth_module_scope('schedules')) = 'ALL'
      OR coverage_branch_id = (SELECT auth_employee_branch_id())
      OR EXISTS (
        SELECT 1 FROM public.employees e
        WHERE e.id = schedule_coverage.employee_id
          AND e.branch_id = (SELECT auth_employee_branch_id())
      )
    )
  );

DROP POLICY IF EXISTS schedule_coverage_delete ON public.schedule_coverage;
CREATE POLICY schedule_coverage_delete ON public.schedule_coverage
  FOR DELETE TO authenticated
  USING (
    (SELECT auth_can_edit_any(ARRAY['schedules', 'schedules_tab_calendar']))
    AND (
      (SELECT auth_module_scope('schedules')) = 'ALL'
      OR coverage_branch_id = (SELECT auth_employee_branch_id())
      OR EXISTS (
        SELECT 1 FROM public.employees e
        WHERE e.id = schedule_coverage.employee_id
          AND e.branch_id = (SELECT auth_employee_branch_id())
      )
    )
  );

-- Regla 2 de la estructura: toda clave foránea con un índice que la cubra.
CREATE INDEX IF NOT EXISTS idx_schedule_coverage_home_branch
  ON public.schedule_coverage (home_branch_id);

-- Toda lectura de horarios entra por la semana, y no había índice: hoy son 0
-- filas, pero son 46 por semana y el año que viene son ~2.400.
CREATE INDEX IF NOT EXISTS idx_employee_rosters_semana
  ON public.employee_rosters (week_start_date);


-- ── El catálogo y los feriados dejan de ser públicos ─────────────────────────
DROP POLICY IF EXISTS read_all ON public.shifts;
CREATE POLICY shifts_select ON public.shifts
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS read_all ON public.holidays;
CREATE POLICY holidays_select ON public.holidays
  FOR SELECT TO authenticated USING (true);

COMMENT ON TABLE public.shifts IS
  'Catálogo OPERATIVO de turnos, del módulo de Horarios — no son los turnos del reglamento interno (Art. 18), que rotan cada quince días y sirven para el contrato. El kiosco lo recibe por get_kiosk_boot_payload, no leyendo la tabla.';
