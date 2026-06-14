-- Fix Bodega min_units retroactivo: antes de v2.2.90, publish_stock_params
-- publicaba Bodega usando draft_min (= Σ efectivo incluyendo sucursales en borrador).
-- Correcto: min_units debe ser solo la Σ de las sucursales YA publicadas (pub_sum).
--
-- Esta migración recomputa todos los min_units/max_units de Bodega sin override manual.
-- La lógica es idéntica al paso 2 de publish_stock_params v6.

WITH branch_sums AS (
  SELECT
    erp_product_id,
    SUM(COALESCE(min_units, 0))::int                                   AS pub_min,
    SUM(COALESCE(max_units, 0))::int                                   AS pub_max,
    SUM(COALESCE(
      CASE WHEN draft_status = 'pending' THEN draft_min ELSE min_units END,
    0))::int                                                           AS eff_min,
    SUM(COALESCE(
      CASE WHEN draft_status = 'pending' THEN draft_max ELSE max_units END,
    0))::int                                                           AS eff_max
  FROM product_stock_params
  WHERE erp_sucursal_id != 6
  GROUP BY erp_product_id
  HAVING SUM(COALESCE(min_units, 0)) > 0
      OR SUM(COALESCE(max_units, 0)) > 0
)
UPDATE product_stock_params psp
SET
  min_units    = bs.pub_min,
  max_units    = bs.pub_max,
  -- Draft = proyección efectiva solo cuando difiere del publicado
  draft_min    = CASE WHEN bs.eff_min != bs.pub_min OR bs.eff_max != bs.pub_max THEN bs.eff_min ELSE NULL END,
  draft_max    = CASE WHEN bs.eff_min != bs.pub_min OR bs.eff_max != bs.pub_max THEN bs.eff_max ELSE NULL END,
  draft_status = CASE WHEN bs.eff_min != bs.pub_min OR bs.eff_max != bs.pub_max THEN 'pending' ELSE 'none' END,
  updated_at   = NOW()
FROM branch_sums bs
WHERE psp.erp_product_id = bs.erp_product_id
  AND psp.erp_sucursal_id = 6
  AND psp.manual_min IS NULL
  AND psp.manual_max IS NULL
  AND (psp.is_hidden IS NOT TRUE);
