SET lock_timeout = '5s';

-- Bug encontrado en vivo por el usuario (producto SIMILAC 2 (PROSENSITIVE)
-- X 800GR, erp_product_id=92): Bodega mostraba "Suc. pendientes" sin que
-- hubiera ningún borrador visible pendiente. Causa: la sucursal La Popular
-- (erp_sucursal_id=5) tenía una fila con draft_status='pending' desde el
-- 2026-06-14 (más de un mes), pero is_hidden=true — invisible en toda la UI
-- y excluida de calculate_stock_params/publish_stock_params (que sí filtran
-- is_hidden), pero el trigger restaurado en 20260717230000 NO excluía
-- is_hidden al calcular all_published/la suma, así que esa fila fantasma
-- seguía contando como "sucursal con pendiente" para siempre. Confirmado en
-- vivo: BOOL_AND(...) daba all_published=false para el producto 92 en el
-- momento de la auditoría, aunque ninguna sucursal VISIBLE tenía nada
-- pendiente — la próxima escritura sobre cualquier sucursal de ese producto
-- iba a tumbar a Bodega a 'pending' de nuevo.
--
-- Encontrados con el mismo patrón (sucursal oculta con draft_status=
-- 'pending' fantasma): erp_product_id 92, 566, 1527, 2808 — al menos 4
-- productos con el mismo riesgo latente.
--
-- Fix: la CTE "sums" ahora excluye is_hidden IS TRUE — una sucursal oculta
-- se trata como si no existiera para el agregado de Bodega, igual que ya
-- hacen calculate_stock_params y publish_stock_params en el resto del
-- pipeline. Si TODAS las sucursales de un producto están ocultas, la CTE no
-- produce fila para ese producto y Bodega simplemente no se toca (se queda
-- en lo que tenía).
--
-- Probado en staging con 2 casos: (1) reproducción exacta del bug — sucursal
-- visible publicada + sucursal oculta con pending fantasma → Bodega queda
-- 'none' correctamente; (2) regresión — sucursal visible con pending real →
-- Bodega sigue marcándose 'pending' correctamente. Re-verificado igual en
-- prod antes de limpiar.
CREATE OR REPLACE FUNCTION public.sync_bodega_draft_from_branch_stmt()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_product_ids integer[];
  v_count integer;
BEGIN
  IF pg_trigger_depth() > 1 THEN
    RETURN NULL;
  END IF;

  IF TG_OP = 'INSERT' THEN
    SELECT array_agg(DISTINCT erp_product_id) INTO v_product_ids
    FROM new_rows WHERE erp_sucursal_id != 6;
  ELSE
    SELECT array_agg(DISTINCT n.erp_product_id) INTO v_product_ids
    FROM new_rows n
    JOIN old_rows o ON o.id = n.id
    WHERE n.erp_sucursal_id != 6
      AND (o.draft_min IS DISTINCT FROM n.draft_min
        OR o.draft_max IS DISTINCT FROM n.draft_max
        OR o.draft_status IS DISTINCT FROM n.draft_status
        OR o.min_units IS DISTINCT FROM n.min_units
        OR o.max_units IS DISTINCT FROM n.max_units
        OR o.is_hidden IS DISTINCT FROM n.is_hidden);
  END IF;

  IF v_product_ids IS NULL OR array_length(v_product_ids, 1) IS NULL THEN
    RETURN NULL;
  END IF;

  WITH sums AS (
    SELECT psp.erp_product_id,
      SUM(COALESCE(CASE WHEN psp.draft_status = 'pending' THEN psp.draft_min ELSE psp.min_units END, 0))::integer AS bodega_min,
      SUM(COALESCE(CASE WHEN psp.draft_status = 'pending' THEN psp.draft_max ELSE psp.max_units END, 0))::integer AS bodega_max,
      BOOL_AND(COALESCE(psp.draft_status, 'none') IS DISTINCT FROM 'pending') AS all_published
    FROM product_stock_params psp
    WHERE psp.erp_sucursal_id != 6
      AND psp.erp_product_id = ANY(v_product_ids)
      AND psp.is_hidden IS NOT TRUE
    GROUP BY psp.erp_product_id
  ),
  clamped AS (
    SELECT erp_product_id,
      GREATEST(bodega_min, CASE WHEN bodega_max > 1 THEN 1 ELSE 0 END) AS bodega_min,
      bodega_max,
      all_published
    FROM sums
  ),
  live_upsert AS (
    INSERT INTO product_stock_params (
      erp_product_id, erp_sucursal_id,
      min_units, max_units,
      draft_status, draft_min, draft_max,
      draft_calculated_at, updated_at
    )
    SELECT erp_product_id, 6, bodega_min, bodega_max, 'none', NULL, NULL, NOW(), NOW()
    FROM clamped WHERE all_published
    ON CONFLICT (erp_product_id, erp_sucursal_id) DO UPDATE SET
      min_units           = EXCLUDED.min_units,
      max_units            = EXCLUDED.max_units,
      draft_status        = 'none',
      draft_min           = NULL,
      draft_max           = NULL,
      draft_calculated_at = EXCLUDED.draft_calculated_at,
      updated_at           = EXCLUDED.updated_at
    WHERE product_stock_params.is_hidden IS NOT TRUE
    RETURNING erp_product_id
  ),
  pending_upsert AS (
    INSERT INTO product_stock_params (
      erp_product_id, erp_sucursal_id,
      draft_min, draft_max, draft_status, draft_calculated_at, updated_at
    )
    SELECT erp_product_id, 6, bodega_min, bodega_max, 'pending', NOW(), NOW()
    FROM clamped WHERE NOT all_published
    ON CONFLICT (erp_product_id, erp_sucursal_id) DO UPDATE SET
      draft_min           = EXCLUDED.draft_min,
      draft_max           = EXCLUDED.draft_max,
      draft_status        = 'pending',
      draft_calculated_at = EXCLUDED.draft_calculated_at,
      updated_at           = EXCLUDED.updated_at
    WHERE product_stock_params.is_hidden IS NOT TRUE
    RETURNING erp_product_id
  )
  SELECT (SELECT count(*) FROM live_upsert) + (SELECT count(*) FROM pending_upsert) INTO v_count;

  RETURN NULL;
END;
$function$;
