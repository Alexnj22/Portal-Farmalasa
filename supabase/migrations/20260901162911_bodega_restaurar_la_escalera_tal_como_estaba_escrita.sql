-- Corrige el comentario de la migracion anterior, que decia una cosa que no era.
--
-- `bodega_deja_de_pisar_el_ajuste_a_mano_y_lo_propone` afirma «el resto del
-- cuerpo es identico al vivo». No lo era: al transcribirla reescribi la escalera
-- del MAX publicado
--
--     GREATEST(pub_max, CASE WHEN pub_min >= 1 THEN pub_min + 1 ELSE 0 END)
--
-- como
--
--     CASE WHEN pub_min >= 1 THEN GREATEST(pub_max, pub_min + 1) ELSE pub_max END
--
-- Las dos dan el MISMO resultado —comprobado sobre (0,0) (0,1) (0,5) (1,0)
-- (1,1) (1,2) (3,3) (3,9), y `pub_max` nunca es negativo porque es una SUMA de
-- `COALESCE(...,0)`— asi que no hubo ningun cambio de comportamiento en las
-- horas que estuvo aplicada.
--
-- Se restaura igual, por una razon que no es estetica: la gemela `bodega_min`
-- y la escalera de `publish_stock_params` conservan la forma original, y el
-- comentario de esa funcion dice «la escalera, IDENTICA para los dos pares».
-- Dos escrituras distintas de la misma regla se leen como si fueran dos reglas,
-- y el dia que alguien tenga que cambiarlas juntas va a cambiar una sola.
--
-- Lo unico que cambia respecto de la migracion anterior es esa linea.

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.sync_bodega_draft_from_branch_stmt()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
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
    SELECT erp_product_id,
      bodega_min,
      GREATEST(bodega_max, CASE WHEN bodega_min >= 1 THEN bodega_min + 1 ELSE 0 END) AS bodega_max,
      pub_min,
      GREATEST(pub_max, CASE WHEN pub_min >= 1 THEN pub_min + 1 ELSE 0 END) AS pub_max,
      all_published
    FROM clamped_min
  ),
  -- ¿La fila de Bodega la toco una persona? Si nadie la toco, `manual_at` es
  -- NULL; si la fila todavia no existe, el LEFT JOIN da NULL y
  -- `NULL IS NOT NULL` es false — o sea que una Bodega nueva entra por la rama
  -- de siempre y nada cambia para ella.
  con_marca AS (
    SELECT c.*, (b.manual_at IS NOT NULL) AS bodega_ajustada
    FROM clamped c
    LEFT JOIN product_stock_params b
           ON b.erp_product_id  = c.erp_product_id
          AND b.erp_sucursal_id = 6
  ),
  live_upsert AS (
    INSERT INTO product_stock_params (
      erp_product_id, erp_sucursal_id,
      min_units, max_units,
      draft_status, draft_min, draft_max,
      draft_calculated_at, updated_at
    )
    SELECT erp_product_id, 6, bodega_min, bodega_max, 'none', NULL, NULL, NOW(), NOW()
    FROM con_marca WHERE all_published AND NOT bodega_ajustada
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
    SELECT erp_product_id, 6, pub_min, pub_max, bodega_min, bodega_max, 'pending', NOW(), NOW()
    FROM con_marca WHERE NOT all_published OR bodega_ajustada
    ON CONFLICT (erp_product_id, erp_sucursal_id) DO UPDATE SET
      -- Una propuesta IGUAL al par vigente no es una decision pendiente: se
      -- limpia. Sin esto, una fila ajustada a mano cuyo numero ya coincide con
      -- la suma quedaria marcada en conflicto para siempre.
      draft_min           = CASE WHEN product_stock_params.min_units IS DISTINCT FROM EXCLUDED.draft_min
                                   OR product_stock_params.max_units IS DISTINCT FROM EXCLUDED.draft_max
                                 THEN EXCLUDED.draft_min ELSE NULL END,
      draft_max           = CASE WHEN product_stock_params.min_units IS DISTINCT FROM EXCLUDED.draft_min
                                   OR product_stock_params.max_units IS DISTINCT FROM EXCLUDED.draft_max
                                 THEN EXCLUDED.draft_max ELSE NULL END,
      draft_status        = CASE WHEN product_stock_params.min_units IS DISTINCT FROM EXCLUDED.draft_min
                                   OR product_stock_params.max_units IS DISTINCT FROM EXCLUDED.draft_max
                                 THEN 'pending' ELSE 'none' END,
      draft_calculated_at = EXCLUDED.draft_calculated_at,
      updated_at           = EXCLUDED.updated_at
    WHERE product_stock_params.is_hidden IS NOT TRUE
    RETURNING erp_product_id
  )
  SELECT (SELECT count(*) FROM live_upsert) + (SELECT count(*) FROM pending_upsert) INTO v_count;

  RETURN NULL;
END;
$function$;
