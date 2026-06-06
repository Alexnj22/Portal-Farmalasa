-- Limpia is_hidden individual de productos cuyo laboratorio ya tiene ocultar_en_minmax = true.
-- El filtrado ahora ocurre a nivel de lab en get_stock_analysis; los productos no deben
-- quedar marcados como "ocultos" individualmente — simplemente no aparecen.
UPDATE product_stock_params psp
SET is_hidden = false, updated_at = NOW()
FROM products p
JOIN laboratorios l ON l.id = p.laboratorio_id
WHERE p.id = psp.erp_product_id
  AND l.ocultar_en_minmax = true
  AND psp.is_hidden = true;
