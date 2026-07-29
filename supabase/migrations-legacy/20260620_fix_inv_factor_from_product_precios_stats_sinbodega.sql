-- get_pedido_sucursal_stats + get_pedido_sin_bodega: usa v_product_factor para factor real.
-- inv_dedup ahora hace LEFT JOIN a v_product_factor por (product_id, presentacion);
-- fallback al split('x') del detalle si no hay match en catálogo.

CREATE OR REPLACE FUNCTION public.get_pedido_sucursal_stats(
  p_sucursal_ids integer[] DEFAULT ARRAY[1, 2, 3, 4, 5, 7]
)
RETURNS TABLE(
  erp_sucursal_id       integer,
  total_productos       integer,
  necesidad_packs       integer,
  con_bodega_packs      integer,
  sin_bodega_packs      integer,
  con_bodega_productos  integer,
  sin_bodega_productos  integer,
  avg_urgencia_pct      integer,
  last_pedido_at        timestamp with time zone
)
LANGUAGE sql
SECURITY DEFINER
SET statement_timeout = '60s'
AS $function$
WITH
bodega_suc AS (SELECT erp_sucursal_id FROM erp_sucursal_map WHERE es_bodega LIMIT 1),

inv_dedup AS (
  SELECT DISTINCT ON (
    i.erp_sucursal_id, i.erp_product_id, i.lote, i.fecha_vencimiento, i.is_vencidos,
    TRIM(LOWER(COALESCE(i.presentacion,''))), LOWER(COALESCE(i.detalle,''))
  )
    i.erp_sucursal_id, i.erp_product_id, i.lote, i.fecha_vencimiento, i.is_vencidos,
    i.cantidad, i.detalle,
    i.cantidad::numeric * COALESCE(
      vf.factor,
      NULLIF(split_part(LOWER(COALESCE(i.detalle,'')), 'x', 2), '')::numeric,
      1
    ) AS unidades
  FROM inventory i
  LEFT JOIN v_product_factor vf
         ON vf.product_id = i.erp_product_id
        AND vf.pres_key   = UPPER(TRIM(i.presentacion))
  ORDER BY
    i.erp_sucursal_id, i.erp_product_id, i.lote, i.fecha_vencimiento, i.is_vencidos,
    TRIM(LOWER(COALESCE(i.presentacion,''))), LOWER(COALESCE(i.detalle,''))
),

