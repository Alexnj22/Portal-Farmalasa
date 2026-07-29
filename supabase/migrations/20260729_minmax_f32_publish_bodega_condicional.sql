-- F3.2 — El bloque de Bodega de publish_stock_params reescribia ~3,385 filas
-- por publicacion, cambiaran o no.
--
-- CLAUDE.md lo prohibe explicitamente ("PROHIBIDO el upsert incondicional de
-- tablas completas"), y por buenas razones medidas en este mismo proyecto:
-- `inventory` acumulo 935M de updates sobre 24K filas — churn de WAL, Disk IO
-- budget agotado, CPU de Realtime decodificando WAL y autovacuum constante.
--
-- El ON CONFLICT del bloque de Bodega actualizaba min_units/max_units/draft_*/
-- published_* /updated_at de todos los productos que pasaban el HAVING, sin
-- mirar si el valor cambiaba. Ahora lleva el guard
-- `(cols) IS DISTINCT FROM (EXCLUDED.cols)`.
--
-- Los timestamps NO entran en la comparacion a proposito: published_at,
-- published_by y updated_at cambian siempre (v_now), asi que incluirlos haria
-- que el guard nunca filtrara nada. Se comparan solo las 5 columnas de dato
-- real: min_units, max_units, draft_min, draft_max, draft_status.
--
-- Efecto colateral buscado: `updated_at` de Bodega ya no se bumpea cuando nada
-- cambio, asi que el polling de Bodega (cursor keyset por updated_at) deja de
-- recibir miles de filas identicas despues de cada publicacion.
--
-- `bodega_updated` en la respuesta ahora cuenta filas REALMENTE modificadas.
-- Es un numero mas chico que antes y mas honesto.
--
-- NOTA sobre el trigger: sync_bodega_draft_from_branch_stmt tambien escribe
-- Bodega sin guard, pero ahi el desperdicio es chico — solo recalcula los
-- productos cuyas columnas relevantes cambiaron (su propio WHERE con
-- IS DISTINCT FROM sobre new_rows/old_rows), asi que casi siempre el valor de
-- Bodega si se movio. Queda anotado, fuera del alcance de F3.2.

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.publish_stock_params(p_erp_sucursal_id integer DEFAULT NULL::integer, p_erp_product_ids integer[] DEFAULT NULL::integer[], p_published_by text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_count        INTEGER;
  v_bodega_count INTEGER := 0;
  v_now          TIMESTAMPTZ := NOW();
  v_publisher    TEXT := (SELECT auth.email());
BEGIN
  IF NOT auth_can_edit_any(ARRAY['minmax']) THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: se requiere permiso de edición en Min/Max';
  END IF;

  WITH par_ordenado AS (
    SELECT
      psp.id,
      LEAST(COALESCE(psp.draft_min, 0), COALESCE(psp.draft_max, 0))    AS lo,
      GREATEST(COALESCE(psp.draft_min, 0), COALESCE(psp.draft_max, 0)) AS hi
    FROM product_stock_params psp
    WHERE psp.draft_status     = 'pending'
      AND psp.erp_sucursal_id != 6
      AND (p_erp_sucursal_id IS NULL OR psp.erp_sucursal_id = p_erp_sucursal_id)
      AND (p_erp_product_ids IS NULL OR psp.erp_product_id  = ANY(p_erp_product_ids))
  ),
  con_min AS (
    SELECT id, hi, GREATEST(lo, CASE WHEN hi > 1 THEN 1 ELSE 0 END) AS n_min
    FROM par_ordenado
  ),
  par AS (
    SELECT id, n_min,
           CASE WHEN n_min >= 1 THEN GREATEST(hi, n_min + 1) ELSE hi END AS n_max
    FROM con_min
  ),
  published AS (
    UPDATE product_stock_params psp
    SET
      abc_class                = psp.draft_abc_class,
      daily_velocity           = psp.draft_velocity,
      velocity_30d             = psp.draft_velocity_30d,
      cv                       = psp.draft_cv,
      demand_variability       = psp.draft_demand_variability,
      min_units                = par.n_min,
      max_units                = par.n_max,
      units_sold_6m            = psp.draft_units_sold,
      revenue_6m               = psp.draft_revenue,
      data_days                = psp.draft_data_days,
      calculated_at            = psp.draft_calculated_at,
      draft_min                = NULL,
      draft_max                = NULL,
      draft_abc_class          = NULL,
      draft_demand_variability = NULL,
      draft_cv                 = NULL,
      draft_velocity           = NULL,
      draft_velocity_30d       = NULL,
      draft_units_sold         = NULL,
      draft_revenue            = NULL,
      draft_data_days          = NULL,
      draft_calculated_at      = NULL,
      draft_status             = 'none',
      published_at             = v_now,
      published_by             = v_publisher,
      updated_at               = v_now
    FROM par
    WHERE par.id = psp.id
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_count FROM published;

  IF p_erp_sucursal_id IS DISTINCT FROM 6 THEN
    WITH branch_sums AS (
      SELECT
        s.erp_product_id,
        SUM(COALESCE(CASE WHEN s.draft_status = 'pending' THEN s.draft_min ELSE s.min_units END, 0))::integer AS eff_min,
        SUM(COALESCE(CASE WHEN s.draft_status = 'pending' THEN s.draft_max ELSE s.max_units END, 0))::integer AS eff_max,
        SUM(COALESCE(s.min_units, 0))::integer AS pub_min,
        SUM(COALESCE(s.max_units, 0))::integer AS pub_max
      FROM product_stock_params s
      WHERE s.erp_sucursal_id != 6
        AND s.is_hidden IS NOT TRUE
        AND (p_erp_product_ids IS NULL OR s.erp_product_id = ANY(p_erp_product_ids))
      GROUP BY s.erp_product_id
      HAVING
        SUM(COALESCE(s.min_units, 0)) > 0
        OR SUM(COALESCE(s.max_units, 0)) > 0
        OR EXISTS (
          SELECT 1 FROM product_stock_params b
          WHERE b.erp_sucursal_id = 6
            AND b.erp_product_id  = s.erp_product_id
            AND b.draft_status    = 'pending'
        )
    ),
    bodega_min AS (
      SELECT
        erp_product_id, eff_min, eff_max, pub_min, pub_max,
        GREATEST(pub_min, CASE WHEN pub_max > 1 THEN 1 ELSE 0 END) AS n_min
      FROM branch_sums
    ),
    bodega AS (
      SELECT
        erp_product_id, eff_min, eff_max, pub_min, pub_max, n_min,
        GREATEST(pub_max, CASE WHEN n_min >= 1 THEN n_min + 1 ELSE 0 END) AS n_max
      FROM bodega_min
    )
    INSERT INTO product_stock_params AS psp (
      erp_product_id, erp_sucursal_id,
      min_units, max_units,
      draft_min, draft_max, draft_status,
      published_at, published_by, updated_at
    )
    SELECT
      erp_product_id, 6,
      n_min,
      n_max,
      CASE WHEN eff_min != pub_min OR eff_max != pub_max THEN eff_min ELSE NULL END,
      CASE WHEN eff_min != pub_min OR eff_max != pub_max THEN eff_max ELSE NULL END,
      CASE WHEN eff_min != pub_min OR eff_max != pub_max THEN 'pending' ELSE 'none' END,
      v_now, v_publisher, v_now
    FROM bodega
    ON CONFLICT (erp_product_id, erp_sucursal_id) DO UPDATE SET
      min_units    = EXCLUDED.min_units,
      max_units    = EXCLUDED.max_units,
      draft_min    = EXCLUDED.draft_min,
      draft_max    = EXCLUDED.draft_max,
      draft_status = EXCLUDED.draft_status,
      published_at = EXCLUDED.published_at,
      published_by = EXCLUDED.published_by,
      updated_at   = EXCLUDED.updated_at
    WHERE psp.is_hidden IS NOT TRUE
      -- F3.2: sin esto se reescribian ~3,385 filas por publicacion, cambiaran o
      -- no. Solo columnas de dato: los 3 timestamps cambian siempre.
      AND (psp.min_units, psp.max_units, psp.draft_min, psp.draft_max, psp.draft_status)
       IS DISTINCT FROM
          (EXCLUDED.min_units, EXCLUDED.max_units, EXCLUDED.draft_min, EXCLUDED.draft_max, EXCLUDED.draft_status);

    GET DIAGNOSTICS v_bodega_count = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object(
    'ok',             true,
    'published',      v_count,
    'bodega_updated', v_bodega_count,
    'at',             v_now
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.publish_stock_params(integer, integer[], text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.publish_stock_params(integer, integer[], text) TO authenticated, service_role;
