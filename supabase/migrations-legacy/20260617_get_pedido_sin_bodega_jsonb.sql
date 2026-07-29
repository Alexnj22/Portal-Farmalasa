-- get_pedido_sin_bodega v2: RETURNS jsonb en lugar de SETOF TABLE
-- Motivo: PostgREST capea max-rows=1000 en funciones que devuelven TABLE/SETOF
-- incluso cuando el cliente envía Range header. Al devolver un valor JSONB escalar
-- PostgREST lo trata como una sola fila (sin paginación) y retorna todos los productos.

DROP FUNCTION IF EXISTS get_pedido_sin_bodega(integer[], integer, integer);

CREATE OR REPLACE FUNCTION get_pedido_sin_bodega(
  p_sucursal_ids integer[] DEFAULT ARRAY[1,2,3,4,5,7]
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
AS $function$
WITH
suc_map    AS (SELECT erp_sucursal_id, branch_id FROM erp_sucursal_map WHERE NOT es_bodega),
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
    GREATEST(0, em.max_qty - FLOOR(
      COALESCE(SUM(inv.unidades) FILTER (WHERE inv.is_vencidos = false), 0)::numeric
      / NULLIF(COALESCE(pp.factor, 1)::numeric, 0)
    ))::integer AS reponer
  FROM erp_minmax em
  JOIN presentaciones pr ON pr.id = em.erp_presentacion_id
  LEFT JOIN product_precios pp ON pp.product_id = em.erp_product_id AND pp.id_presentacion = em.erp_presentacion_id
  LEFT JOIN inv_dedup inv ON inv.erp_sucursal_id = em.erp_sucursal_id AND inv.erp_product_id = em.erp_product_id
  WHERE em.erp_sucursal_id = ANY(p_sucursal_ids) AND em.max_qty > 0
  GROUP BY em.erp_sucursal_id, em.erp_product_id, em.erp_presentacion_id, em.min_qty, em.max_qty, pp.factor
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

sin_bodega AS (
  SELECT DISTINCT n.erp_product_id
  FROM necesidades_pos n
  WHERE NOT EXISTS (
    SELECT 1 FROM bodega_net bn
    WHERE bn.erp_product_id = n.erp_product_id AND bn.net_units > 0
  )
),

ventas AS (
  SELECT sm.erp_sucursal_id, s.erp_product_id, SUM(s.cantidad)::numeric AS ventas_6m
  FROM product_sales_monthly_agg s
  JOIN suc_map sm ON sm.branch_id = s.branch_id
  WHERE sm.erp_sucursal_id = ANY(p_sucursal_ids)
    AND s.year_month >= to_char(NOW() - INTERVAL '6 months', 'YYYY-MM')
  GROUP BY sm.erp_sucursal_id, s.erp_product_id
),

agrupado AS (
  SELECT
    n.erp_product_id,
    SUM(n.reponer)::integer AS total_necesidad,
    COALESCE(SUM(v.ventas_6m), 0) AS total_ventas_6m,
    jsonb_agg(
      jsonb_build_object('erp_sucursal_id', n.erp_sucursal_id, 'reponer', n.reponer)
      ORDER BY n.reponer DESC
    ) AS sucursales
  FROM necesidades_pos n
  JOIN sin_bodega sb ON sb.erp_product_id = n.erp_product_id
  LEFT JOIN ventas v ON v.erp_sucursal_id = n.erp_sucursal_id AND v.erp_product_id = n.erp_product_id
  GROUP BY n.erp_product_id
)

SELECT COALESCE(
  jsonb_agg(
    jsonb_build_object(
      'erp_product_id',    a.erp_product_id,
      'product_name',      p.nombre::text,
      'laboratorio',       lab.nombre::text,
      'sucursales',        a.sucursales,
      'total_necesidad',   a.total_necesidad,
      'total_ventas_6m',   a.total_ventas_6m,
      'prioridad_score',   ROUND((a.total_necesidad::numeric * (1 + a.total_ventas_6m / NULLIF(a.total_necesidad, 0))), 2)
    )
    ORDER BY ROUND((a.total_necesidad::numeric * (1 + a.total_ventas_6m / NULLIF(a.total_necesidad, 0))), 2) DESC NULLS LAST
  ),
  '[]'::jsonb
)
FROM agrupado a
JOIN products p ON p.id = a.erp_product_id
LEFT JOIN laboratorios lab ON lab.id = p.laboratorio_id;
$function$;

GRANT EXECUTE ON FUNCTION get_pedido_sin_bodega(integer[]) TO authenticated;
