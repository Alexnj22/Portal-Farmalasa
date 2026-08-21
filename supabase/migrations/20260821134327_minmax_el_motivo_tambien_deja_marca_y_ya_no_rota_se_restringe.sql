-- Fase 5a de docs/PLAN-MINMAX-AJUSTE-A-MANO-2026-08-20.md — el motivo se puede
-- declarar sin tocar el número, y «ya no rota» queda restringido.
--
-- Dos cosas que el trigger de la fase 2 no cubría:
--
-- 1. Alguien puede marcar «ya no rota» SIN cambiar el MIN/MAX —es el caso
--    natural: el producto dejó de venderse y lo que se quiere es que el cálculo
--    deje de contarlo—. Sin `manual_at` ese motivo no tendría fecha de corte,
--    que es justo el dato del que depende, ni pasaría su propio CHECK.
-- 2. «Ya no rota» es el único motivo que BORRA historial de demanda. La
--    decisión del 2026-08-21 (§9 del plan) fue restringirlo a quien decide
--    sobre todas las salas, no dejarlo a un clic de cualquiera que edite.
--
-- Probado en staging con los cuatro casos antes de aplicar acá.

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.marcar_ajuste_manual_minmax()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, extensions
AS $$
DECLARE
  v_cambio_numero  boolean := NEW.min_units     IS DISTINCT FROM OLD.min_units
                           OR NEW.max_units     IS DISTINCT FROM OLD.max_units;
  v_cambio_motivo  boolean := NEW.manual_motivo IS DISTINCT FROM OLD.manual_motivo;
BEGIN
  -- «Ya no rota» es el único motivo que BORRA historial de demanda: le dice al
  -- cálculo que deje de contar todo lo vendido antes de hoy. No puede quedar a
  -- un clic de distancia de cualquiera que edite una celda, así que pide el
  -- mismo alcance que ya distingue a supervisión de una sala.
  IF v_cambio_motivo AND NEW.manual_motivo = 'ya_no_rota'
     AND auth.uid() IS NOT NULL
     AND NOT (SELECT public.auth_can_edit_scope_all(ARRAY['minmax','pedidos'])) THEN
    RAISE EXCEPTION 'MOTIVO_DENEGADO: «ya no rota» sólo lo puede poner quien decide sobre todas las salas';
  END IF;

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
    -- Declarar el motivo TAMBIÉN es ajustar: alguien puede marcar «ya no rota»
    -- sin tocar el número, y sin `manual_at` ese motivo no tendría fecha de
    -- corte —que es justo el dato del que depende— ni pasaría su propio CHECK.
    IF v_cambio_numero OR (v_cambio_motivo AND NEW.manual_motivo IS NOT NULL) THEN
      NEW.manual_at  := now();
      NEW.manual_por := coalesce(auth.email(), auth.uid()::text);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_marcar_ajuste_manual_minmax ON public.product_stock_params;

CREATE TRIGGER trg_marcar_ajuste_manual_minmax
  BEFORE UPDATE ON public.product_stock_params
  FOR EACH ROW
  WHEN (OLD.min_units     IS DISTINCT FROM NEW.min_units
     OR OLD.max_units     IS DISTINCT FROM NEW.max_units
     OR OLD.manual_motivo IS DISTINCT FROM NEW.manual_motivo)
  EXECUTE FUNCTION public.marcar_ajuste_manual_minmax();
