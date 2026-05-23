-- Reemplazar erp_minmax.presentacion (texto libre) por erp_presentacion_id (FK real).
-- El JSON del ERP ya incluye id_presentacion en cada detalle del reporte de reposición.
-- Con el FK, las funciones SQL pueden hacer JOIN directo a presentaciones(tipo, factor, ...)
-- en lugar de depender del texto del ERP.

-- 1. Limpiar filas existentes — no tienen erp_presentacion_id, el sync las repoblará.
TRUNCATE TABLE erp_minmax;

-- 2. Eliminar columna texto redundante.
ALTER TABLE erp_minmax DROP COLUMN IF EXISTS presentacion;

-- 3. Agregar FK NOT NULL a presentaciones.
--    ON DELETE RESTRICT: si se elimina una presentación con min/max activos, falla con error
--    visible en vez de silencio. Eso es correcto — hay que limpiar el ERP primero.
ALTER TABLE erp_minmax
  ADD COLUMN erp_presentacion_id integer NOT NULL
  REFERENCES presentaciones(id) ON DELETE RESTRICT;

-- 4. Índice para joins rápidos (get_stock_analysis, get_stagnant_inventory, etc.)
CREATE INDEX idx_erp_minmax_erp_presentacion_id
  ON erp_minmax (erp_presentacion_id);

COMMENT ON COLUMN erp_minmax.erp_presentacion_id IS
  'FK a presentaciones(id). Viene de id_presentacion en el JSON del reporte de reposición del ERP.';
