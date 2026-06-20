-- Los PSP de estos 3 productos quedaron en "cajas" (unidad ERP con factor=1)
-- pero la fórmula ahora espera "tabletas". Se multiplica por el factor real.
-- Solo min_units/max_units (auto-calculados). manual_min/manual_max son NULL → no se tocan.
-- Productos: ELEQUINE×20 (3912), ENALAM×10 (4673), ESOMEPRAKEM×10 (4816)
-- PAXIL CR (4027) no tiene PSP asignado → no necesita corrección.

UPDATE product_stock_params psp
SET
  min_units = psp.min_units * vf.factor,
  max_units = psp.max_units * vf.factor
FROM (
  SELECT DISTINCT ON (pp.product_id) pp.product_id, pp.factor
  FROM product_precios pp
  JOIN presentaciones pr ON pr.id = pp.id_presentacion
  WHERE pp.activo = true AND pp.factor > 0
  ORDER BY pp.product_id, pp.factor DESC
) vf
WHERE psp.erp_product_id = vf.product_id
  AND psp.erp_product_id IN (3912, 4673, 4816)
  AND psp.min_units IS NOT NULL
  AND psp.manual_min IS NULL
  AND psp.manual_max IS NULL;
