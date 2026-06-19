-- Fix: trg_bodega_draft_sync siempre escribía draft_status='pending' en bodega,
-- incluso cuando la sucursal editada era un save live (draft_status='none') y
-- todas las demás sucursales ya estaban publicadas.
-- Resultado: el usuario editaba sucursales publicadas pero bodega quedaba siempre
-- en borrador, requiriendo un paso de publicación manual innecesario.
--
-- Nuevo comportamiento:
--   ALL sucursales publicadas (draft_status != 'pending') →
--       bodega actualiza min_units/max_units directamente, draft_status='none'
--   Cualquier sucursal con draft pendiente →
--       bodega actualiza draft_min/draft_max, draft_status='pending' (igual que antes)

CREATE OR REPLACE FUNCTION sync_bodega_draft_from_branch()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  bodega_min    integer;
  bodega_max    integer;
  all_published boolean;
BEGIN
  -- Solo actuar sobre sucursales (no sobre filas de bodega misma)
  IF NEW.erp_sucursal_id = 6 THEN RETURN NEW; END IF;

  -- Sumar best-available de todas las sucursales no-bodega para este producto
  SELECT
    SUM(COALESCE(
      CASE WHEN psp.draft_status = 'pending' THEN psp.draft_min ELSE psp.min_units END,
    0))::integer,
    SUM(COALESCE(
      CASE WHEN psp.draft_status = 'pending' THEN psp.draft_max ELSE psp.max_units END,
    0))::integer,
    -- true solo si NINGUNA sucursal tiene draft pendiente
    BOOL_AND(COALESCE(psp.draft_status, 'none') IS DISTINCT FROM 'pending')
  INTO bodega_min, bodega_max, all_published
  FROM product_stock_params psp
  WHERE psp.erp_sucursal_id != 6
    AND psp.erp_product_id = NEW.erp_product_id;

  -- Nada que hacer si la suma queda en 0
  IF COALESCE(bodega_min, 0) = 0 AND COALESCE(bodega_max, 0) = 0 THEN
    RETURN NEW;
  END IF;

  IF all_published THEN
    -- Todas las sucursales publicadas: actualizar bodega en modo live
    -- (min_units/max_units + draft_status='none', limpia draft residual)
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
    -- Alguna sucursal tiene draft pendiente: bodega va a borrador (comportamiento previo)
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
