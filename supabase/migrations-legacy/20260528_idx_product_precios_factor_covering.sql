-- Covering index para el JOIN product_precios → factor en funciones de pedidos.
-- INCLUDE (factor) permite index-only scan: no necesita ir al heap a buscar la fila.
CREATE INDEX IF NOT EXISTS idx_pp_factor_lookup
  ON product_precios (product_id, id_presentacion)
  INCLUDE (factor);
