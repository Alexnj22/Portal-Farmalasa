-- CREATE INDEX CONCURRENTLY no puede ir dentro de una transacción → aplicado vía
-- execute_sql statement por statement (no apply_migration). Ver CLAUDE.md.
-- Complementa idx_si_cliente_norm_trgm (2.2): search_ventas_ids (2.4-B) filtra
-- también erp_invoice_id y correlativo.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_si_erp_invoice_norm_trgm
  ON public.sales_invoices USING gin (public.norm_search(erp_invoice_id) gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_si_correlativo_norm_trgm
  ON public.sales_invoices USING gin (public.norm_search(correlativo) gin_trgm_ops);
