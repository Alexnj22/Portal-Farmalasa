-- ============================================================
-- Pedidos v7: fix total_pesos = 0 en distribucion_floor
--
-- Bug: cuando una sucursal tiene ventas_6m=0 para un producto,
--   pero el producto SÍ tiene ventas en otras sucursales,
--   ventas_total_6m > 0 → el fallback (peso = reponer) NO se activa.
--   → peso_suc = 0, total_pesos = 0
--   → NULLIF(0,0) = NULL → FLOOR(NULL) = NULL
--   → LEAST(reponer, NULL) = reponer (PostgreSQL ignora NULLs en LEAST)
--   → asignado_floor = reponer incorrecto aunque bodega < 1 pack.
--
-- Fix: en distribucion_floor, cuando total_pesos = 0 (todos los
--   participantes del partition tienen peso 0) se usa distribución
--   proporcional por reponer en lugar de por ventas.
-- ============================================================

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

  suc_map (erp_sucursal_id, branch_id) AS (
    VALUES (1,4),(2,25),(3,27),(4,28),(5,2),(7,29)
  ),

  stock_sucursal AS (
    SELECT
      em.erp_sucursal_id,
      em.erp_product_id,
      em.erp_presentacion_id,
      em.min_qty,
      em.max_qty,
      pr.tipo                                         AS presentacion_tipo,
      COALESCE(pp.factor, 1)::numeric                 AS factor,
      ROUND(
        COALESCE(
          SUM(inv.cantidad) FILTER (WHERE inv.is_vencidos = false),
          0
        )::numeric / NULLIF(COALESCE(pp.factor, 1)::numeric, 0),
        2
      )                                                AS stock_pk
    FROM erp_minmax em
    JOIN presentaciones pr ON pr.id = em.erp_presentacion_id
    LEFT JOIN product_precios pp
           ON pp.product_id      = em.erp_product_id
          AND pp.id_presentacion = em.erp_presentacion_id
    LEFT JOIN inventory inv
           ON inv.erp_sucursal_id = em.erp_sucursal_id
          AND inv.erp_product_id  = em.erp_product_id
    WHERE em.erp_sucursal_id = ANY(p_sucursal_ids)
      AND em.max_qty > 0
    GROUP BY
      em.erp_sucursal_id, em.erp_product_id, em.erp_presentacion_id,
      em.min_qty, em.max_qty, pr.tipo, pp.factor
  ),

  necesidades AS (
    SELECT
      ss.*,
      GREATEST(0, ss.max_qty - FLOOR(ss.stock_pk))::integer AS reponer
    FROM stock_sucursal ss
    WHERE GREATEST(0, ss.max_qty - FLOOR(ss.stock_pk)) > 0
  ),

  bodega_raw AS (
    SELECT
      n.erp_product_id,
      n.erp_presentacion_id,
      n.factor,
      COALESCE(
        SUM(inv.cantidad) FILTER (WHERE inv.is_vencidos = false),
        0
      )::numeric AS bodega_units_ind
    FROM (
      SELECT DISTINCT erp_product_id, erp_presentacion_id, factor
      FROM necesidades
    ) n
    LEFT JOIN inventory inv
           ON inv.erp_sucursal_id = 6
          AND inv.erp_product_id  = n.erp_product_id
    GROUP BY n.erp_product_id, n.erp_presentacion_id, n.factor
  ),

  bodega AS (
    SELECT
      erp_product_id,
      erp_presentacion_id,
      ROUND(bodega_units_ind / NULLIF(factor, 0), 2) AS bodega_pk
    FROM bodega_raw
  ),

  ventas_suc AS (
    SELECT
      sm.erp_sucursal_id,
      s.erp_product_id,
      SUM(s.cantidad)::numeric AS ventas_6m
    FROM product_sales_monthly_agg s
    JOIN suc_map sm ON sm.branch_id = s.branch_id
    WHERE sm.erp_sucursal_id = ANY(p_sucursal_ids)
      AND s.year_month >= to_char(NOW() - INTERVAL '6 months', 'YYYY-MM')
    GROUP BY sm.erp_sucursal_id, s.erp_product_id
  ),

  ventas_total AS (
    SELECT erp_product_id, SUM(ventas_6m) AS ventas_total_6m
    FROM ventas_suc
    GROUP BY erp_product_id
  ),

  necesidades_ponderadas AS (
    SELECT
      n.*,
      COALESCE(vs.ventas_6m, 0) AS ventas_6m,
      CASE
        WHEN vt.ventas_total_6m IS NULL OR vt.ventas_total_6m = 0
          THEN n.reponer::numeric
        ELSE COALESCE(vs.ventas_6m, 0)
      END AS peso_suc
    FROM necesidades n
    LEFT JOIN ventas_suc   vs ON vs.erp_sucursal_id = n.erp_sucursal_id
                             AND vs.erp_product_id   = n.erp_product_id
    LEFT JOIN ventas_total vt ON vt.erp_product_id   = n.erp_product_id
  ),

  totales_por_producto AS (
    SELECT
      n.erp_product_id,
      n.erp_presentacion_id,
      SUM(n.reponer)            AS total_reponer,
      SUM(n.peso_suc)           AS total_pesos,
      COALESCE(b.bodega_pk, 0)  AS bodega_disponible
    FROM necesidades_ponderadas n
    LEFT JOIN bodega b
           ON b.erp_product_id      = n.erp_product_id
          AND b.erp_presentacion_id  = n.erp_presentacion_id
    GROUP BY n.erp_product_id, n.erp_presentacion_id, b.bodega_pk
  ),

  distribucion_floor AS (
    SELECT
      n.erp_sucursal_id,
      n.erp_product_id,
      n.erp_presentacion_id,
      n.stock_pk,
      n.min_qty,
      n.max_qty,
      n.presentacion_tipo,
      n.factor,
      n.reponer,
      n.ventas_6m,
      t.bodega_disponible,
      t.total_reponer,
      -- Fix v7: cuando total_pesos=0 (todos en el partition tienen ventas=0
      -- pero el producto sí vende en otra presentación), cae a distribución
      -- proporcional por reponer. Evita LEAST(x, NULL) = x por NULLIF(0,0).
      CASE
        WHEN t.bodega_disponible <= 0               THEN 0
        WHEN t.bodega_disponible >= t.total_reponer THEN n.reponer
        WHEN t.total_pesos = 0 THEN
          LEAST(
            n.reponer,
            FLOOR(t.bodega_disponible * n.reponer::numeric / NULLIF(t.total_reponer, 0))
          )::integer
        ELSE
          LEAST(
            n.reponer,
            FLOOR(t.bodega_disponible * n.peso_suc / t.total_pesos)
          )::integer
      END AS asignado_floor,
      CASE
        WHEN t.bodega_disponible <= 0 OR t.bodega_disponible >= t.total_reponer
          THEN 0::numeric
        WHEN t.total_pesos = 0 THEN
          LEAST(
            n.reponer::numeric,
            t.bodega_disponible * n.reponer::numeric / NULLIF(t.total_reponer, 0)
          )
        ELSE
          LEAST(
            n.reponer::numeric,
            t.bodega_disponible * n.peso_suc / t.total_pesos
          )
      END AS quota_real
    FROM necesidades_ponderadas n
    JOIN totales_por_producto t
      ON t.erp_product_id      = n.erp_product_id
     AND t.erp_presentacion_id = n.erp_presentacion_id
  ),

  distribucion_lr AS (
    SELECT
      df.*,
      GREATEST(0,
        FLOOR(df.bodega_disponible)::integer
        - SUM(df.asignado_floor) OVER (
            PARTITION BY df.erp_product_id, df.erp_presentacion_id
          )
      ) AS sobrante,
      ROW_NUMBER() OVER (
        PARTITION BY df.erp_product_id, df.erp_presentacion_id
        ORDER BY (df.quota_real - df.asignado_floor) DESC, df.erp_sucursal_id
      ) AS rn_fraccion
    FROM distribucion_floor df
  ),

  distribucion AS (
    SELECT
      lr.erp_sucursal_id,
      lr.erp_product_id,
      lr.erp_presentacion_id,
      lr.stock_pk,
      lr.min_qty,
      lr.max_qty,
      lr.presentacion_tipo,
      lr.factor,
      lr.reponer,
      lr.ventas_6m,
      lr.bodega_disponible,
      CASE
        WHEN lr.bodega_disponible <= 0 OR lr.bodega_disponible >= lr.total_reponer
          THEN lr.asignado_floor
        WHEN lr.reponer > lr.asignado_floor AND lr.rn_fraccion <= lr.sobrante
          THEN lr.asignado_floor + 1
        ELSE lr.asignado_floor
      END AS asignado_raw
    FROM distribucion_lr lr
  ),

  con_reglas AS (
    SELECT
      d.erp_sucursal_id,
      d.erp_product_id,
      d.erp_presentacion_id,
      d.stock_pk,
      d.min_qty,
      d.max_qty,
      d.presentacion_tipo,
      d.factor,
      d.reponer,
      d.ventas_6m,
      d.bodega_disponible,
      d.asignado_raw,
      (dr.erp_product_id IS NOT NULL)  AS tiene_regla,
      dr.multiplo                       AS regla_multiplo,
      dr.blister                        AS regla_blister,
      COALESCE(dr.solo_cajas, false)    AS regla_solo_cajas,
      CASE
        WHEN d.asignado_raw <= 0 OR d.bodega_disponible <= 0 THEN 0
        ELSE (
          FLOOR(
            FLOOR(d.asignado_raw::numeric / COALESCE(dr.multiplo, 1))
            * COALESCE(dr.multiplo, 1)::numeric
            / COALESCE(dr.blister, 1)
          ) * COALESCE(dr.blister, 1)
        )::integer
      END AS asignado_final
    FROM distribucion d
    LEFT JOIN dispatch_rules dr ON dr.erp_product_id = d.erp_product_id
  )

  SELECT
    cr.erp_sucursal_id,
    cr.erp_product_id,
    cr.erp_presentacion_id,
    p.nombre::text                                         AS product_name,
    cr.presentacion_tipo::text,
    cr.factor,
    ROUND(cr.stock_pk, 2)                                  AS stock_packs,
    cr.min_qty,
    cr.max_qty,
    cr.reponer::integer                                    AS cantidad_reponer,
    ROUND(cr.bodega_disponible, 2)                         AS bodega_stock_packs,
    cr.asignado_final                                      AS cantidad_asignada,
    (cr.bodega_disponible <= 0)                            AS sin_stock,
    (cr.bodega_disponible > 0
     AND cr.asignado_final = 0
     AND cr.reponer > 0)                                   AS revision_minmax,
    LEAST(100,
      ROUND((cr.reponer::numeric / NULLIF(cr.max_qty, 0)) * 100)
    )::integer                                             AS urgencia_pct,
    COALESCE(cr.tiene_regla, false)                        AS tiene_regla_despacho,
    cr.regla_multiplo,
    cr.regla_blister,
    cr.regla_solo_cajas,
    COALESCE(p.es_antibiotico, false)                      AS es_antibiotico,
    cr.ventas_6m,
    (
      SELECT jsonb_agg(
        jsonb_build_object(
          'lote',              lot.lote,
          'fecha_vencimiento', lot.fecha_vencimiento,
          'packs',             FLOOR(lot.total_und::numeric / NULLIF(cr.factor, 0))
        )
        ORDER BY lot.fecha_vencimiento ASC NULLS LAST, lot.lote ASC
      )
      FROM (
        SELECT
          inv2.lote,
          inv2.fecha_vencimiento,
          SUM(inv2.cantidad) AS total_und
        FROM inventory inv2
        WHERE inv2.erp_sucursal_id = 6
          AND inv2.erp_product_id  = cr.erp_product_id
          AND inv2.is_vencidos     = false
          AND inv2.cantidad        > 0
        GROUP BY inv2.lote, inv2.fecha_vencimiento
        HAVING FLOOR(SUM(inv2.cantidad)::numeric / NULLIF(cr.factor, 0)) > 0
      ) lot
    )                                                      AS lotes_bodega

  FROM con_reglas cr
  JOIN products p ON p.id = cr.erp_product_id
  ORDER BY cr.erp_sucursal_id, urgencia_pct DESC, p.nombre;
$$;

GRANT EXECUTE ON FUNCTION get_pedido_preview(integer[]) TO authenticated;
