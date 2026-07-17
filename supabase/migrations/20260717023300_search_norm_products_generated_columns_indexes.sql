-- CREATE INDEX CONCURRENTLY no puede ir dentro de una transacción → aplicado vía
-- execute_sql statement por statement (no apply_migration). Ver CLAUDE.md.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_products_nombre_norm_trgm
  ON public.products USING gin (nombre_norm gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_products_pactivo_norm_trgm
  ON public.products USING gin (pactivo_norm gin_trgm_ops) WHERE (pactivo_norm IS NOT NULL AND pactivo_norm <> '');
