-- Fase 1 de docs/PLAN-MINMAX-AJUSTE-A-MANO-2026-08-20.md — los casilleros del
-- ajuste a mano.
--
-- NO cambia ningún MIN ni ningún MAX, y no puede hacerlo: las columnas nacen
-- NULL en las 19,041 filas, así que la lógica de las fases siguientes queda
-- inerte por construcción — no hay ni una fila a la que aplicarse. Un ADD
-- COLUMN nullable sin default no reescribe la tabla (PG11+): es catálogo.
--
-- El problema que abre: cuando alguien corrige un MIN/MAX a mano, el portal lo
-- escribe directo sobre min_units/max_units SIN dejar marca de que fue una
-- persona, y el recálculo mensual lo sobrescribe al publicar. Medido contra
-- producción el 2026-08-20: de 969 pares producto·sala ajustados antes del
-- recálculo del 1-ago y nunca vueltos a tocar, 567 (59%) ya no tienen el valor
-- que se les puso; en 143 casos alguien BAJÓ el MAX y el cálculo se lo volvió a
-- SUBIR, devolviendo 1,340 unidades.
--
-- Probado antes en staging (cbnjplmnfmfsambavjce) con los 10 casos de borde.
-- Ahí se descubrió que `psp_cliente_fijo_completo` escrito de la forma obvia NO
-- frenaba: con las columnas en NULL la expresión da NULL, y un CHECK sólo
-- rechaza con FALSE. De ahí el `IS TRUE`, que no es cosmético.

SET lock_timeout = '5s';

ALTER TABLE public.product_stock_params
  ADD COLUMN IF NOT EXISTS manual_motivo           text,
  ADD COLUMN IF NOT EXISTS manual_nota             text,
  ADD COLUMN IF NOT EXISTS manual_por              text,
  ADD COLUMN IF NOT EXISTS manual_at               timestamptz,
  ADD COLUMN IF NOT EXISTS manual_cliente_unidades integer,
  ADD COLUMN IF NOT EXISTS manual_cliente_dias     integer;

COMMENT ON COLUMN public.product_stock_params.manual_motivo IS
  'Por qué una persona puso este MIN/MAX. La lista NO se inventó: sale de las 16 razones ya escritas en minmax_change_requests.reason. ya_no_rota = se dejó de vender / sólo por encargo (el cálculo deja de contar la venta anterior a manual_at). lo_buscan = demanda que el historial no puede ver porque nunca hubo producto (el valor es piso). cliente_fijo = «compra N cada M días» (la velocidad sale de ese ritmo). otro = cualquier otra cosa, incluido el tope de sala; NO cambia el cálculo y deja la fila En conflicto para que alguien la mire.';
COMMENT ON COLUMN public.product_stock_params.manual_at IS
  'Cuándo se puso el ajuste. Es además la FECHA DE CORTE: con motivo ya_no_rota, el cálculo ignora la venta anterior a este instante.';
COMMENT ON COLUMN public.product_stock_params.manual_cliente_unidades IS
  'Sólo con motivo cliente_fijo: las N unidades de «compra 20 cada 2 meses».';
COMMENT ON COLUMN public.product_stock_params.manual_cliente_dias IS
  'Sólo con motivo cliente_fijo: los M días de «compra 20 cada 2 meses» (60).';

-- Los cuatro frenos. Un motivo mal formado es peor que ninguno: haría que el
-- cálculo actuara sobre una intención que nadie declaró.
ALTER TABLE public.product_stock_params
  ADD CONSTRAINT psp_manual_motivo_valido CHECK (
    manual_motivo IS NULL
    OR manual_motivo IN ('ya_no_rota', 'lo_buscan', 'cliente_fijo', 'otro')
  ),
  -- Sin fecha no hay corte, y sin corte «ya_no_rota» no sabe desde cuándo ignorar.
  ADD CONSTRAINT psp_manual_con_fecha CHECK (
    manual_motivo IS NULL OR manual_at IS NOT NULL
  ),
  -- El `IS TRUE` es el arreglo del hallazgo de staging: sin él, cliente_fijo sin
  -- números pasaba el freno y el cálculo se quedaba sin el ritmo que necesita.
  ADD CONSTRAINT psp_cliente_fijo_completo CHECK (
    CASE WHEN manual_motivo = 'cliente_fijo'
         THEN (manual_cliente_unidades > 0 AND manual_cliente_dias > 0) IS TRUE
         ELSE manual_cliente_unidades IS NULL AND manual_cliente_dias IS NULL
    END
  ),
  -- «otro» es el cajón de lo que no entra en la lista. Sin nota no dice nada,
  -- y es justo el motivo que existe para que quede escrito el porqué.
  ADD CONSTRAINT psp_otro_con_nota CHECK (
    manual_motivo IS DISTINCT FROM 'otro'
    OR (manual_nota IS NOT NULL AND btrim(manual_nota) <> '')
  );

-- Parcial: sólo las filas ajustadas, que hoy son cero y nunca van a ser muchas.
CREATE INDEX IF NOT EXISTS idx_psp_manual_motivo
  ON public.product_stock_params (erp_sucursal_id, manual_motivo)
  WHERE manual_motivo IS NOT NULL;
