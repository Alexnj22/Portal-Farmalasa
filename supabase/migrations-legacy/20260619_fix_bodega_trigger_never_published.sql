-- Fix: sync_bodega_draft_from_branch bloqueaba live update cuando una sucursal
-- tenía borrador pendiente pero NUNCA había sido publicada (min_units IS NULL).
-- Ejemplo: Salud 5 (erp_sucursal_id=7) con draft 1/2 y min_units=null hacía que
-- el BOOL_AND devolviera false → bodega siempre quedaba en draft aunque todas las
-- sucursales publicadas ya tuvieran draft_status='none'.
--
-- Regla corregida: solo bloquea live update una sucursal que YA FUE publicada
-- (min_units IS NOT NULL) y ahora tiene un borrador pendiente.
-- Sucursales nunca publicadas (min_units IS NULL) no cuentan como bloqueantes.

CREATE OR REPLACE FUNCTION sync_bodega_draft_from_branch()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  bodega_min    integer;
  bodega_max    integer;
  all_published boolean;
BEGIN
  IF NEW.erp_sucursal_id = 6 THEN RETURN NEW; END IF;

  SELECT
    SUM(COALESCE(
      CASE WHEN psp.draft_status = 'pending' THEN psp.draft_min ELSE psp.min_units END,
    0))::integer,
    SUM(COALESCE(
      CASE WHEN psp.draft_status = 'pending' THEN psp.draft_max ELSE psp.max_units END,
    0))::integer,
    BOOL_AND(
      COALESCE(psp.draft_status, 'none') IS DISTINCT FROM 'pending'
      OR (psp.min_units IS NULL AND psp.max_units IS NULL)
    )
  INTO bodega_min, bodega_max, all_published
  FROM product_stock_params psp
  WHERE psp.erp_sucursal_id != 6
    AND psp.erp_product_id = NEW.erp_product_id;

  IF COALESCE(bodega_min, 0) = 0 AND COALESCE(bodega_max, 0) = 0 THEN
    RETURN NEW;
  END IF;

  IF all_published THEN
    INSERT INTO product_stock_params (
      erp_product_id, erp_sucursal_id,
      min_units, max_units,
      draft_status, draft_min, draft_max,
      draft_calculated_at, updated_at
    ) VALUES (
      NEW.erp_product_id, 6,
      bodega_min, bodega_max,
      'none', NULL, NULL,
      NOW(), NOW()
    )
    ON CONFLICT (erp_product_id, erp_sucursal_id) DO UPDATE SET
      min_units           = EXCLUDED.min_units,
      max_units           = EXCLUDED.max_units,
      draft_status        = 'none',
      draft_min           = NULL,
      draft_max           = NULL,
      draft_calculated_at = EXCLUDED.draft_calculated_at,
      updated_at          = EXCLUDED.updated_at
    WHERE product_stock_params.is_hidden IS NOT TRUE;

  ELSE
    INSERT INTO product_stock_params (
      erp_product_id, erp_sucursal_id,
      draft_min, draft_max, draft_status, draft_calculated_at, updated_at
    ) VALUES (
      NEW.erp_product_id, 6,
      bodega_min, bodega_max, 'pending', NOW(), NOW()
    )
    ON CONFLICT (erp_product_id, erp_sucursal_id) DO UPDATE SET
      draft_min           = EXCLUDED.draft_min,
      draft_max           = EXCLUDED.draft_max,
      draft_status        = 'pending',
      draft_calculated_at = EXCLUDED.draft_calculated_at,
      updated_at          = EXCLUDED.updated_at
    WHERE product_stock_params.is_hidden IS NOT TRUE;
  END IF;

  RETURN NEW;
END;
$$;

-- Promover los 1,317 productos de bodega bloqueados por el mismo bug.
UPDATE product_stock_params bodega
SET
  min_units           = bodega.draft_min,
  max_units           = bodega.draft_max,
  draft_status        = 'none',
  draft_min           = NULL,
  draft_max           = NULL,
  updated_at          = NOW()
WHERE bodega.erp_sucursal_id = 6
  AND bodega.draft_status    = 'pending'
  AND bodega.draft_min       IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM product_stock_params psp
    WHERE psp.erp_sucursal_id != 6
      AND psp.erp_product_id  = bodega.erp_product_id
      AND psp.draft_status    = 'pending'
      AND (psp.min_units IS NOT NULL OR psp.max_units IS NOT NULL)
  );
