-- get_pedido_sucursal_stats v3: agrega avg_urgencia_pct
-- avg_urgencia_pct = ROUND(AVG(reponer/effective_max*100)) por sucursal
-- Permite urgencia absoluta (≥65% urgente, ≥40% moderada) en lugar de ranking relativo.

DROP FUNCTION IF EXISTS public.get_pedido_sucursal_stats(integer[], boolean);
DROP FUNCTION IF EXISTS public.get_pedido_sucursal_stats(integer[]);

CREATE FUNCTION public.get_pedido_sucursal_stats(
  p_sucursal_ids      integer[] DEFAULT ARRAY[1,2,3,4,5,7],
  p_use_portal_minmax boolean   DEFAULT false
)
RETURNS TABLE(
  erp_sucursal_id      integer,
  total_productos      integer,
  necesidad_packs      integer,
  con_bodega_packs     integer,
  sin_bodega_packs     integer,
  con_bodega_productos integer,
  sin_bodega_productos integer,
  avg_urgencia_pct     integer
)
LANGUAGE sql
SECURITY DEFINER
AS $function$
WITH
bodega_suc AS (SELECT erp_sucursal_id FROM erp_sucursal_map WHERE es_bodega LIMIT 1),

inv_dedup AS (
  SELECT DISTINCT ON (
    erp_sucursal_id, erp_product_id, lote, fecha_vencimiento, is_vencidos,
    TRIM(LOWER(COALESCE(presentacion,''))), LOWER(COALESCE(detalle,''))
  )
    erp_sucursal_id, erp_product_id, lote, fecha_vencimiento, is_vencidos,
    cantidad, detalle,
    cantidad::numeric
      * COALESCE(NULLIF(split_part(LOWER(COALESCE(detalle,'')), 'x', 2), '')::numeric, 1)
      AS unidades
  FROM inventory
  ORDER BY
    erp_sucursal_id, erp_product_id, lote, fecha_vencimiento, is_vencidos,
    TRIM(LOWER(COALESCE(presentacion,''))), LOWER(COALESCE(detalle,''))
),

pending_committed AS (
  SELECT pi.erp_product_id,
    SUM(pi.cantidad_asignada::numeric * COALESCE(pp.factor, 1)) AS committed_units
  FROM pedido_items pi
  JOIN pedidos pd ON pd.id = pi.pedido_id
  LEFT JOIN product_precios pp
    ON pp.product_id = pi.erp_product_id AND pp.id_presentacion = pi.erp_presentacion_id
  WHERE pi.status = 'pendiente'
    AND pd.status NOT IN ('anulado', 'completado')
  GROUP BY pi.erp_product_id
),

necesidades AS (
  SELECT
    em.erp_sucursal_id, em.erp_product_id, em.erp_presentacion_id,
    CASE
      WHEN p_use_portal_minmax THEN
        ROUND(COALESCE(psp.manual_max, psp.max_units, 0)::numeric
              / NULLIF(COALESCE(pp.factor, 1)::numeric, 0))::integer
      ELSE em.max_qty
    END AS effective_max,
    GREATEST(0,
      CASE
        WHEN p_use_portal_minmax THEN
          ROUND(COALESCE(psp.manual_max, psp.max_units, 0)::numeric
                / NULLIF(COALESCE(pp.factor, 1)::numeric, 0))::integer
        ELSE em.max_qty
      END
      - FLOOR(
          COALESCE(SUM(inv.unidades) FILTER (WHERE inv.is_vencidos = false), 0)::numeric
          / NULLIF(COALESCE(pp.factor, 1)::numeric, 0)
        )
    )::integer AS reponer
  FROM erp_minmax em
  JOIN presentaciones pr ON pr.id = em.erp_presentacion_id
  LEFT JOIN product_precios pp
         ON pp.product_id = em.erp_product_id AND pp.id_presentacion = em.erp_presentacion_id
  LEFT JOIN product_stock_params psp
         ON psp.erp_product_id = em.erp_product_id AND psp.erp_sucursal_id = em.erp_sucursal_id
  LEFT JOIN inv_dedup inv
         ON inv.erp_sucursal_id = em.erp_sucursal_id AND inv.erp_product_id = em.erp_product_id
  WHERE em.erp_sucursal_id = ANY(p_sucursal_ids)
    AND CASE
          WHEN p_use_portal_minmax THEN COALESCE(psp.manual_max, psp.max_units, 0) > 0
          ELSE em.max_qty > 0
        END
  GROUP BY em.erp_sucursal_id, em.erp_product_id, em.erp_presentacion_id,
           em.min_qty, em.max_qty, pp.factor,
           psp.min_units, psp.max_units, psp.manual_min, psp.manual_max
),
necesidades_pos AS (SELECT * FROM necesidades WHERE reponer > 0),

bodega_net AS (
  SELECT inv.erp_product_id,
    SUM(inv.unidades) - COALESCE(MAX(pc.committed_units), 0) AS net_units
  FROM inv_dedup inv
  LEFT JOIN pending_committed pc ON pc.erp_product_id = inv.erp_product_id
  WHERE inv.erp_sucursal_id = (SELECT erp_sucursal_id FROM bodega_suc)
    AND inv.is_vencidos = false AND inv.unidades > 0
  GROUP BY inv.erp_product_id
),
bodega_disponible AS (
  SELECT erp_product_id FROM bodega_net WHERE net_units > 0
),

con_bodega AS (
  SELECT n.erp_sucursal_id, n.erp_product_id, n.effective_max, n.reponer, true AS tiene_bodega
  FROM necesidades_pos n
  WHERE EXISTS (SELECT 1 FROM bodega_disponible b WHERE b.erp_product_id = n.erp_product_id)
),
sin_bodega AS (
  SELECT n.erp_sucursal_id, n.erp_product_id, n.effective_max, n.reponer, false AS tiene_bodega
  FROM necesidades_pos n
  WHERE NOT EXISTS (SELECT 1 FROM bodega_disponible b WHERE b.erp_product_id = n.erp_product_id)
),
all_rows AS (
  SELECT * FROM con_bodega UNION ALL SELECT * FROM sin_bodega
)

SELECT
  erp_sucursal_id,
  COUNT(DISTINCT erp_product_id)::integer                                              AS total_productos,
  SUM(reponer)::integer                                                                AS necesidad_packs,
  COALESCE(SUM(reponer)          FILTER (WHERE tiene_bodega),      0)::integer        AS con_bodega_packs,
  COALESCE(SUM(reponer)          FILTER (WHERE NOT tiene_bodega),  0)::integer        AS sin_bodega_packs,
  COUNT(DISTINCT erp_product_id) FILTER (WHERE tiene_bodega)::integer                 AS con_bodega_productos,
  COUNT(DISTINCT erp_product_id) FILTER (WHERE NOT tiene_bodega)::integer             AS sin_bodega_productos,
  ROUND(AVG(
    LEAST(100.0, reponer::numeric / NULLIF(effective_max, 0) * 100)
  ))::integer                                                                          AS avg_urgencia_pct
FROM all_rows
GROUP BY erp_sucursal_id;
$function$;

GRANT EXECUTE ON FUNCTION public.get_pedido_sucursal_stats(integer[], boolean) TO authenticated, service_role;
