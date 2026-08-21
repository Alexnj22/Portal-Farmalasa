-- Fase 2 de docs/PLAN-MINMAX-AJUSTE-A-MANO-2026-08-20.md — la marca de que un
-- MIN/MAX lo movió una persona.
--
-- Vive en la BASE y no en el frontend a propósito. La versión de frontend
-- obligaba a que cada camino de edición se acordara de mandar el dato, y hoy
-- hay tres (celda viva, borrador, Bodega) más los que se escriban después: es
-- exactamente una prop opt-in, o sea una prop olvidada. Acá no se puede
-- olvidar, y además quien edita no puede mentir sobre quién fue — el nombre
-- sale de la sesión, no del navegador (misma regla que src/data/audit.js).
--
-- Probado en staging con los cinco casos de borde antes de aplicar acá.

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.marcar_ajuste_manual_minmax()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, extensions
AS $$
BEGIN
  -- Quién NO es una persona ajustando a mano:
  --
  -- 1. El recálculo y el auto-aplicar corren con service_role desde la edge
  --    function: ahí `auth.uid()` es NULL.
  -- 2. Publicar un borrador SÍ corre con la sesión de quien publica
  --    (publish_stock_params es SECURITY DEFINER pero la invoca el navegador),
  --    así que `auth.uid()` no alcanza para distinguirlo. Lo que sí lo
  --    distingue es que publicar SIEMPRE reescribe `published_at` en el mismo
  --    UPDATE — es su firma, y no la comparte ninguna edición de celda.
  IF auth.uid() IS NOT NULL
     AND NEW.published_at IS NOT DISTINCT FROM OLD.published_at THEN
    NEW.manual_at  := now();
    NEW.manual_por := coalesce(auth.email(), auth.uid()::text);
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.marcar_ajuste_manual_minmax() IS
  'Deja la marca de que un MIN/MAX lo movió una persona. Vive en la base y no en el frontend a propósito: así ningún camino de edición —ni los que se escriban después— puede olvidarse de ponerla, y quien edita no puede mentir sobre quién fue (el nombre sale de la sesión, no del navegador).';

DROP TRIGGER IF EXISTS trg_marcar_ajuste_manual_minmax ON public.product_stock_params;

-- El WHEN se evalúa SIN llamar a la función: un recálculo que sólo toca los
-- borradores no paga nada por este trigger.
CREATE TRIGGER trg_marcar_ajuste_manual_minmax
  BEFORE UPDATE ON public.product_stock_params
  FOR EACH ROW
  WHEN (OLD.min_units IS DISTINCT FROM NEW.min_units
     OR OLD.max_units IS DISTINCT FROM NEW.max_units)
  EXECUTE FUNCTION public.marcar_ajuste_manual_minmax();
