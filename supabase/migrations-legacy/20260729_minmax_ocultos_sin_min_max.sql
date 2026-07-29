SET lock_timeout = '5s';

-- Invariante definido por el usuario (2026-07-29): un producto oculto en
-- MIN/MAX va en -/-. Quedaban 9 filas ocultas conservando valores — 6 en 0/0 y
-- 3 con cantidades reales publicadas el 17-jul:
--   PRUEBA DE EMBARAZO ADVIN 21/34 · DOLO ESPASMON 8/13 · ELECTROLIT JAMAICA 6/17
--
-- Dejarlas así es contradictorio: un producto que se decidió no gestionar seguía
-- pesando en el pedido sugerido. Revertirlo es trivial si hiciera falta:
-- desocultar y el recálculo mensual los vuelve a calcular.
UPDATE public.product_stock_params
SET min_units    = NULL,
    max_units    = NULL,
    draft_min    = NULL,
    draft_max    = NULL,
    draft_status = 'none',
    updated_at   = now()
WHERE is_hidden IS TRUE
  AND (min_units IS NOT NULL OR max_units IS NOT NULL
       OR draft_min IS NOT NULL OR draft_max IS NOT NULL
       OR draft_status IS DISTINCT FROM 'none');
