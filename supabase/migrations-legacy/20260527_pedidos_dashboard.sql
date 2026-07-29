-- ============================================================
-- Pedidos dashboard helpers
-- 1. get_pedido_sucursal_stats  — per-sucursal need summary
-- 2. get_pedido_sin_bodega      — products not in Bodega, paginated
-- 3. get_pedido_sin_bodega_count — total count for pagination
-- ============================================================

-- ── 1. Sucursal stats ────────────────────────────────────────
DROP FUNCTION IF EXISTS get_pedido_sucursal_stats(integer[]);

CREATE FUNCTION get_pedido_sucursal_stats(
  p_sucursal_ids integer[] DEFAULT ARRAY[1,2,3,4,5,7]
)
RETURNS TABLE (
  erp_sucursal_id  integer,
  total_productos  integer,
  necesidad_packs  integer,
  con_bodega_packs integer,
  sin_bodega_packs integer
)
LANGUAGE sql
SECURITY DEFINER
AS $$
WITH
necesidades AS (
  SELECT
    em.erp_sucursal_id,
    em.erp_product_id,
    em.erp_presentacion_id,
    GREATEST(0, em.max_qty - FLOOR(
      COALESCE(SUM(inv.cantidad) FILTER (WHERE inv.is_vencidos = false), 0)::numeric
      / NULLIF(COALESCE(pr.factor, 1)::numeric, 0)
    ))::integer AS reponer
  FROM erp_minmax em
  JOIN presentaciones pr ON pr.id = em.erp_presentacion_id
  LEFT JOIN inventory inv
         ON inv.erp_sucursal_id = em.erp_sucursal_id
        AND inv.erp_product_id  = em.erp_product_id
  WHERE em.erp_sucursal_id = ANY(p_sucursal_ids)
    AND em.max_qty > 0
  GROUP BY em.erp_sucursal_id, em.erp_product_id, em.erp_presentacion_id,
           em.min_qty, em.max_qty, pr.factor
),
necesidades_pos AS (
  SELECT * FROM necesidades WHERE reponer > 0
),
bodega_disponible AS (
  SELECT DISTINCT erp_product_id
  FROM inventory
  WHERE erp_sucursal_id = 6
    AND is_vencidos = false
    AND cantidad > 0
)
SELECT
  n.erp_sucursal_id,
  COUNT(DISTINCT n.erp_product_id)::integer                                    AS total_productos,
  SUM(n.reponer)::integer                                                       AS necesidad_packs,
  COALESCE(SUM(n.reponer) FILTER (WHERE b.erp_product_id IS NOT NULL), 0)::integer AS con_bodega_packs,
  COALESCE(SUM(n.reponer) FILTER (WHERE b.erp_product_id IS NULL),     0)::integer AS sin_bodega_packs
FROM necesidades_pos n
LEFT JOIN bodega_disponible b ON b.erp_product_id = n.erp_product_id
GROUP BY n.erp_sucursal_id;
$$;

GRANT EXECUTE ON FUNCTION get_pedido_sucursal_stats(integer[]) TO authenticated;


-- ── 2. Sin bodega paginated ──────────────────────────────────
DROP FUNCTION IF EXISTS get_pedido_sin_bodega(integer[], integer, integer);

