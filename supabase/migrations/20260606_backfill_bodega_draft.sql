-- Rellena draft_min/draft_max de Bodega con los valores live actuales
-- para productos que ya tienen min_units pero no tienen borrador pendiente.
-- Necesario porque el auto-draft en publish_stock_params se añadió después
-- de que ya estaban publicados.
UPDATE product_stock_params
SET
    draft_min           = min_units,
    draft_max           = max_units,
    draft_status        = 'pending',
    draft_calculated_at = NOW(),
    updated_at          = NOW()
WHERE erp_sucursal_id = 6
  AND min_units IS NOT NULL
  AND (draft_status IS NULL OR draft_status = 'none')
  AND is_hidden IS NOT TRUE;
