SET lock_timeout = '5s';

-- Decisión del usuario tras el /code-review de cierre de la auditoría MinMax
-- 2026-07-17: restaurar el soporte de "sucursal con borrador pendiente →
-- Bodega en draft_status='pending'" en el trigger. Esta lógica existía en
-- versiones anteriores del trigger (20260606_bodega_draft_trigger.sql,
-- 20260619_fix_bodega_trigger_never_published.sql,
-- 20260619_fix_bodega_draft_sync_live_propagation.sql) pero se perdió en
-- algún punto entre esas migraciones y el 2026-07-17 (probablemente en
-- 20260619_fix_min_zero_max_gt1_clamp_and_constraint.sql, un archivo-stub
-- sin el SQL real aplicado — el mismo patrón de gap de documentación que
-- advierte el CLAUDE.md del proyecto). No fue mi reescritura a
-- statement-level (Fase 2, 20260717160000) la que la eliminó — esa
-- migración fue fiel al comportamiento que YA estaba vivo en prod, que ya
-- no tenía esta rama desde hace un mes.
--
-- Comportamiento restaurado:
--   Todas las sucursales publicadas (draft_status != 'pending') →
--     Bodega vive: min_units/max_units = Σ del mejor valor, draft_status='none'
--   Alguna sucursal con draft pendiente →
--     Bodega borrador: draft_min/draft_max = Σ del mejor valor,
--     draft_status='pending' — min_units/max_units NO se tocan (quedan en
--     el último valor vivo hasta que se resuelva el pendiente). Esto es lo
--     que hace aparecer el badge "SUC. PEND." en la UI.
-- "Mejor valor" = draft_min/draft_max si esa sucursal está pending, si no
-- min_units/max_units publicados — igual que antes de que se perdiera.
--
-- Se mantienen las mejoras de esta sesión: statement-level (M1), el fix de
-- Σ=0 (M-2, ya no hay early-return en ninguna rama), el filtro preciso de
-- "¿cambió algo relevante?" vía old_rows/new_rows, y el guard de recursión.
--
-- Probado en staging (ewcmerxqjvludtgskuin) con 6 casos: sucursal publicada
-- (vivo), segunda sucursal con draft pendiente (transición a pending con Σ
-- del mejor valor, min/max vivos congelados), esa sucursal se publica
-- (transición de vuelta a vivo), Σ=0 con ambas publicadas, batch
-- multi-producto con estados mixtos, y el guard de is_hidden. Todos
-- pasaron. Re-verificado igual en prod antes de limpiar.
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
        OR o.max_units IS DISTINCT FROM n.max_units);
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
