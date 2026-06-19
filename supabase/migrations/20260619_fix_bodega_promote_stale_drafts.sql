-- Corregir los productos en bodega que quedaron atascados como borrador
-- porque el trigger anterior siempre usaba draft_status='pending'.
-- Promover a live (min_units/max_units) cuando todas las sucursales están publicadas.
-- Recalcula min_units y max_units como suma correcta de sucursales publicadas.

UPDATE product_stock_params bodega
SET
  min_units           = calc.bodega_min,
  max_units           = calc.bodega_max,
  draft_status        = 'none',
  draft_min           = NULL,
  draft_max           = NULL,
  updated_at          = NOW()
FROM (
  SELECT
    psp.erp_product_id,
    SUM(COALESCE(psp.min_units, 0))::integer AS bodega_min,
    SUM(COALESCE(psp.max_units, 0))::integer AS bodega_max
  FROM product_stock_params psp
  WHERE psp.erp_sucursal_id != 6
  GROUP BY psp.erp_product_id
  HAVING BOOL_AND(COALESCE(psp.draft_status, 'none') IS DISTINCT FROM 'pending')
) calc
WHERE bodega.erp_product_id = calc.erp_product_id
  AND bodega.erp_sucursal_id = 6
  AND bodega.is_hidden IS NOT TRUE
  AND (calc.bodega_min > 0 OR calc.bodega_max > 0);
