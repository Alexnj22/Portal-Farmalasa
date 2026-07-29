-- F3.2 — El indice que el comentario del codigo ya daba por hecho.
--
-- `fetchStockParamsUpdates` (src/data/stockParams.js) es el polling de Bodega:
-- corre cada 5 segundos por pestaña abierta, con filtro de igualdad por
-- sucursal, un cursor keyset sobre (updated_at, erp_product_id) y ORDER BY por
-- esas dos columnas. El comentario que hay arriba de esa funcion habla del
-- keyset como si el indice existiera. No existia.
--
-- Medido antes (EXPLAIN ANALYZE, sucursal 1):
--   Index Scan using idx_psp_sucursal
--     Filter: (updated_at > ... OR (updated_at = ... AND erp_product_id > ...))
--     Rows Removed by Filter: 2501
--     Buffers: shared hit=239   →   + un Sort por (updated_at, erp_product_id)
--
-- O sea: lee las 2,501 filas de la sucursal, las tira todas por el filtro, y
-- encima ordena. Cada 5 segundos.
--
-- El indice compuesto en el orden exacto (igualdad, rango, desempate) permite
-- resolver el filtro dentro del indice y devuelve las filas ya ordenadas.

SET lock_timeout = '5s';

CREATE INDEX IF NOT EXISTS idx_psp_sucursal_updated_producto
  ON public.product_stock_params (erp_sucursal_id, updated_at, erp_product_id);
