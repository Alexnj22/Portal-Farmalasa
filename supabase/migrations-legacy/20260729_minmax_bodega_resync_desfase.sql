-- F2.8 (cierre) — Bodega estaba desfasada de la Σ de sucursales. HALLAZGO NUEVO.
--
-- No estaba en el plan. Salio al verificar el backfill de F2.4: al comparar la
-- salida de get_stock_analysis antes/despues, 7 filas de Bodega cambiaban su
-- MIN/MAX. La causa no era el backfill — era el trigger de Bodega
-- resincronizando sumas que YA estaban viejas. Medido directo contra la
-- definicion (Bodega = Σ sucursales no ocultas): 20 de 3,515 productos de
-- Bodega tenian guardado algo distinto de su suma. El backfill arreglo 7 de
-- rebote; quedan 13.
--
-- Los 13, en dos grupos:
--
--   A) 4 con min_units/max_units en NULL y suma esperada > 0 (PRUEBA DE
--      EMBARAZO 20/33, ELECTROLIT 6/17, DOLO ESPASMON 8/13, TOBILLERA 0/1).
--      El `pending_upsert` del trigger inserta la fila de Bodega escribiendo
--      SOLO draft_min/draft_max — si la fila no existia, nace con min_units en
--      NULL, y solo se completa cuando el trigger vuelve a correr para ese
--      producto con todas las sucursales publicadas. Si eso no pasa, Bodega
--      muestra 0 para siempre y no pide nada. Se tapa abajo.
--
--   B) 9 con valores viejos (AGUA OXIGENADA 16/26 → 0/0, ACIDO FOLICO 24 → 0,
--      RADOL 15/24 → 12/19, ACIMED 5/9 → 6/9, y cinco 0/1 → 0/0).
--      Estas vienen de que habia DOS escritores de la Σ que no coincidian: el
--      trigger (efectivo, excluye ocultos) y el bloque de Bodega de
--      publish_stock_params (publicado, NO excluia ocultos — eso es lo que
--      arregla F2.8), mas el `pg_trigger_depth() > 1` del trigger, que salta la
--      sincronizacion cuando la escritura de la sucursal viene anidada dentro
--      de otro trigger.
--
-- OJO, ESTO MUEVE DATO DE NEGOCIO: 13 productos de Bodega cambian su MIN/MAX.
-- Cuatro empiezan a pedir (hoy no piden porque estan en NULL) y varios bajan a
-- 0/0 (dejan de pedir) porque ninguna sucursal los tiene con MIN/MAX. Es la
-- definicion del modulo: Bodega = Σ sucursales, y lo que se quiera tener en
-- Bodega POR ENCIMA de la suma va en manual_min/manual_max (el delta), que en
-- estas 13 filas esta en NULL. Cualquier edicion futura sobre esos productos
-- habria aplicado esta misma correccion sola, via el trigger.

SET lock_timeout = '5s';

-- ── 1. El agujero: una fila de Bodega recien creada por el camino de borrador
--       nacia sin min_units/max_units. Ahora el INSERT los pone (en el
--       ON CONFLICT no se tocan: completar la fila viva es tarea del
--       live_upsert, no de este). ───────────────────────────────────────────

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
      -- Σ de lo PUBLICADO, para poder nacer con la fila viva completa.
      SUM(COALESCE(psp.min_units, 0))::integer AS pub_min,
      SUM(COALESCE(psp.max_units, 0))::integer AS pub_max,
      BOOL_AND(COALESCE(psp.draft_status, 'none') IS DISTINCT FROM 'pending') AS all_published
    FROM product_stock_params psp
    WHERE psp.erp_sucursal_id != 6
      AND psp.erp_product_id = ANY(v_product_ids)
      AND psp.is_hidden IS NOT TRUE
    GROUP BY psp.erp_product_id
  ),
  clamped_min AS (
    SELECT erp_product_id,
      GREATEST(bodega_min, CASE WHEN bodega_max > 1 THEN 1 ELSE 0 END) AS bodega_min,
      bodega_max,
      GREATEST(pub_min, CASE WHEN pub_max > 1 THEN 1 ELSE 0 END) AS pub_min,
      pub_max,
      all_published
    FROM sums
  ),
  clamped AS (
    -- Con MIN >= 1 el invariante exige MAX > MIN (chk_min_lt_max / psp_draft_pair_valid).
    -- Con MIN = 0, el clamp de arriba garantiza MAX <= 1, que ya es valido.
    SELECT erp_product_id,
      bodega_min,
      GREATEST(bodega_max, CASE WHEN bodega_min >= 1 THEN bodega_min + 1 ELSE 0 END) AS bodega_max,
      pub_min,
      GREATEST(pub_max, CASE WHEN pub_min >= 1 THEN pub_min + 1 ELSE 0 END) AS pub_max,
      all_published
    FROM clamped_min
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
      min_units, max_units,
      draft_min, draft_max, draft_status, draft_calculated_at, updated_at
    )
    -- min_units/max_units van SOLO en el INSERT (la Σ publicada): si la fila no
    -- existia, nacia con la columna viva en NULL y Bodega mostraba 0 hasta que
    -- algo la volviera a tocar. En el ON CONFLICT no se tocan.
    SELECT erp_product_id, 6, pub_min, pub_max, bodega_min, bodega_max, 'pending', NOW(), NOW()
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


-- ── 2. Resync de las filas ya desfasadas ─────────────────────────────────────

WITH sums AS (
  SELECT psp.erp_product_id,
    SUM(COALESCE(CASE WHEN psp.draft_status = 'pending' THEN psp.draft_min ELSE psp.min_units END, 0))::integer AS s_min,
    SUM(COALESCE(CASE WHEN psp.draft_status = 'pending' THEN psp.draft_max ELSE psp.max_units END, 0))::integer AS s_max
  FROM public.product_stock_params psp
  WHERE psp.erp_sucursal_id != 6 AND psp.is_hidden IS NOT TRUE
  GROUP BY psp.erp_product_id
),
esperado AS (
  SELECT erp_product_id, c_min,
         GREATEST(s_max, CASE WHEN c_min >= 1 THEN c_min + 1 ELSE 0 END) AS c_max
  FROM (SELECT erp_product_id,
               GREATEST(s_min, CASE WHEN s_max > 1 THEN 1 ELSE 0 END) AS c_min,
               s_max
        FROM sums) z
)
UPDATE public.product_stock_params b
SET min_units  = e.c_min,
    max_units  = e.c_max,
    updated_at = NOW()
FROM esperado e
WHERE b.erp_sucursal_id = 6
  AND b.erp_product_id  = e.erp_product_id
  AND b.is_hidden IS NOT TRUE
  AND (COALESCE(b.min_units, 0), COALESCE(b.max_units, 0)) IS DISTINCT FROM (e.c_min, e.c_max);
