-- Ocultar por defecto productos de laboratorios de compra local.
-- Estos productos no deben aparecer en el módulo MinMax.
-- Labs: SARITA (366), CONSTANCIA (47), BEBIDAS (333), RECARGA (191), NEVERIA (249)

INSERT INTO product_stock_params (erp_product_id, erp_sucursal_id, is_hidden, draft_min, draft_max, draft_status, updated_at)
SELECT
    p.id,
    s.erp_sucursal_id,
    true,
    0,
    0,
    'pending',
    NOW()
FROM products p
CROSS JOIN (SELECT DISTINCT erp_sucursal_id FROM erp_sucursal_map) s
WHERE p.laboratorio_id IN (47, 191, 249, 333, 366)
  AND p.activo = true
ON CONFLICT (erp_product_id, erp_sucursal_id) DO UPDATE SET
    is_hidden    = true,
    draft_min    = 0,
    draft_max    = 0,
    draft_status = 'pending',
    updated_at   = NOW();
