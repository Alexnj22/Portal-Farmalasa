-- El índice parcial de la fase 1 filtraba por `manual_motivo IS NOT NULL`, pero
-- el predicado que de verdad se usa es `manual_at IS NOT NULL`: es el que mira
-- publish_stock_params para no pisar, y el que va a mirar la pantalla para
-- listar los ajustes. Un ajuste SIN motivo declarado igual es un ajuste — de
-- hecho van a ser la mayoría, porque el motivo es opcional.

SET lock_timeout = '5s';

DROP INDEX IF EXISTS public.idx_psp_manual_motivo;

CREATE INDEX IF NOT EXISTS idx_psp_manual_at
  ON public.product_stock_params (erp_sucursal_id, manual_at)
  WHERE manual_at IS NOT NULL;
