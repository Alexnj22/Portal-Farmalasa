-- CREATE INDEX CONCURRENTLY no puede ir dentro de una transacción → aplicado vía
-- execute_sql statement por statement (no apply_migration). Ver CLAUDE.md.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_si_cliente_norm_trgm
  ON public.sales_invoices USING gin (public.norm_search(cliente) gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_igmv_desc_norm_trgm
  ON public.inventory_grouped_mv USING gin (public.norm_search(descripcion) gin_trgm_ops);
