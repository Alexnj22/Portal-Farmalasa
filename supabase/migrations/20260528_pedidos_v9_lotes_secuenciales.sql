-- ============================================================
-- Pedidos v9: asignación FEFO secuencial de lotes por sucursal
--
-- Cambios:
--   1. ALTER erp_sucursal_map: nuevo campo orden_despacho integer
--   2. get_pedido_preview: reemplaza correlated subquery de lotes_bodega
--      con CTEs de intersección por intervalos — cada sucursal recibe
--      los lotes físicos que bodega irá a buscar según orden de despacho.
--
-- Algoritmo:
--   suc_cum_start[i] = sum(asignado_final[0..i-1]) en orden de despacho
--   lote_cum_start[j] = sum(packs[0..j-1]) en orden FEFO
--   take = MAX(0, MIN(suc_end, lote_end) - MAX(suc_start, lote_start))
-- ============================================================


-- ── 1. Agregar orden_despacho a erp_sucursal_map ─────────────

ALTER TABLE erp_sucursal_map
  ADD COLUMN IF NOT EXISTS orden_despacho integer;

UPDATE erp_sucursal_map SET orden_despacho = CASE erp_sucursal_id
  WHEN 5 THEN 1   -- La Popular  (primer destino)
  WHEN 1 THEN 2   -- Salud 1
  WHEN 2 THEN 3   -- Salud 2
  WHEN 3 THEN 4   -- Salud 3
  WHEN 4 THEN 5   -- Salud 4
  WHEN 7 THEN 6   -- Salud 5
  ELSE NULL
END;


-- ── 2. get_pedido_preview v9 ─────────────────────────────────

DROP FUNCTION IF EXISTS get_pedido_preview(integer[]);

