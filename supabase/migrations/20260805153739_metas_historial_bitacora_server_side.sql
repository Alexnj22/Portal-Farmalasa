SET lock_timeout = '5s';

-- Las transiciones de una meta solo se anotaban con `appendAuditLog` desde el
-- navegador: un RPC llamado por fuera del portal no dejaba nada, `monto_meta`
-- se sobrescribía en sitio (el valor anterior se perdía) y las columnas
-- supervisor_por/gerente_por guardan solo al ÚLTIMO actor. Como la meta define
-- el bono de la sala, el rastro tiene que vivir del lado del servidor.
--
-- Append-only, como el resto del historial de negocio (employee_events,
-- timesheets): sin policy de UPDATE ni de DELETE. Y NO se purga — la retención
-- de 90 días es para los logs de infraestructura, no para el historial que
-- explica por qué una sala cobró lo que cobró.
CREATE TABLE IF NOT EXISTS public.metas_historial (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- Se guardan sala y mes propios, además de la FK: una bitácora que se borra
  -- en cascada con lo que audita no es una bitácora.
  meta_id        bigint REFERENCES public.metas_sucursal(id) ON DELETE SET NULL,
  branch_id      bigint NOT NULL,
  year_month     text   NOT NULL,
  evento         text   NOT NULL,
  estado_antes   text,
  estado_despues text,
  monto_antes    numeric,
  monto_despues  numeric,
  actor          uuid,          -- NULL = lo hizo el portal (cron), no una persona
  nota           text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_metas_historial_meta   ON public.metas_historial(meta_id);
CREATE INDEX IF NOT EXISTS idx_metas_historial_sala_mes ON public.metas_historial(branch_id, year_month);

ALTER TABLE public.metas_historial ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS metas_historial_select ON public.metas_historial;
-- El wrapper `(SELECT ...)` es obligatorio: sin él Postgres evalúa la función
-- POR FILA (incidente 2026-07-08).
CREATE POLICY metas_historial_select ON public.metas_historial
  FOR SELECT TO authenticated
  USING ((SELECT public.auth_has_module_permission('metas', 'can_view')));

-- Sin policies de INSERT/UPDATE/DELETE a propósito: se escribe SOLO por
-- `metas_log`, que es DEFINER y no es ejecutable por `authenticated`. Si lo
-- fuera, cualquiera podría fabricar la bitácora desde la consola del navegador
-- — que es exactamente el agujero que la auditoría encontró en `audit_logs`.
CREATE OR REPLACE FUNCTION public.metas_log(
    p_meta_id bigint,
    p_evento text,
    p_estado_antes text DEFAULT NULL,
    p_estado_despues text DEFAULT NULL,
    p_monto_antes numeric DEFAULT NULL,
    p_monto_despues numeric DEFAULT NULL,
    p_nota text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_branch bigint;
  v_ym     text;
BEGIN
  SELECT m.branch_id, m.year_month INTO v_branch, v_ym
  FROM public.metas_sucursal m WHERE m.id = p_meta_id;
  IF v_branch IS NULL THEN RETURN; END IF;

  INSERT INTO public.metas_historial
    (meta_id, branch_id, year_month, evento, estado_antes, estado_despues,
     monto_antes, monto_despues, actor, nota)
  VALUES
    (p_meta_id, v_branch, v_ym, p_evento, p_estado_antes, p_estado_despues,
     p_monto_antes, p_monto_despues, public.auth_employee_id(), NULLIF(btrim(p_nota), ''));
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.metas_log(bigint, text, text, text, numeric, numeric, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.metas_log(bigint, text, text, text, numeric, numeric, text)
  TO service_role;

-- Verificado en prod dentro de una transacción revertida, actuando como un
-- usuario `authenticated` con permiso de editar Metas:
--   metas_log llamada a mano  → permission denied for function metas_log
--   INSERT directo            → rechazado por RLS
--   DELETE sobre un renglón   → 0 filas afectadas, el renglón intacto
--   UPDATE sobre un renglón   → 0 filas afectadas, el monto intacto
