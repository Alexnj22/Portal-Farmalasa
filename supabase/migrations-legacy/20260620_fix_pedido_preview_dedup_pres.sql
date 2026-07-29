-- get_pedido_preview v22: fix presentaciones duplicadas
-- Causa: product_precios tiene N filas activas con mismo tipo+factor pero distinto id_presentacion.
-- La query anterior (v21) emitía una fila por presentación activa, inflando 710 filas extra en suc 1.
-- Fix: inv_agg pre-agrega unidades por (suc, producto) y DISTINCT ON elige UNA presentación
-- por (erp_sucursal_id, erp_product_id) — la de mayor factor donde ROUND(max/factor)>=1.

CREATE OR REPLACE FUNCTION public.get_pedido_preview(
  p_sucursal_ids         integer[],
  p_target_ids           integer[] DEFAULT NULL
)
RETURNS TABLE (
  erp_sucursal_id          integer,
  erp_product_id           integer,
  erp_presentacion_id      integer,
  product_name             text,
  laboratorio              text,
  presentacion_tipo        text,
  factor                   numeric,
  stock_packs              numeric,
  min_qty                  integer,
  max_qty                  integer,
  cantidad_reponer         integer,
  bodega_stock_packs       numeric,
  cantidad_asignada        integer,
  sin_stock                boolean,
  revision_minmax          boolean,
  urgencia_pct             integer,
  tiene_regla_despacho     boolean,
  regla_multiplo           smallint,
  regla_blister            smallint,
  regla_solo_cajas         boolean,
  regla_multiplo_unidades  smallint,
  es_antibiotico           boolean,
  ventas_6m                numeric,
  lotes_bodega             jsonb,
  dispatch_tipo            text,
  dispatch_factor          numeric
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

  -- Pre-agrega unidades por (suc, producto) para no multiplicar filas al JOIN con product_precios
  inv_agg AS (
    SELECT erp_sucursal_id, erp_product_id,
      COALESCE(SUM(unidades) FILTER (WHERE is_vencidos = false), 0)::numeric AS units_vivos
    FROM inv_dedup
    GROUP BY erp_sucursal_id, erp_product_id
  ),

  -- Una sola fila por (suc, producto): presentación de mayor factor donde ROUND(max/factor)>=1
  stock_sucursal AS (
    SELECT DISTINCT ON (psp.erp_sucursal_id, psp.erp_product_id)
      psp.erp_sucursal_id,
      psp.erp_product_id,
      pp.id_presentacion                      AS erp_presentacion_id,
      ROUND(
        COALESCE(psp.manual_min, psp.min_units, 0)::numeric
        / NULLIF(pp.factor::numeric, 0)
      )::integer                              AS min_qty,
      ROUND(
        COALESCE(psp.manual_max, psp.max_units, 0)::numeric
        / NULLIF(pp.factor::numeric, 0)
      )::integer                              AS max_qty,
      pr.tipo                                 AS presentacion_tipo,
      pp.factor::numeric                      AS factor,
      ROUND(
        COALESCE(ia.units_vivos, 0)
        / NULLIF(pp.factor::numeric, 0), 2
      )                                       AS stock_pk
    FROM product_stock_params psp
    JOIN product_precios pp
         ON pp.product_id = psp.erp_product_id AND pp.activo = true
    JOIN presentaciones pr ON pr.id = pp.id_presentacion
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

  raw_totals AS (
    SELECT erp_product_id, erp_presentacion_id,
      SUM(asignado_raw)::numeric AS total_raw_assigned
    FROM distribucion
    GROUP BY erp_product_id, erp_presentacion_id
  ),

  caja_factor_map AS (
    SELECT DISTINCT ON (pp.product_id)
      pp.product_id,
      pp.factor AS caja_factor
    FROM product_precios pp
    JOIN presentaciones pr ON pr.id = pp.id_presentacion
    WHERE pr.tipo ILIKE 'CAJA%' OR pr.tipo ILIKE 'BOLSA%'
    ORDER BY pp.product_id, pp.factor DESC
  ),

  dispatch_pres_factor AS (
    SELECT DISTINCT ON (dr.erp_product_id)
      dr.erp_product_id,
      pp.factor::numeric                         AS dp_factor,
      COALESCE(dr.dispatch_multiplo, 1)::numeric AS dp_multiplo,
      pres.tipo                                  AS dp_tipo
    FROM dispatch_rules dr
    JOIN product_precios pp
      ON pp.product_id      = dr.erp_product_id
     AND pp.id_presentacion = dr.dispatch_id_presentacion
    JOIN presentaciones pres ON pres.id = dr.dispatch_id_presentacion
    WHERE dr.dispatch_id_presentacion IS NOT NULL
    ORDER BY dr.erp_product_id, pp.factor DESC
  ),

  auto_pres_factor AS (
    SELECT DISTINCT ON (pp.product_id)
      pp.product_id,
      pp.factor::numeric AS ap_factor,
      pres.tipo          AS ap_tipo
    FROM product_precios pp
    JOIN presentaciones pres ON pres.id = pp.id_presentacion
    WHERE pp.factor > 1
    ORDER BY pp.product_id, pp.factor DESC
  ),

  con_reglas_unit AS (
    SELECT d.*,
      rt.total_raw_assigned,
      d.asignado_raw::numeric
        + GREATEST(0, d.bodega_disponible - rt.total_raw_assigned)
          * d.asignado_raw::numeric / NULLIF(rt.total_raw_assigned, 0)
        AS max_asignable,
      (dr.erp_product_id IS NOT NULL) AS tiene_regla,
      dr.multiplo           AS regla_multiplo,
      dr.blister            AS regla_blister,
      COALESCE(dr.solo_cajas, false) AS regla_solo_cajas,
      dr.multiplo_unidades  AS regla_multiplo_unidades,
      COALESCE(dpf.dp_tipo,   CASE WHEN dr.erp_product_id IS NULL THEN apf.ap_tipo   END) AS dp_tipo,
      COALESCE(dpf.dp_factor, CASE WHEN dr.erp_product_id IS NULL THEN apf.ap_factor END) AS dp_factor,
      dpf.dp_multiplo,
      cfm.caja_factor,
      CASE
        WHEN dpf.dp_factor IS NOT NULL THEN dpf.dp_factor * dpf.dp_multiplo
        WHEN COALESCE(dr.solo_cajas, false) = true
             AND dr.multiplo IS NULL AND dr.blister IS NULL AND dr.multiplo_unidades IS NULL
             AND d.presentacion_tipo != 'CAJA' AND cfm.caja_factor IS NOT NULL
          THEN cfm.caja_factor
        WHEN dr.multiplo IS NOT NULL THEN dr.multiplo * d.factor
        WHEN dr.blister IS NOT NULL THEN dr.blister * d.factor
        WHEN dr.multiplo_unidades IS NOT NULL THEN dr.multiplo_unidades::numeric
        WHEN dr.erp_product_id IS NULL AND apf.ap_factor IS NOT NULL THEN apf.ap_factor
        ELSE NULL
      END AS unit_base
    FROM distribucion d
    LEFT JOIN dispatch_rules       dr  ON dr.erp_product_id = d.erp_product_id
    LEFT JOIN caja_factor_map      cfm ON cfm.product_id    = d.erp_product_id
    LEFT JOIN dispatch_pres_factor dpf ON dpf.erp_product_id = d.erp_product_id
    LEFT JOIN auto_pres_factor     apf ON apf.product_id    = d.erp_product_id
    JOIN      raw_totals           rt  ON rt.erp_product_id = d.erp_product_id
                                      AND rt.erp_presentacion_id = d.erp_presentacion_id
  ),

  con_reglas_uncapped AS (
    SELECT cu.*,
      CASE
        WHEN cu.asignado_raw <= 0 OR cu.bodega_disponible <= 0 THEN 0
        WHEN cu.unit_base IS NULL THEN cu.asignado_raw
        ELSE GREATEST(0,
          (
            FLOOR(cu.asignado_raw::numeric * cu.factor / cu.unit_base)
            + CASE WHEN
                (cu.asignado_raw::numeric * cu.factor)
                - FLOOR(cu.asignado_raw::numeric * cu.factor / cu.unit_base) * cu.unit_base
                >= 0.40 * cu.unit_base
              THEN 1 ELSE 0 END
          ) * cu.unit_base / NULLIF(cu.factor, 0)
        )::integer
      END AS asignado_uncapped
    FROM con_reglas_unit cu
  ),

  con_reglas AS (
    SELECT
      cu.erp_sucursal_id, cu.erp_product_id, cu.erp_presentacion_id,
      cu.stock_pk, cu.min_qty, cu.max_qty, cu.presentacion_tipo, cu.factor,
      cu.reponer, cu.ventas_6m, cu.bodega_disponible,
      cu.tiene_regla,
      cu.regla_multiplo, cu.regla_blister, cu.regla_solo_cajas, cu.regla_multiplo_unidades,
      CASE
        WHEN cu.asignado_uncapped <= cu.max_asignable THEN cu.dp_tipo
        WHEN cu.unit_base IS NOT NULL AND FLOOR(cu.max_asignable * cu.factor / cu.unit_base) >= 1
          THEN cu.dp_tipo
        ELSE cu.presentacion_tipo
      END AS dispatch_tipo,
      CASE
        WHEN cu.asignado_uncapped <= cu.max_asignable THEN cu.dp_factor
        WHEN cu.unit_base IS NOT NULL AND FLOOR(cu.max_asignable * cu.factor / cu.unit_base) >= 1
          THEN cu.dp_factor
        ELSE cu.factor
      END AS dispatch_factor,
      CASE
        WHEN cu.asignado_uncapped <= cu.max_asignable THEN cu.asignado_uncapped
        WHEN cu.unit_base IS NOT NULL AND FLOOR(cu.max_asignable * cu.factor / cu.unit_base) >= 1
          THEN (FLOOR(cu.max_asignable * cu.factor / cu.unit_base) * cu.unit_base / NULLIF(cu.factor, 0))::integer
        ELSE cu.asignado_raw
      END AS asignado_final
    FROM con_reglas_uncapped cu
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
    p.nombre::text                    AS product_name,
    lab.nombre::text                  AS laboratorio,
    cr.presentacion_tipo::text,       cr.factor,
    ROUND(cr.stock_pk, 2)             AS stock_packs,
    cr.min_qty, cr.max_qty,
    cr.reponer::integer               AS cantidad_reponer,
    ROUND(cr.bodega_disponible, 2)    AS bodega_stock_packs,
    cr.asignado_final                 AS cantidad_asignada,
    (cr.bodega_disponible <= 0)                                       AS sin_stock,
    (cr.bodega_disponible > 0 AND cr.asignado_final = 0 AND cr.reponer > 0) AS revision_minmax,
    LEAST(100, ROUND((cr.reponer::numeric / NULLIF(cr.max_qty, 0)) * 100))::integer AS urgencia_pct,
    COALESCE(cr.tiene_regla, false)   AS tiene_regla_despacho,
    cr.regla_multiplo,
    cr.regla_blister,
    cr.regla_solo_cajas,
    cr.regla_multiplo_unidades,
    COALESCE(p.es_antibiotico, false) AS es_antibiotico,
    cr.ventas_6m,
    lps.lotes_seq                     AS lotes_bodega,
    cr.dispatch_tipo,
    cr.dispatch_factor
  FROM con_reglas cr
  JOIN products p ON p.id = cr.erp_product_id
  LEFT JOIN laboratorios lab        ON lab.id = p.laboratorio_id
  LEFT JOIN lotes_por_sucursal lps
         ON lps.erp_sucursal_id      = cr.erp_sucursal_id
        AND lps.erp_product_id       = cr.erp_product_id
        AND lps.erp_presentacion_id  = cr.erp_presentacion_id
  WHERE cr.erp_sucursal_id = ANY(COALESCE(p_target_ids, p_sucursal_ids))
  ORDER BY cr.erp_sucursal_id, urgencia_pct DESC, p.nombre;
$function$;

GRANT EXECUTE ON FUNCTION public.get_pedido_preview(integer[], integer[]) TO authenticated;