CREATE FUNCTION get_pedido_preview(p_sucursal_ids integer[])
RETURNS TABLE (
  erp_sucursal_id      integer,
  erp_product_id       integer,
  erp_presentacion_id  integer,
  product_name         text,
  presentacion_tipo    text,
  factor               numeric,
  stock_packs          numeric,
  min_qty              integer,
  max_qty              integer,
  cantidad_reponer     integer,
  bodega_stock_packs   numeric,
  cantidad_asignada    integer,
  sin_stock            boolean,
  revision_minmax      boolean,
  urgencia_pct         integer,
  tiene_regla_despacho boolean,
  regla_multiplo       smallint,
  regla_blister        smallint,
  regla_solo_cajas     boolean,
  es_antibiotico       boolean,
  ventas_6m            numeric,
  lotes_bodega         jsonb
)
LANGUAGE sql
SECURITY DEFINER
AS $$
  WITH

  suc_map    AS (SELECT erp_sucursal_id, branch_id FROM erp_sucursal_map WHERE NOT es_bodega),
  bodega_suc AS (SELECT erp_sucursal_id FROM erp_sucursal_map WHERE es_bodega LIMIT 1),

  stock_sucursal AS (
    SELECT
      em.erp_sucursal_id, em.erp_product_id, em.erp_presentacion_id,
      em.min_qty, em.max_qty, pr.tipo AS presentacion_tipo,
      COALESCE(pp.factor, 1)::numeric AS factor,
      ROUND(
        COALESCE(SUM(inv.cantidad) FILTER (WHERE inv.is_vencidos = false), 0)::numeric
        / NULLIF(COALESCE(pp.factor, 1)::numeric, 0), 2
      ) AS stock_pk
    FROM erp_minmax em
    JOIN presentaciones pr ON pr.id = em.erp_presentacion_id
    LEFT JOIN product_precios pp ON pp.product_id = em.erp_product_id AND pp.id_presentacion = em.erp_presentacion_id
    LEFT JOIN inventory inv ON inv.erp_sucursal_id = em.erp_sucursal_id AND inv.erp_product_id = em.erp_product_id
    WHERE em.erp_sucursal_id = ANY(p_sucursal_ids) AND em.max_qty > 0
    GROUP BY em.erp_sucursal_id, em.erp_product_id, em.erp_presentacion_id, em.min_qty, em.max_qty, pr.tipo, pp.factor
  ),

  necesidades AS (
    SELECT ss.*, GREATEST(0, ss.max_qty - FLOOR(ss.stock_pk))::integer AS reponer
    FROM stock_sucursal ss WHERE GREATEST(0, ss.max_qty - FLOOR(ss.stock_pk)) > 0
  ),

  pres_units_needed AS (
    SELECT erp_product_id, erp_presentacion_id, factor,
      SUM(reponer)::numeric * factor AS units_needed
    FROM necesidades
    GROUP BY erp_product_id, erp_presentacion_id, factor
  ),
  pres_units_total AS (
    SELECT erp_product_id, SUM(units_needed) AS units_total
    FROM pres_units_needed GROUP BY erp_product_id
  ),
  bodega_raw AS (
    SELECT pu.erp_product_id, pu.erp_presentacion_id, pu.factor,
      COALESCE(SUM(inv.cantidad) FILTER (WHERE inv.is_vencidos = false), 0)::numeric AS bodega_units_total
    FROM pres_units_needed pu
    LEFT JOIN inventory inv
           ON inv.erp_sucursal_id = (SELECT erp_sucursal_id FROM bodega_suc)
          AND inv.erp_product_id  = pu.erp_product_id
    GROUP BY pu.erp_product_id, pu.erp_presentacion_id, pu.factor
  ),
  bodega AS (
    SELECT br.erp_product_id, br.erp_presentacion_id,
      ROUND(
        br.bodega_units_total
        * COALESCE(pu.units_needed / NULLIF(pt.units_total, 0), 1.0)
        / NULLIF(br.factor, 0),
      2) AS bodega_pk
    FROM bodega_raw br
    JOIN pres_units_needed pu ON pu.erp_product_id = br.erp_product_id AND pu.erp_presentacion_id = br.erp_presentacion_id
    JOIN pres_units_total  pt ON pt.erp_product_id = br.erp_product_id
  ),

  ventas_suc AS (
    SELECT sm.erp_sucursal_id, s.erp_product_id, SUM(s.cantidad)::numeric AS ventas_6m
    FROM product_sales_monthly_agg s
    JOIN suc_map sm ON sm.branch_id = s.branch_id
    WHERE sm.erp_sucursal_id = ANY(p_sucursal_ids)
      AND s.year_month >= to_char(NOW() - INTERVAL '6 months', 'YYYY-MM')
    GROUP BY sm.erp_sucursal_id, s.erp_product_id
  ),
  ventas_total AS (SELECT erp_product_id, SUM(ventas_6m) AS ventas_total_6m FROM ventas_suc GROUP BY erp_product_id),

  necesidades_ponderadas AS (
    SELECT n.*, COALESCE(vs.ventas_6m, 0) AS ventas_6m,
      CASE WHEN vt.ventas_total_6m IS NULL OR vt.ventas_total_6m = 0 THEN n.reponer::numeric
           ELSE COALESCE(vs.ventas_6m, 0) END AS peso_suc
    FROM necesidades n
    LEFT JOIN ventas_suc   vs ON vs.erp_sucursal_id = n.erp_sucursal_id AND vs.erp_product_id = n.erp_product_id
    LEFT JOIN ventas_total vt ON vt.erp_product_id = n.erp_product_id
  ),

  totales_por_producto AS (
    SELECT n.erp_product_id, n.erp_presentacion_id,
      SUM(n.reponer) AS total_reponer, SUM(n.peso_suc) AS total_pesos,
      COALESCE(b.bodega_pk, 0) AS bodega_disponible
    FROM necesidades_ponderadas n
    LEFT JOIN bodega b ON b.erp_product_id = n.erp_product_id AND b.erp_presentacion_id = n.erp_presentacion_id
    GROUP BY n.erp_product_id, n.erp_presentacion_id, b.bodega_pk
  ),

  distribucion_floor AS (
    SELECT
      n.erp_sucursal_id, n.erp_product_id, n.erp_presentacion_id,
      n.stock_pk, n.min_qty, n.max_qty, n.presentacion_tipo, n.factor, n.reponer, n.ventas_6m,
      t.bodega_disponible, t.total_reponer,
      CASE
        WHEN t.bodega_disponible <= 0               THEN 0
        WHEN t.bodega_disponible >= t.total_reponer THEN n.reponer
        WHEN t.total_pesos = 0 THEN
          LEAST(n.reponer, FLOOR(t.bodega_disponible * n.reponer::numeric / NULLIF(t.total_reponer, 0)))::integer
        ELSE
          LEAST(n.reponer, FLOOR(t.bodega_disponible * n.peso_suc / t.total_pesos))::integer
      END AS asignado_floor,
      CASE
        WHEN t.bodega_disponible <= 0 OR t.bodega_disponible >= t.total_reponer THEN 0::numeric
        WHEN t.total_pesos = 0 THEN
          LEAST(n.reponer::numeric, t.bodega_disponible * n.reponer::numeric / NULLIF(t.total_reponer, 0))
        ELSE
          LEAST(n.reponer::numeric, t.bodega_disponible * n.peso_suc / t.total_pesos)
      END AS quota_real
    FROM necesidades_ponderadas n
    JOIN totales_por_producto t ON t.erp_product_id = n.erp_product_id AND t.erp_presentacion_id = n.erp_presentacion_id
  ),

  distribucion_lr AS (
    SELECT df.*,
      GREATEST(0, FLOOR(df.bodega_disponible)::integer - SUM(df.asignado_floor) OVER (PARTITION BY df.erp_product_id, df.erp_presentacion_id)) AS sobrante,
      ROW_NUMBER() OVER (PARTITION BY df.erp_product_id, df.erp_presentacion_id ORDER BY (df.quota_real - df.asignado_floor) DESC, df.erp_sucursal_id) AS rn_fraccion
    FROM distribucion_floor df
  ),

  distribucion AS (
    SELECT lr.erp_sucursal_id, lr.erp_product_id, lr.erp_presentacion_id,
      lr.stock_pk, lr.min_qty, lr.max_qty, lr.presentacion_tipo, lr.factor, lr.reponer, lr.ventas_6m, lr.bodega_disponible,
      CASE
        WHEN lr.bodega_disponible <= 0 OR lr.bodega_disponible >= lr.total_reponer THEN lr.asignado_floor
        WHEN lr.reponer > lr.asignado_floor AND lr.rn_fraccion <= lr.sobrante THEN lr.asignado_floor + 1
        ELSE lr.asignado_floor
      END AS asignado_raw
    FROM distribucion_lr lr
  ),

  con_reglas AS (
    SELECT d.*,
      (dr.erp_product_id IS NOT NULL) AS tiene_regla,
      dr.multiplo AS regla_multiplo, dr.blister AS regla_blister,
      COALESCE(dr.solo_cajas, false) AS regla_solo_cajas,
      CASE
        WHEN d.asignado_raw <= 0 OR d.bodega_disponible <= 0 THEN 0
        ELSE (FLOOR(FLOOR(d.asignado_raw::numeric / COALESCE(dr.multiplo, 1)) * COALESCE(dr.multiplo, 1)::numeric / COALESCE(dr.blister, 1)) * COALESCE(dr.blister, 1))::integer
      END AS asignado_final
    FROM distribucion d
    LEFT JOIN dispatch_rules dr ON dr.erp_product_id = d.erp_product_id
  ),

  -- ── Sequential FEFO lote allocation ────────────────────────
  -- Step 1: all bodega lotes for products that appear in con_reglas
  bodega_lotes_raw AS (
    SELECT inv.erp_product_id, inv.lote, inv.fecha_vencimiento,
      SUM(inv.cantidad) AS total_units
    FROM inventory inv
    INNER JOIN (SELECT DISTINCT erp_product_id FROM con_reglas) cr
            ON cr.erp_product_id = inv.erp_product_id
    WHERE inv.erp_sucursal_id = (SELECT erp_sucursal_id FROM bodega_suc)
      AND inv.is_vencidos = false AND inv.cantidad > 0
    GROUP BY inv.erp_product_id, inv.lote, inv.fecha_vencimiento
    HAVING SUM(inv.cantidad) > 0
  ),

  -- Step 2: convert raw units → packs per presentation (proportional v8 logic)
  bodega_lotes_pres AS (
    SELECT
      bl.erp_product_id,
      pu.erp_presentacion_id,
      bl.lote,
      bl.fecha_vencimiento,
      GREATEST(0, FLOOR(
        bl.total_units::numeric
        * COALESCE(pu.units_needed / NULLIF(pt.units_total, 0), 1.0)
        / NULLIF(pu.factor, 0)
      ))::integer AS lote_packs
    FROM bodega_lotes_raw bl
    JOIN pres_units_needed pu ON pu.erp_product_id = bl.erp_product_id
    JOIN pres_units_total  pt ON pt.erp_product_id = bl.erp_product_id
  ),

  -- Step 3: cumulative FEFO offsets per (product, presentation)
  bodega_lotes_fefo AS (
    SELECT
      bl.*,
      COALESCE(SUM(bl.lote_packs) OVER (
        PARTITION BY bl.erp_product_id, bl.erp_presentacion_id
        ORDER BY bl.fecha_vencimiento ASC NULLS LAST, bl.lote ASC
        ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
      ), 0)::integer AS lote_cum_start,
      SUM(bl.lote_packs) OVER (
        PARTITION BY bl.erp_product_id, bl.erp_presentacion_id
        ORDER BY bl.fecha_vencimiento ASC NULLS LAST, bl.lote ASC
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
      )::integer AS lote_cum_end
    FROM bodega_lotes_pres bl
    WHERE bl.lote_packs > 0
  ),

  -- Step 4: cumulative sucursal dispatch offsets per (product, presentation)
  suc_order AS (
    SELECT
      cr.erp_sucursal_id, cr.erp_product_id, cr.erp_presentacion_id,
      cr.asignado_final,
      COALESCE(SUM(cr.asignado_final) OVER (
        PARTITION BY cr.erp_product_id, cr.erp_presentacion_id
        ORDER BY COALESCE(esm.orden_despacho, 999) ASC, cr.erp_sucursal_id ASC
        ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
      ), 0)::integer AS suc_cum_start,
      SUM(cr.asignado_final) OVER (
        PARTITION BY cr.erp_product_id, cr.erp_presentacion_id
        ORDER BY COALESCE(esm.orden_despacho, 999) ASC, cr.erp_sucursal_id ASC
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
      )::integer AS suc_cum_end
    FROM con_reglas cr
    JOIN erp_sucursal_map esm ON esm.erp_sucursal_id = cr.erp_sucursal_id
    WHERE cr.asignado_final > 0
  ),

  -- Step 5: interval intersection → packs per (sucursal, lote)
  lote_intersect AS (
    SELECT
      so.erp_sucursal_id, so.erp_product_id, so.erp_presentacion_id,
      lf.lote, lf.fecha_vencimiento,
      GREATEST(0,
        LEAST(so.suc_cum_end, lf.lote_cum_end)
        - GREATEST(so.suc_cum_start, lf.lote_cum_start)
      )::integer AS take_packs
    FROM suc_order so
    JOIN bodega_lotes_fefo lf
      ON lf.erp_product_id      = so.erp_product_id
     AND lf.erp_presentacion_id = so.erp_presentacion_id
  ),

  -- Step 6: aggregate to JSONB per (sucursal, product, presentation)
  lotes_por_sucursal AS (
    SELECT
      erp_sucursal_id, erp_product_id, erp_presentacion_id,
      jsonb_agg(
        jsonb_build_object(
          'lote',              lote,
          'fecha_vencimiento', fecha_vencimiento,
          'packs',             take_packs
        )
        ORDER BY fecha_vencimiento ASC NULLS LAST, lote ASC
      ) AS lotes_seq
    FROM lote_intersect
    WHERE take_packs > 0
    GROUP BY erp_sucursal_id, erp_product_id, erp_presentacion_id
  )

  SELECT
    cr.erp_sucursal_id, cr.erp_product_id, cr.erp_presentacion_id,
    p.nombre::text AS product_name, cr.presentacion_tipo::text, cr.factor,
    ROUND(cr.stock_pk, 2) AS stock_packs, cr.min_qty, cr.max_qty,
    cr.reponer::integer AS cantidad_reponer,
    ROUND(cr.bodega_disponible, 2) AS bodega_stock_packs,
    cr.asignado_final AS cantidad_asignada,
    (cr.bodega_disponible <= 0) AS sin_stock,
    (cr.bodega_disponible > 0 AND cr.asignado_final = 0 AND cr.reponer > 0) AS revision_minmax,
    LEAST(100, ROUND((cr.reponer::numeric / NULLIF(cr.max_qty, 0)) * 100))::integer AS urgencia_pct,
    COALESCE(cr.tiene_regla, false) AS tiene_regla_despacho,
    cr.regla_multiplo, cr.regla_blister, cr.regla_solo_cajas,
    COALESCE(p.es_antibiotico, false) AS es_antibiotico, cr.ventas_6m,
    lps.lotes_seq AS lotes_bodega
  FROM con_reglas cr
  JOIN products p ON p.id = cr.erp_product_id
  LEFT JOIN lotes_por_sucursal lps
         ON lps.erp_sucursal_id      = cr.erp_sucursal_id
        AND lps.erp_product_id       = cr.erp_product_id
        AND lps.erp_presentacion_id  = cr.erp_presentacion_id
  ORDER BY cr.erp_sucursal_id, urgencia_pct DESC, p.nombre;
$$;

GRANT EXECUTE ON FUNCTION get_pedido_preview(integer[]) TO authenticated;
