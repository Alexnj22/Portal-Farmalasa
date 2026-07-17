SET lock_timeout = '5s';

-- Fase 2.2 + mejora M1 de la auditoría MinMax 2026-07-17 (fusionadas para tocar el
-- trigger una sola vez, según el plan aprobado).
--
-- M1: trg_bodega_draft_sync pasa de FOR EACH ROW a FOR EACH STATEMENT con
-- transition tables. Un "Publicar todo" de ~4,000 productos disparaba ~4,000
-- ejecuciones individuales (cada una con su propio SUM + upsert); ahora es 1 sola
-- ejecución que agrega todos los productos afectados del statement de una vez.
-- Postgres no permite transition tables junto con lista de columnas (UPDATE OF ...)
-- ni en triggers de más de un evento -> se separan INSERT/UPDATE en dos triggers
-- que comparten la misma función, y el filtro de "¿cambió alguna columna relevante?"
-- se hace adentro comparando old_rows vs new_rows (más preciso que UPDATE OF, que
-- dispara si la columna aparece en el SET aunque el valor no cambie).
--
-- M-2: se elimina el early-return "IF Σ=0 THEN RETURN" que dejaba a Bodega con
-- MIN/MAX viejos cuando la última sucursal con stock quedaba en 0 por una edición
-- en vivo. Ahora escribe 0/0 sin excepción.
--
-- Nota: el trigger YA solo suma min_units/max_units PUBLICADOS de las sucursales
-- (nunca drafts pendientes) — igual que la versión row-level que reemplaza. No se
-- amplía ese alcance aquí; el manejo de drafts pendientes en la suma de Bodega
-- sigue siendo responsabilidad exclusiva de publish_stock_params (bloque 2).
--
-- Probado en staging (ewcmerxqjvludtgskuin) con datos sintéticos: creación inicial,
-- agregación multi-producto en un solo statement, el caso Σ=0 crítico de M-2, el
-- filtro de cambio relevante (updated_at no se toca si solo cambia una columna
-- irrelevante), y el guard de is_hidden. Los 6 casos pasaron.
DROP TRIGGER IF EXISTS trg_bodega_draft_sync ON public.product_stock_params;
DROP FUNCTION IF EXISTS public.sync_bodega_draft_from_branch();

CREATE OR REPLACE FUNCTION public.sync_bodega_draft_from_branch_stmt()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_product_ids integer[];
BEGIN
  -- Guard de recursión: el propio INSERT/UPDATE de este trigger sobre Bodega
  -- (erp_sucursal_id=6) dispara de nuevo el evento sobre la misma tabla.
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
      SUM(COALESCE(psp.min_units, 0))::integer AS bodega_min,
      SUM(COALESCE(psp.max_units, 0))::integer AS bodega_max
    FROM product_stock_params psp
    WHERE psp.erp_sucursal_id != 6
      AND psp.erp_product_id = ANY(v_product_ids)
    GROUP BY psp.erp_product_id
  ),
  clamped AS (
    SELECT erp_product_id,
      GREATEST(bodega_min, CASE WHEN bodega_max > 1 THEN 1 ELSE 0 END) AS bodega_min,
      bodega_max
    FROM sums
  )
  INSERT INTO product_stock_params (
    erp_product_id, erp_sucursal_id,
    min_units, max_units,
    draft_status, draft_min, draft_max,
    draft_calculated_at, updated_at
  )
  SELECT erp_product_id, 6, bodega_min, bodega_max, 'none', NULL, NULL, NOW(), NOW()
  FROM clamped
  ON CONFLICT (erp_product_id, erp_sucursal_id) DO UPDATE SET
    min_units           = EXCLUDED.min_units,
    max_units            = EXCLUDED.max_units,
    draft_status        = 'none',
    draft_min           = NULL,
    draft_max           = NULL,
    draft_calculated_at = EXCLUDED.draft_calculated_at,
    updated_at           = EXCLUDED.updated_at
  WHERE product_stock_params.is_hidden IS NOT TRUE;

  RETURN NULL;
END;
$function$;

CREATE TRIGGER trg_bodega_draft_sync_stmt_ins
AFTER INSERT ON public.product_stock_params
REFERENCING NEW TABLE AS new_rows
FOR EACH STATEMENT
EXECUTE FUNCTION public.sync_bodega_draft_from_branch_stmt();

CREATE TRIGGER trg_bodega_draft_sync_stmt_upd
AFTER UPDATE ON public.product_stock_params
REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
FOR EACH STATEMENT
EXECUTE FUNCTION public.sync_bodega_draft_from_branch_stmt();