inv_agg AS (
  SELECT erp_sucursal_id, erp_product_id,
    COALESCE(SUM(unidades) FILTER (WHERE is_vencidos = false), 0)::numeric AS units_vivos
  FROM inv_dedup
  GROUP BY erp_sucursal_id, erp_product_id
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
  SELECT DISTINCT ON (psp.erp_sucursal_id, psp.erp_product_id)
    psp.erp_sucursal_id,
    psp.erp_product_id,
    ROUND(
      COALESCE(psp.manual_max, psp.max_units, 0)::numeric
      / NULLIF(pp.factor::numeric, 0)
    )::integer AS effective_max,
    GREATEST(0,
      ROUND(
        COALESCE(psp.manual_max, psp.max_units, 0)::numeric
        / NULLIF(pp.factor::numeric, 0)
      )::integer
      - FLOOR(COALESCE(ia.units_vivos, 0) / NULLIF(pp.factor::numeric, 0))
    )::integer AS reponer
  FROM product_stock_params psp
  JOIN product_precios pp
       ON pp.product_id = psp.erp_product_id AND pp.activo = true
  LEFT JOIN inv_agg ia
         ON ia.erp_sucursal_id = psp.erp_sucursal_id
        AND ia.erp_product_id  = psp.erp_product_id
  WHERE psp.erp_sucursal_id = ANY(p_sucursal_ids)
    AND COALESCE(psp.manual_max, psp.max_units, 0) > 0
    AND ROUND(
          COALESCE(psp.manual_max, psp.max_units, 0)::numeric
          / NULLIF(pp.factor::numeric, 0)
        ) >= 1
  ORDER BY psp.erp_sucursal_id, psp.erp_product_id, pp.factor DESC, pp.id_presentacion
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
all_rows AS (SELECT * FROM con_bodega UNION ALL SELECT * FROM sin_bodega),

last_pedidos AS (
  SELECT pi.erp_sucursal_id, MAX(pd.created_at) AS last_pedido_at
  FROM pedido_items pi
  JOIN pedidos pd ON pd.id = pi.pedido_id
  WHERE pi.erp_sucursal_id = ANY(p_sucursal_ids)
    AND pd.status NOT IN ('anulado')
  GROUP BY pi.erp_sucursal_id
),

main_stats AS (
  SELECT
    erp_sucursal_id,
    COUNT(DISTINCT erp_product_id)::integer                                        AS total_productos,
    SUM(reponer)::integer                                                           AS necesidad_packs,
    COALESCE(SUM(reponer) FILTER (WHERE tiene_bodega),     0)::integer             AS con_bodega_packs,
    COALESCE(SUM(reponer) FILTER (WHERE NOT tiene_bodega), 0)::integer             AS sin_bodega_packs,
    COUNT(DISTINCT erp_product_id) FILTER (WHERE tiene_bodega)::integer            AS con_bodega_productos,
    COUNT(DISTINCT erp_product_id) FILTER (WHERE NOT tiene_bodega)::integer        AS sin_bodega_productos,
    ROUND(
      SUM(LEAST(100.0, reponer::numeric / NULLIF(effective_max, 0) * 100) * reponer)
      / NULLIF(SUM(reponer::numeric), 0)
    )::integer AS avg_urgencia_pct
  FROM all_rows
  GROUP BY erp_sucursal_id
)

SELECT
  ms.erp_sucursal_id,
  ms.total_productos,
  ms.necesidad_packs,
  ms.con_bodega_packs,
  ms.sin_bodega_packs,
  ms.con_bodega_productos,
  ms.sin_bodega_productos,
  ms.avg_urgencia_pct,
  lp.last_pedido_at
FROM main_stats ms
LEFT JOIN last_pedidos lp ON lp.erp_sucursal_id = ms.erp_sucursal_id;
$function$;

GRANT EXECUTE ON FUNCTION public.get_pedido_sucursal_stats(integer[]) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_pedido_sin_bodega(
  p_sucursal_ids integer[] DEFAULT ARRAY[1, 2, 3, 4, 5, 7]
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET statement_timeout = '60s'
AS $function$
WITH
suc_map    AS (SELECT erp_sucursal_id, branch_id FROM erp_sucursal_map WHERE NOT es_bodega),
bodega_suc AS (SELECT erp_sucursal_id FROM erp_sucursal_map WHERE es_bodega LIMIT 1),

inv_dedup AS (
  SELECT DISTINCT ON (
    i.erp_sucursal_id, i.erp_product_id, i.lote, i.fecha_vencimiento, i.is_vencidos,
    TRIM(LOWER(COALESCE(i.presentacion,''))), LOWER(COALESCE(i.detalle,''))
  )
    i.erp_sucursal_id, i.erp_product_id, i.lote, i.fecha_vencimiento, i.is_vencidos,
    i.cantidad, i.detalle,
    i.cantidad::numeric * COALESCE(
      vf.factor,
      NULLIF(split_part(LOWER(COALESCE(i.detalle,'')), 'x', 2), '')::numeric,
      1
    ) AS unidades
  FROM inventory i
  LEFT JOIN v_product_factor vf
         ON vf.product_id = i.erp_product_id
        AND vf.pres_key   = UPPER(TRIM(i.presentacion))
  ORDER BY
    i.erp_sucursal_id, i.erp_product_id, i.lote, i.fecha_vencimiento, i.is_vencidos,
    TRIM(LOWER(COALESCE(i.presentacion,''))), LOWER(COALESCE(i.detalle,''))
),

inv_agg AS (
  SELECT erp_sucursal_id, erp_product_id,
    COALESCE(SUM(unidades) FILTER (WHERE is_vencidos = false), 0)::numeric AS units_vivos
  FROM inv_dedup
  GROUP BY erp_sucursal_id, erp_product_id
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
  SELECT DISTINCT ON (psp.erp_sucursal_id, psp.erp_product_id)
    psp.erp_sucursal_id,
    psp.erp_product_id,
    pp.id_presentacion AS erp_presentacion_id,
    GREATEST(0,
      ROUND(
        COALESCE(psp.manual_max, psp.max_units, 0)::numeric
        / NULLIF(pp.factor::numeric, 0)
      )::integer
      - FLOOR(COALESCE(ia.units_vivos, 0) / NULLIF(pp.factor::numeric, 0))
    )::integer AS reponer
  FROM product_stock_params psp
  JOIN product_precios pp
       ON pp.product_id = psp.erp_product_id AND pp.activo = true
  LEFT JOIN inv_agg ia
         ON ia.erp_sucursal_id = psp.erp_sucursal_id
        AND ia.erp_product_id  = psp.erp_product_id
  WHERE psp.erp_sucursal_id = ANY(p_sucursal_ids)
    AND COALESCE(psp.manual_max, psp.max_units, 0) > 0
    AND ROUND(
          COALESCE(psp.manual_max, psp.max_units, 0)::numeric
          / NULLIF(pp.factor::numeric, 0)
        ) >= 1
  ORDER BY psp.erp_sucursal_id, psp.erp_product_id, pp.factor DESC, pp.id_presentacion
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
    SUM(n.reponer)::integer         AS total_necesidad,
    COALESCE(SUM(v.ventas_6m), 0)  AS total_ventas_6m,
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

GRANT EXECUTE ON FUNCTION public.get_pedido_sin_bodega(integer[]) TO authenticated, service_role;
