-- Planilla por quincenas (1–15 y 16–fin de mes) y anticipos descontados una sola vez.
-- Auditoría 2026-10-21, hallazgos H3 y H5 (fase2/grupo2.md).
--
-- 1. `payroll_periods`: una QUINCENA sólo puede ser del 1 al 15 o del 16 al último
--    día del mes. Decisión del dueño (2026-10-22): «del 1 al 15 y del 16 al 30 o 31».
--    La tabla está vacía en producción, así que el CHECK entra validado.
-- 2. `anticipos_en_planilla`: en qué período se descontó cada anticipo. El UNIQUE
--    sobre `request_id` es lo que garantiza «una sola vez» aunque dos personas
--    generen dos quincenas a la vez. No se toca `approval_requests` (viva, 3,000+
--    filas): una tabla aparte evita el ALTER sobre ella.
SET lock_timeout = '5s';

ALTER TABLE public.payroll_periods
  ADD CONSTRAINT payroll_periods_quincena_bordes CHECK (
    period_type IS DISTINCT FROM 'QUINCENA'
    OR (extract(day FROM start_date) = 1  AND end_date = start_date + 14)
    OR (extract(day FROM start_date) = 16
        AND end_date = (date_trunc('month', start_date) + interval '1 month - 1 day')::date)
  );

CREATE TABLE public.anticipos_en_planilla (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id  uuid NOT NULL UNIQUE REFERENCES public.approval_requests(id),
  period_id   uuid NOT NULL REFERENCES public.payroll_periods(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.employees(id),
  monto       numeric(12,2) NOT NULL CHECK (monto >= 0),
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid DEFAULT auth.uid()
);
COMMENT ON TABLE public.anticipos_en_planilla IS
  'En qué quincena se descontó cada anticipo (approval_requests type=ADVANCE). UNIQUE(request_id): una sola vez.';

-- request_id ya lo cubre el UNIQUE.
CREATE INDEX anticipos_en_planilla_period_id_idx   ON public.anticipos_en_planilla (period_id);
CREATE INDEX anticipos_en_planilla_employee_id_idx ON public.anticipos_en_planilla (employee_id);

ALTER TABLE public.anticipos_en_planilla ENABLE ROW LEVEL SECURITY;

-- Las mismas llaves que payroll_entries.
CREATE POLICY bloqueo_global ON public.anticipos_en_planilla AS RESTRICTIVE
  FOR ALL TO authenticated USING ((SELECT auth_no_bloqueado()));
CREATE POLICY anticipos_en_planilla_read ON public.anticipos_en_planilla
  FOR SELECT TO authenticated USING ((SELECT auth_has_module_permission('payroll', 'can_view')));
CREATE POLICY anticipos_en_planilla_insert ON public.anticipos_en_planilla
  FOR INSERT TO authenticated WITH CHECK ((SELECT auth_can_edit_any(ARRAY['payroll'])));
CREATE POLICY anticipos_en_planilla_delete ON public.anticipos_en_planilla
  FOR DELETE TO authenticated USING ((SELECT auth_can_edit_any(ARRAY['payroll'])));

REVOKE ALL ON public.anticipos_en_planilla FROM anon;
GRANT SELECT, INSERT, DELETE ON public.anticipos_en_planilla TO authenticated;
GRANT ALL ON public.anticipos_en_planilla TO service_role;
