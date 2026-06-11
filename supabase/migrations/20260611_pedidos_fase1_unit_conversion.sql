-- ============================================================
-- Pedidos FASE 1.1 — Corrección conversión de unidades (v2.2.51)
--
-- Bug: inventory.cantidad son packs de la presentación de ESA fila
-- (1X10 = 10 unidades/pack, 1X30 = 30 unidades/pack, etc.).
-- Las 3 funciones sumaban cantidad cruda y la dividían por el factor
-- de la presentación pedida, mezclando unidades de distinto tamaño.
-- Resultado: stock de sucursal subestimado → más pedido de lo necesario;
-- stock de bodega subestimado → productos en "sin stock" o "revisión"
-- cuando bodega sí tiene suficiente.
--
-- Fix: CTE inv_dedup normaliza a UNIDADES reales con la misma fórmula
-- que usa inventory_grouped_mv (referencia ERP):
--   unidades = cantidad × COALESCE(NULLIF(split_part(lower(detalle),'x',2),'')::numeric, 1)
-- Dedup defensivo ampliado a (sucursal, producto, lote, fecha_venc,
-- presentacion, detalle) para no eliminar presentaciones legítimas
-- distintas del mismo producto con mismo lote/fecha.
--
-- Acepta: get_pedido_preview(ARRAY[1]) → producto 2115 stock_packs≈1.3,
-- producto 5184 stock_packs≈6.0 y sale de necesidad,
-- producto 3119 stock_packs≈2.6.
-- ============================================================


-- ── get_pedido_preview v11 ────────────────────────────────────

