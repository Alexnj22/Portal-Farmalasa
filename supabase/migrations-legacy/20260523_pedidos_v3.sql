-- ============================================================
-- Pedidos v3: products_with_lab view + get_pedido_preview con
--             es_antibiotico y lotes_bodega FEFO
-- ============================================================

-- ─── 1. Vista products_with_lab ──────────────────────────────────────────────
-- Permite ordenar por laboratorio en PostgREST sin JOINs manuales.
CREATE OR REPLACE VIEW products_with_lab AS
SELECT
    p.id,
    p.nombre,
    p.es_antibiotico,
    p.activo,
    p.laboratorio_id,
    l.nombre AS laboratorio_nombre
FROM products p
LEFT JOIN laboratorios l ON l.id = p.laboratorio_id;

GRANT SELECT ON products_with_lab TO authenticated;


-- ─── 2. Rewrite get_pedido_preview con es_antibiotico + lotes FEFO ───────────
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
  lotes_bodega         jsonb     -- [{lote, fecha_vencimiento, packs}] FEFO
)
LANGUAGE sql
SECURITY DEFINER
AS $$
  WITH

  stock_sucursal AS (
    SELECT
      em.erp_sucursal_id,
      em.erp_product_id,
      em.erp_presentacion_id,
      em.min_qty,
      em.max_qty,
      pr.tipo                                     AS presentacion_tipo,
      COALESCE(pr.factor, 1)::numeric             AS factor,
      ROUND(
        COALESCE(
          SUM(inv.cantidad) FILTER (WHERE inv.is_vencidos = false),
          0
        )::numeric / NULLIF(COALESCE(pr.factor, 1)::numeric, 0),
        2
      )                                            AS stock_pk
    FROM erp_minmax em
    JOIN presentaciones pr ON pr.id = em.erp_presentacion_id
    LEFT JOIN inventory inv
           ON inv.erp_sucursal_id   = em.erp_sucursal_id
          AND inv.erp_product_id    = em.erp_product_id
    WHERE em.erp_sucursal_id = ANY(p_sucursal_ids)
      AND em.max_qty > 0
    GROUP BY
      em.erp_sucursal_id, em.erp_product_id, em.erp_presentacion_id,
      em.min_qty, em.max_qty, pr.tipo, pr.factor
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
      em.erp_product_id,
      em.erp_presentacion_id,
      COALESCE(pr.factor, 1)::numeric AS factor,
      COALESCE(
        SUM(inv.cantidad) FILTER (WHERE inv.is_vencidos = false),
        0
      )::numeric AS bodega_units_ind
    FROM erp_minmax em
    JOIN presentaciones pr ON pr.id = em.erp_presentacion_id
    LEFT JOIN inventory inv
           ON inv.erp_sucursal_id   = 6
          AND inv.erp_product_id    = em.erp_product_id
    WHERE em.erp_sucursal_id = 6
    GROUP BY em.erp_product_id, em.erp_presentacion_id, pr.factor
  ),

  bodega AS (
    SELECT
      erp_product_id,
      erp_presentacion_id,
      ROUND(bodega_units_ind / NULLIF(factor, 0), 2) AS bodega_pk
    FROM bodega_raw
  ),

  totales_por_producto AS (
    SELECT
      n.erp_product_id,
      n.erp_presentacion_id,
      SUM(n.reponer)            AS total_reponer,
      COALESCE(b.bodega_pk, 0) AS bodega_disponible
    FROM necesidades n
    LEFT JOIN bodega b
           ON b.erp_product_id     = n.erp_product_id
          AND b.erp_presentacion_id = n.erp_presentacion_id
    GROUP BY n.erp_product_id, n.erp_presentacion_id, b.bodega_pk
  ),

  distribucion AS (
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
      t.bodega_disponible,
      CASE
        WHEN t.bodega_disponible <= 0 THEN 0
        WHEN t.bodega_disponible >= t.total_reponer THEN n.reponer
        ELSE FLOOR(
          t.bodega_disponible
          * (n.reponer::numeric / NULLIF(t.total_reponer, 0))
        )
      END::integer AS asignado_raw
    FROM necesidades n
    JOIN totales_por_producto t
      ON t.erp_product_id     = n.erp_product_id
     AND t.erp_presentacion_id = n.erp_presentacion_id
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

    -- Antibiótico desde tabla products
    COALESCE(p.es_antibiotico, false)                      AS es_antibiotico,

    -- Lotes de Bodega FEFO: [{lote, fecha_vencimiento, packs}] de menor a mayor vencimiento
    -- Si no hay stock en un lote pasa al siguiente (multi-lote complementario)
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