CREATE FUNCTION get_pedido_sin_bodega(
  p_sucursal_ids integer[] DEFAULT ARRAY[1,2,3,4,5,7],
  p_limit        integer   DEFAULT 20,
  p_offset       integer   DEFAULT 0
)
RETURNS TABLE (
  erp_product_id  integer,
  product_name    text,
  laboratorio     text,
  sucursales      jsonb,
  total_necesidad integer,
  total_ventas_6m numeric,
  prioridad_score numeric
)
LANGUAGE sql
SECURITY DEFINER
AS $$
WITH
suc_map (erp_sucursal_id, branch_id) AS (
  VALUES (1,4),(2,25),(3,27),(4,28),(5,2),(7,29)
),
necesidades AS (
  SELECT
    em.erp_sucursal_id,
    em.erp_product_id,
    em.erp_presentacion_id,
    GREATEST(0, em.max_qty - FLOOR(
      COALESCE(SUM(inv.cantidad) FILTER (WHERE inv.is_vencidos = false), 0)::numeric
      / NULLIF(COALESCE(pr.factor, 1)::numeric, 0)
    ))::integer AS reponer
  FROM erp_minmax em
  JOIN presentaciones pr ON pr.id = em.erp_presentacion_id
  LEFT JOIN inventory inv
         ON inv.erp_sucursal_id = em.erp_sucursal_id
        AND inv.erp_product_id  = em.erp_product_id
  WHERE em.erp_sucursal_id = ANY(p_sucursal_ids)
    AND em.max_qty > 0
  GROUP BY em.erp_sucursal_id, em.erp_product_id, em.erp_presentacion_id,
           em.min_qty, em.max_qty, pr.factor
),
necesidades_pos AS (
  SELECT * FROM necesidades WHERE reponer > 0
),
sin_bodega_ids AS (
  SELECT DISTINCT erp_product_id
  FROM necesidades_pos n
  WHERE NOT EXISTS (
    SELECT 1 FROM inventory inv
    WHERE inv.erp_sucursal_id = 6
      AND inv.erp_product_id  = n.erp_product_id
      AND inv.is_vencidos = false
      AND inv.cantidad    > 0
  )
),
ventas AS (
  SELECT sm.erp_sucursal_id, s.erp_product_id,
         SUM(s.cantidad)::numeric AS ventas_6m
  FROM product_sales_monthly_agg s
  JOIN suc_map sm ON sm.branch_id = s.branch_id
  WHERE sm.erp_sucursal_id = ANY(p_sucursal_ids)
    AND s.year_month >= to_char(NOW() - INTERVAL '6 months', 'YYYY-MM')
  GROUP BY sm.erp_sucursal_id, s.erp_product_id
),
ventas_total AS (
  SELECT erp_product_id, SUM(ventas_6m) AS ventas_total_6m
  FROM ventas
  GROUP BY erp_product_id
),
agrupado AS (
  SELECT
    n.erp_product_id,
    SUM(n.reponer)::integer AS total_necesidad,
    jsonb_agg(
      jsonb_build_object(
        'erp_sucursal_id', n.erp_sucursal_id,
        'reponer',         SUM(n.reponer),
        'ventas_6m',       COALESCE(v.ventas_6m, 0)
      )
      ORDER BY SUM(n.reponer) DESC
    ) AS sucursales,
    COALESCE(vt.ventas_total_6m, 0) AS total_ventas_6m
  FROM necesidades_pos n
  JOIN sin_bodega_ids sb ON sb.erp_product_id = n.erp_product_id
  LEFT JOIN ventas v ON v.erp_sucursal_id = n.erp_sucursal_id
                    AND v.erp_product_id   = n.erp_product_id
  LEFT JOIN ventas_total vt ON vt.erp_product_id = n.erp_product_id
  GROUP BY n.erp_product_id, vt.ventas_total_6m
)
SELECT
  a.erp_product_id,
  p.nombre::text                   AS product_name,
  COALESCE(l.nombre, '—')::text    AS laboratorio,
  a.sucursales,
  a.total_necesidad,
  a.total_ventas_6m,
  (a.total_necesidad::numeric + a.total_ventas_6m * 0.1) AS prioridad_score
FROM agrupado a
JOIN products p    ON p.id    = a.erp_product_id
LEFT JOIN laboratorios l ON l.id = p.laboratorio_id
ORDER BY prioridad_score DESC, a.total_necesidad DESC
LIMIT p_limit OFFSET p_offset;
$$;

GRANT EXECUTE ON FUNCTION get_pedido_sin_bodega(integer[], integer, integer) TO authenticated;


-- ── 3. Sin bodega count ──────────────────────────────────────
DROP FUNCTION IF EXISTS get_pedido_sin_bodega_count(integer[]);

CREATE FUNCTION get_pedido_sin_bodega_count(
  p_sucursal_ids integer[] DEFAULT ARRAY[1,2,3,4,5,7]
)
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
AS $$
WITH
necesidades AS (
  SELECT
    em.erp_sucursal_id,
    em.erp_product_id,
    GREATEST(0, em.max_qty - FLOOR(
      COALESCE(SUM(inv.cantidad) FILTER (WHERE inv.is_vencidos = false), 0)::numeric
      / NULLIF(COALESCE(pr.factor, 1)::numeric, 0)
    ))::integer AS reponer
  FROM erp_minmax em
  JOIN presentaciones pr ON pr.id = em.erp_presentacion_id
  LEFT JOIN inventory inv
         ON inv.erp_sucursal_id = em.erp_sucursal_id
        AND inv.erp_product_id  = em.erp_product_id
  WHERE em.erp_sucursal_id = ANY(p_sucursal_ids)
    AND em.max_qty > 0
  GROUP BY em.erp_sucursal_id, em.erp_product_id, em.erp_presentacion_id,
           em.min_qty, em.max_qty, pr.factor
)
SELECT COUNT(DISTINCT erp_product_id)::integer
FROM necesidades
WHERE reponer > 0
  AND NOT EXISTS (
    SELECT 1 FROM inventory inv
    WHERE inv.erp_sucursal_id = 6
      AND inv.erp_product_id  = necesidades.erp_product_id
      AND inv.is_vencidos = false
      AND inv.cantidad    > 0
  );
$$;

GRANT EXECUTE ON FUNCTION get_pedido_sin_bodega_count(integer[]) TO authenticated;