CREATE OR REPLACE FUNCTION get_pedido_preview(p_sucursal_ids integer[])
RETURNS TABLE(
  erp_sucursal_id integer, erp_product_id integer, erp_presentacion_id integer,
  product_name text, presentacion_tipo text, factor numeric,
  stock_packs numeric, min_qty integer, max_qty integer,
  cantidad_reponer integer, bodega_stock_packs numeric,
  cantidad_asignada integer, sin_stock boolean, revision_minmax boolean,
  urgencia_pct integer, tiene_regla_despacho boolean,
  regla_multiplo smallint, regla_blister smallint, regla_solo_cajas boolean,
  es_antibiotico boolean, ventas_6m numeric, lotes_bodega jsonb
)
LANGUAGE sql
SECURITY DEFINER
AS $function$
  WITH

  suc_map    AS (SELECT erp_sucursal_id, branch_id FROM erp_sucursal_map WHERE NOT es_bodega),
  bodega_suc AS (SELECT erp_sucursal_id FROM erp_sucursal_map WHERE es_bodega LIMIT 1),

  -- Normaliza inventory.cantidad → unidades reales usando el factor embebido en `detalle`
  -- (ej. "1X10" → factor 10). Dedup defensivo incluye presentacion+detalle para no
  -- colapsar presentaciones distintas del mismo producto/lote/fecha.
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

  stock_sucursal AS (
    SELECT
      em.erp_sucursal_id, em.erp_product_id, em.erp_presentacion_id,
      em.min_qty, em.max_qty, pr.tipo AS presentacion_tipo,
      COALESCE(pp.factor, 1)::numeric AS factor,
      ROUND(
        COALESCE(SUM(inv.unidades) FILTER (WHERE inv.is_vencidos = false), 0)::numeric
        / NULLIF(COALESCE(pp.factor, 1)::numeric, 0), 2
      ) AS stock_pk
    FROM erp_minmax em
    JOIN presentaciones pr ON pr.id = em.erp_presentacion_id
    LEFT JOIN product_precios pp ON pp.product_id = em.erp_product_id AND pp.id_presentacion = em.erp_presentacion_id
    LEFT JOIN inv_dedup inv ON inv.erp_sucursal_id = em.erp_sucursal_id AND inv.erp_product_id = em.erp_product_id
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

  bodega_raw AS (
    SELECT pu.erp_product_id, pu.erp_presentacion_id, pu.factor,
      GREATEST(0,
        COALESCE(SUM(inv.unidades) FILTER (WHERE inv.is_vencidos = false), 0)::numeric
        - COALESCE(pc.committed_units, 0)
      ) AS bodega_units_total
    FROM pres_units_needed pu
    LEFT JOIN inv_dedup inv
           ON inv.erp_sucursal_id = (SELECT erp_sucursal_id FROM bodega_suc)
          AND inv.erp_product_id  = pu.erp_product_id
    LEFT JOIN pending_committed pc ON pc.erp_product_id = pu.erp_product_id
    GROUP BY pu.erp_product_id, pu.erp_presentacion_id, pu.factor, pc.committed_units
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

  bodega_lotes_raw AS (
    SELECT inv.erp_product_id, inv.lote, inv.fecha_vencimiento,
      SUM(inv.unidades) AS total_units
    FROM inv_dedup inv
    INNER JOIN (SELECT DISTINCT erp_product_id FROM con_reglas) cr
            ON cr.erp_product_id = inv.erp_product_id
    WHERE inv.erp_sucursal_id = (SELECT erp_sucursal_id FROM bodega_suc)
      AND inv.is_vencidos = false AND inv.unidades > 0
    GROUP BY inv.erp_product_id, inv.lote, inv.fecha_vencimiento
    HAVING SUM(inv.unidades) > 0
  ),

  bodega_lotes_pres AS (
    SELECT
      bl.erp_product_id, pu.erp_presentacion_id, bl.lote, bl.fecha_vencimiento,
      GREATEST(0, FLOOR(
        bl.total_units::numeric
        * COALESCE(pu.units_needed / NULLIF(pt.units_total, 0), 1.0)
        / NULLIF(pu.factor, 0)
      ))::integer AS lote_packs
    FROM bodega_lotes_raw bl
    JOIN pres_units_needed pu ON pu.erp_product_id = bl.erp_product_id
    JOIN pres_units_total  pt ON pt.erp_product_id = bl.erp_product_id
  ),

  bodega_lotes_fefo AS (
    SELECT bl.*,
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

  suc_order AS (
    SELECT
      cr.erp_sucursal_id, cr.erp_product_id, cr.erp_presentacion_id, cr.asignado_final,
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

  lotes_por_sucursal AS (
    SELECT erp_sucursal_id, erp_product_id, erp_presentacion_id,
      jsonb_agg(
        jsonb_build_object('lote', lote, 'fecha_vencimiento', fecha_vencimiento, 'packs', take_packs)
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
$function$;

GRANT EXECUTE ON FUNCTION get_pedido_preview(integer[]) TO authenticated;


-- ── get_pedido_sucursal_stats v10 ─────────────────────────────

CREATE OR REPLACE FUNCTION get_pedido_sucursal_stats(
  p_sucursal_ids integer[] DEFAULT ARRAY[1,2,3,4,5,7]
)
RETURNS TABLE(
  erp_sucursal_id integer, total_productos integer,
  necesidad_packs integer, con_bodega_packs integer, sin_bodega_packs integer
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
bodega_disponible AS (
  SELECT erp_product_id FROM bodega_net WHERE net_units > 0
)

SELECT
  n.erp_sucursal_id,
  COUNT(DISTINCT n.erp_product_id)::integer                                        AS total_productos,
  SUM(n.reponer)::integer                                                           AS necesidad_packs,
  COALESCE(SUM(n.reponer) FILTER (WHERE b.erp_product_id IS NOT NULL), 0)::integer AS con_bodega_packs,
  COALESCE(SUM(n.reponer) FILTER (WHERE b.erp_product_id IS NULL),     0)::integer AS sin_bodega_packs
FROM necesidades_pos n
LEFT JOIN bodega_disponible b ON b.erp_product_id = n.erp_product_id
GROUP BY n.erp_sucursal_id;
$function$;

GRANT EXECUTE ON FUNCTION get_pedido_sucursal_stats(integer[]) TO authenticated;


-- ── get_pedido_sin_bodega v10 ─────────────────────────────────

CREATE OR REPLACE FUNCTION get_pedido_sin_bodega(
  p_sucursal_ids integer[] DEFAULT ARRAY[1,2,3,4,5,7],
  p_limit  integer DEFAULT 20,
  p_offset integer DEFAULT 0
)
RETURNS TABLE(
  erp_product_id integer, product_name text, laboratorio text,
  sucursales jsonb, total_necesidad integer, total_ventas_6m numeric,
  prioridad_score numeric
)
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

SELECT
  a.erp_product_id,
  p.nombre::text AS product_name,
  lab.nombre::text AS laboratorio,
  a.sucursales,
  a.total_necesidad,
  a.total_ventas_6m,
  ROUND((a.total_necesidad::numeric * (1 + a.total_ventas_6m / NULLIF(a.total_necesidad, 0))), 2) AS prioridad_score
FROM agrupado a
JOIN products p ON p.id = a.erp_product_id
LEFT JOIN laboratorios lab ON lab.id = p.laboratorio_id
ORDER BY prioridad_score DESC NULLS LAST
LIMIT p_limit OFFSET p_offset;
$function$;

GRANT EXECUTE ON FUNCTION get_pedido_sin_bodega(integer[], integer, integer) TO authenticated;
