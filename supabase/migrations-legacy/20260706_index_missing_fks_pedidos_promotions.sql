-- Perf advisor: FKs sin índice. Excluye *_por/created_by en tablas chicas
-- de puro audit (regla #2 CLAUDE.md) — pero estas SÍ son tablas operativas
-- activas (workflow de pedidos, dashboard de promociones), no audit puro.

CREATE INDEX IF NOT EXISTS idx_pss_confirmado_correccion_por ON public.pedido_sucursal_status(confirmado_correccion_por);
CREATE INDEX IF NOT EXISTS idx_pss_corregido_bodega_por ON public.pedido_sucursal_status(corregido_bodega_por);
CREATE INDEX IF NOT EXISTS idx_pss_diferencias_reportadas_por ON public.pedido_sucursal_status(diferencias_reportadas_por);
CREATE INDEX IF NOT EXISTS idx_pss_finalizado_por ON public.pedido_sucursal_status(finalizado_por);
CREATE INDEX IF NOT EXISTS idx_pss_iniciado_por ON public.pedido_sucursal_status(iniciado_por);
CREATE INDEX IF NOT EXISTS idx_pss_llegada_fisica_por ON public.pedido_sucursal_status(llegada_fisica_por);
CREATE INDEX IF NOT EXISTS idx_pss_reanudado_por ON public.pedido_sucursal_status(reanudado_por);
CREATE INDEX IF NOT EXISTS idx_pss_recibido_erp_por ON public.pedido_sucursal_status(recibido_erp_por);
CREATE INDEX IF NOT EXISTS idx_pss_reenvio_por ON public.pedido_sucursal_status(reenvio_por);

CREATE INDEX IF NOT EXISTS idx_ruta_pedidos_confirmado_suc_por ON public.ruta_pedidos(confirmado_suc_por);
CREATE INDEX IF NOT EXISTS idx_ruta_pedidos_entregado_por ON public.ruta_pedidos(entregado_por);

CREATE INDEX IF NOT EXISTS idx_promotion_branches_branch ON public.promotion_branches(branch_id);
CREATE INDEX IF NOT EXISTS idx_promotion_payments_paid_by ON public.promotion_payments(paid_by);
CREATE INDEX IF NOT EXISTS idx_promotion_sales_cache_branch ON public.promotion_sales_cache(branch_id);
CREATE INDEX IF NOT EXISTS idx_promotions_created_by ON public.promotions(created_by);
