-- Las reglas de pago de las horas, decididas por el usuario (2026-11-23).
--
--   · Horas de más (CT Art. 169: recargo del 100 % sobre el salario básico por
--     hora; Art. 170: sólo ocasionales). Talento Humano decide en CADA caso si
--     van a PAGO o al BANCO de horas: `timesheets.extra_decision`. NULL es «por
--     decidir» y la planilla no las paga ni las banca hasta que se elija.
--   · Día de descanso trabajado (CT Art. 175; RIT Art. 30): salario básico más
--     un mínimo de 50 % por las horas trabajadas, más un día de descanso
--     compensatorio remunerado en la misma semana o la siguiente (CT Art. 176).
--     La consolidación lo marca en `timesheets.is_rest_day_worked`.
--   · Pérdida del pago del descanso semanal (RIT Arts. 23, 25 y 26; CT Art.
--     171): más de 10 minutos de tardanza en la semana, o semana incompleta sin
--     causa justificada. La planilla lo PROPONE y Talento Humano lo confirma o
--     lo justifica en `descanso_semanal_decisiones`. Nunca se descuentan
--     minutos ni horas de tardanza. Las amonestaciones (RIT Art. 82) no son
--     automáticas y no viven acá.
--
-- Quién decide no lo escribe el navegador: las dos funciones firman con
-- `auth_employee_id()` y son INVOKER, así que el RLS sigue decidiendo quién
-- puede (Talento Humano: `time_audit` con edición).
SET lock_timeout = '5s';

ALTER TABLE public.timesheets
  ADD COLUMN IF NOT EXISTS extra_decision text
    CHECK (extra_decision IS NULL OR extra_decision IN ('PAGO', 'BANCO')),
  ADD COLUMN IF NOT EXISTS extra_decidida_por uuid,
  ADD COLUMN IF NOT EXISTS extra_decidida_el timestamptz,
  ADD COLUMN IF NOT EXISTS is_rest_day_worked boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.timesheets.extra_decision IS
  'Horas de más del día (CT Art. 169/170): PAGO o BANCO, lo decide Talento Humano. NULL = por decidir: ni se pagan ni se bancan.';
COMMENT ON COLUMN public.timesheets.is_rest_day_worked IS
  'Trabajó en su día de descanso (CT Art. 175, RIT Art. 30): +50 % por las horas y un día compensatorio (CT Art. 176).';

ALTER TABLE public.payroll_entries
  ADD COLUMN IF NOT EXISTS extras_por_decidir_horas numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS descanso_por_decidir_semanas integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS descanso_perdido_semanas integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS descansos_compensatorios integer NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.descanso_semanal_decisiones (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  employee_id   uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  semana        date NOT NULL,                 -- el lunes de la semana
  decision      text NOT NULL CHECK (decision IN ('PIERDE', 'JUSTIFICADO')),
  motivo        text NOT NULL CHECK (motivo IN ('TARDANZA', 'SEMANA_INCOMPLETA', 'AMBOS')),
  minutos_tarde integer NOT NULL DEFAULT 0,
  nota          text,
  decidido_por  uuid NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employee_id, semana),
  CHECK (extract(isodow from semana) = 1)
);
COMMENT ON TABLE public.descanso_semanal_decisiones IS
  'RIT Arts. 25 y 26 / CT Art. 171: Talento Humano confirma (PIERDE) o justifica la pérdida del pago del descanso semanal. Historial de negocio: no se purga.';

ALTER TABLE public.descanso_semanal_decisiones ENABLE ROW LEVEL SECURITY;

CREATE POLICY descanso_semanal_select ON public.descanso_semanal_decisiones
  FOR SELECT TO authenticated
  USING ((SELECT auth_has_module_permission('time_audit', 'can_view'))
      OR (SELECT auth_has_module_permission('payroll', 'can_view')));
CREATE POLICY descanso_semanal_insert ON public.descanso_semanal_decisiones
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth_can_edit_any(ARRAY['time_audit']))
              AND decidido_por = (SELECT auth_employee_id()));
CREATE POLICY descanso_semanal_update ON public.descanso_semanal_decisiones
  FOR UPDATE TO authenticated
  USING ((SELECT auth_can_edit_any(ARRAY['time_audit'])))
  WITH CHECK ((SELECT auth_can_edit_any(ARRAY['time_audit']))
              AND decidido_por = (SELECT auth_employee_id()));

REVOKE ALL ON public.descanso_semanal_decisiones FROM anon;
GRANT SELECT, INSERT, UPDATE ON public.descanso_semanal_decisiones TO authenticated;
GRANT ALL ON public.descanso_semanal_decisiones TO service_role;

-- Talento Humano decide las horas de más de uno o varios días.
CREATE OR REPLACE FUNCTION public.decidir_horas_extra(p_ids uuid[], p_decision text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY INVOKER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_quien uuid := public.auth_employee_id();
  v_n     integer;
BEGIN
  IF p_decision IS NOT NULL AND p_decision NOT IN ('PAGO', 'BANCO') THEN
    RAISE EXCEPTION 'Decisión no válida: %', p_decision;
  END IF;
  IF v_quien IS NULL THEN
    RAISE EXCEPTION 'No se pudo saber quién decide.';
  END IF;
  UPDATE public.timesheets
     SET extra_decision     = p_decision,
         extra_decidida_por = CASE WHEN p_decision IS NULL THEN NULL ELSE v_quien END,
         extra_decidida_el  = CASE WHEN p_decision IS NULL THEN NULL ELSE now() END,
         updated_at         = now()
   WHERE id = ANY (p_ids)
     AND coalesce(overtime_hours, 0) > 0;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  -- Sin permiso, el RLS deja el UPDATE en cero filas sin error: se dice.
  IF v_n = 0 AND coalesce(cardinality(p_ids), 0) > 0 THEN
    RAISE EXCEPTION 'No se guardó ninguna decisión: falta el permiso de editar la auditoría de tiempos, o esos días no tienen horas de más.';
  END IF;
  RETURN v_n;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.decidir_horas_extra(uuid[], text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.decidir_horas_extra(uuid[], text) TO authenticated, service_role;

-- Talento Humano confirma o justifica la pérdida del descanso de una semana.
CREATE OR REPLACE FUNCTION public.decidir_descanso_semanal(
  p_employee_id uuid, p_semana date, p_decision text, p_motivo text,
  p_minutos_tarde integer DEFAULT 0, p_nota text DEFAULT NULL)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY INVOKER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_quien uuid := public.auth_employee_id();
BEGIN
  IF v_quien IS NULL THEN
    RAISE EXCEPTION 'No se pudo saber quién decide.';
  END IF;
  INSERT INTO public.descanso_semanal_decisiones
         (employee_id, semana, decision, motivo, minutos_tarde, nota, decidido_por)
  VALUES (p_employee_id, p_semana, p_decision, p_motivo, coalesce(p_minutos_tarde, 0), nullif(p_nota, ''), v_quien)
  ON CONFLICT (employee_id, semana) DO UPDATE
     SET decision      = EXCLUDED.decision,
         motivo        = EXCLUDED.motivo,
         minutos_tarde = EXCLUDED.minutos_tarde,
         nota          = EXCLUDED.nota,
         decidido_por  = EXCLUDED.decidido_por,
         updated_at    = now();
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.decidir_descanso_semanal(uuid, date, text, text, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.decidir_descanso_semanal(uuid, date, text, text, integer, text) TO authenticated, service_role;
