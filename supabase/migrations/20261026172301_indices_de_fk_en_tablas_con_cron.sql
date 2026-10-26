SET lock_timeout = '5s';
CREATE INDEX IF NOT EXISTS idx_pedido_items_confirmado_suc_por ON public.pedido_items (confirmado_suc_por) WHERE confirmado_suc_por IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pedido_items_rechazado_por ON public.pedido_items (rechazado_por) WHERE rechazado_por IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_puntos_lote_nivel ON public.puntos_lote (nivel) WHERE nivel IS NOT NULL;
