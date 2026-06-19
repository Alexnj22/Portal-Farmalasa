-- Cambio de modelo: manual_min/max de bodega pasa de REEMPLAZO a DELTA ADITIVO.
-- Antes: effective = COALESCE(manual, sum)   → manual era el TOTAL (>= sum)
-- Ahora: effective = sum + manual             → manual es el EXCEDENTE (>= 0)
--
-- Ejemplo: sucursales sum_min=1, sum_max=2; bodega ingresa total 2,4.
--   delta_min=1, delta_max=2 guardados.
--   effective_min = 1+1=2, effective_max = 2+2=4.
-- Si sucursales bajan a 0,0: effective = 0+1=1, 0+2=2 (solo el excedente).
-- Si sucursales suben a 3,6: effective = 3+1=4, 6+2=8 (escala automático).
--
-- Migración de datos: convertir manual existente de total a delta.
-- new_manual = old_manual - min_units (la suma publicada al momento de la migración).
-- Si el delta resulta <= 0 → NULL (sin excedente, el sum ya cubre todo).

UPDATE product_stock_params
SET
  manual_min = CASE
    WHEN manual_min IS NOT NULL AND manual_min - COALESCE(min_units, 0) > 0
    THEN manual_min - COALESCE(min_units, 0)
    ELSE NULL
  END,
  manual_max = CASE
    WHEN manual_max IS NOT NULL AND manual_max - COALESCE(max_units, 0) > 0
    THEN manual_max - COALESCE(max_units, 0)
    ELSE NULL
  END,
  updated_at = NOW()
WHERE erp_sucursal_id = 6
  AND (manual_min IS NOT NULL OR manual_max IS NOT NULL);

-- get_stock_analysis: eff_min/max = COALESCE(sum_pub, sum_draft, 0) + COALESCE(delta, 0)
-- Sucursales: manual siempre NULL → delta=0 → mismo resultado que antes.
-- Bodega: manual es el excedente sobre la suma de sucursales.
-- (Ver migración completa del RPC en 20260619_get_stock_analysis_base_pres.sql)
