SET lock_timeout = '5s';

-- Feature flag temporal (2026-07-17): el flujo de "Confirmar recepción"
-- (RecepcionModal) todavía no está habilitado para las sucursales (sin
-- acceso al portal aún). Sin ese flujo, pedido_items.status nunca sale de
-- 'pendiente', así que el CTE pending_committed de
-- get_pedido_generar_dashboard resta contra Bodega, indefinidamente,
-- cualquier pedido ya finalizado/despachado. Caso real detectado en
-- auditoría (Micropore 1x5, producto erp_product_id=2): 147 unidades
-- "comprometidas" en 19 pedido_items pendientes desde 2026-06-29 hasta
-- 2026-07-16, contra solo 65 unidades físicas en Bodega → net_units
-- negativo → el producto se mostraba falsamente "sin stock en Bodega"
-- aunque el inventario físico real era positivo.
--
-- Mientras pedido_recepcion_activa = false, get_pedido_generar_dashboard
-- ignora pending_committed y usa el inventario físico de Bodega tal cual
-- (sin netear compromisos pendientes).
--
-- Cuando todas las sucursales tengan acceso y el flujo de "Confirmar
-- Recepción" esté en uso real, reactivar con:
--   UPDATE stock_config SET pedido_recepcion_activa = true WHERE id = 1;
-- (sin necesidad de otra migración) para volver a descontar los
-- compromisos pendientes del stock disponible de Bodega — comportamiento
-- original.
ALTER TABLE public.stock_config
    ADD COLUMN IF NOT EXISTS pedido_recepcion_activa boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.stock_config.pedido_recepcion_activa IS
    'Flag temporal (2026-07-17): activa el descuento de pedido_items pendientes contra el stock de Bodega en get_pedido_generar_dashboard (CTE pending_committed). false mientras las sucursales no tengan acceso al flujo de Confirmar Recepción (RecepcionModal) -- si no, el backlog de items nunca confirmados infla el "comprometido" indefinidamente y Bodega aparece con falso "sin stock" (ver caso Micropore 1x5, 2026-07-17). Poner en true cuando el flujo de recepción esté en uso real por todas las sucursales.';

CREATE OR REPLACE FUNCTION public.get_pedido_generar_dashboard(p_sucursal_ids integer[] DEFAULT ARRAY[1, 2, 3, 4, 5, 7])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET statement_timeout TO '60s'
 SET search_path TO 'public', 'extensions'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
BEGIN
RETURN (
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
    AND (SELECT pedido_recepcion_activa FROM stock_config WHERE id = 1)
  GROUP BY pi.erp_product_id
),

pref_factor AS (
  SELECT dr.erp_product_id, pp.factor AS pref
  FROM dispatch_rules dr
  JOIN product_precios pp ON pp.product_id = dr.erp_product_id
                          AND pp.id_presentacion = dr.dispatch_id_presentacion
  WHERE dr.dispatch_id_presentacion IS NOT NULL
),

necesidades AS (
  SELECT DISTINCT ON (psp.erp_sucursal_id, psp.erp_product_id)
    psp.erp_sucursal_id,
    psp.erp_product_id,
    pp.id_presentacion AS erp_presentacion_id,
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
  LEFT JOIN pref_factor pf ON pf.erp_product_id = psp.erp_product_id
  WHERE psp.erp_sucursal_id = ANY(p_sucursal_ids)
    AND COALESCE(psp.manual_max, psp.max_units, 0) > 0
    AND ROUND(
          COALESCE(psp.manual_max, psp.max_units, 0)::numeric
          / NULLIF(pp.factor::numeric, 0)
        ) >= 1
  ORDER BY
    psp.erp_sucursal_id,
    psp.erp_product_id,
    (pp.factor = COALESCE(pf.pref, -1)) DESC,
    CASE WHEN pf.pref IS NULL THEN (pp.factor > 1)::int ELSE 0 END DESC,
    pp.factor ASC,
    pp.id_presentacion
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

flagged AS (
  SELECT n.erp_sucursal_id, n.erp_product_id, n.effective_max, n.reponer,
    EXISTS (SELECT 1 FROM bodega_disponible b WHERE b.erp_product_id = n.erp_product_id) AS tiene_bodega
  FROM necesidades_pos n
),

-- ── payload 1: stats por sucursal (= get_pedido_sucursal_stats) ──
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
    COUNT(DISTINCT erp_product_id)::integer                                 AS total_productos,
    SUM(reponer)::integer                                                    AS necesidad_packs,
    COALESCE(SUM(reponer) FILTER (WHERE tiene_bodega),     0)::integer      AS con_bodega_packs,
    COALESCE(SUM(reponer) FILTER (WHERE NOT tiene_bodega), 0)::integer      AS sin_bodega_packs,
    COUNT(DISTINCT erp_product_id) FILTER (WHERE tiene_bodega)::integer     AS con_bodega_productos,
    COUNT(DISTINCT erp_product_id) FILTER (WHERE NOT tiene_bodega)::integer AS sin_bodega_productos,
    ROUND(
      SUM(LEAST(100.0, reponer::numeric / NULLIF(effective_max, 0) * 100) * reponer)
      / NULLIF(SUM(reponer::numeric), 0)
    )::integer AS avg_urgencia_pct
  FROM flagged
  GROUP BY erp_sucursal_id
),
stats_json AS (
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'erp_sucursal_id',      ms.erp_sucursal_id,
      'total_productos',      ms.total_productos,
      'necesidad_packs',      ms.necesidad_packs,
      'con_bodega_packs',     ms.con_bodega_packs,
      'sin_bodega_packs',     ms.sin_bodega_packs,
      'con_bodega_productos', ms.con_bodega_productos,
      'sin_bodega_productos', ms.sin_bodega_productos,
      'avg_urgencia_pct',     ms.avg_urgencia_pct,
      'last_pedido_at',       lp.last_pedido_at
    ) ORDER BY ms.erp_sucursal_id
  ), '[]'::jsonb) AS j
  FROM main_stats ms
  LEFT JOIN last_pedidos lp ON lp.erp_sucursal_id = ms.erp_sucursal_id
),

-- ── payload 2: productos sin bodega (= get_pedido_sin_bodega) ──
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
  FROM flagged n
  LEFT JOIN ventas v ON v.erp_sucursal_id = n.erp_sucursal_id AND v.erp_product_id = n.erp_product_id
  WHERE NOT n.tiene_bodega
  GROUP BY n.erp_product_id
),
sin_bodega_json AS (
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
  ) AS j
  FROM agrupado a
  JOIN products p ON p.id = a.erp_product_id
  LEFT JOIN laboratorios lab ON lab.id = p.laboratorio_id
)

SELECT jsonb_build_object(
  'stats',      (SELECT j FROM stats_json),
  'sin_bodega', (SELECT j FROM sin_bodega_json)
)
);
END;
$function$;
