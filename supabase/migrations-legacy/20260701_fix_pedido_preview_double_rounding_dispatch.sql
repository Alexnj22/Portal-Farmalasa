-- Fix: get_pedido_preview aplicaba el umbral 40% dos veces para productos con
-- dispatch_rules, perdiendo precision. La CTE _necesidades redondeaba need_u a
-- "reponer" (packs del factor de presentacion, ej. SOBRE=4) usando un umbral 40%
-- calibrado al factor chico, ANTES de conocer el unit_base real de la regla
-- (factor x multiplo, ej. 4x3=12). Esa perdida de precision hacia que el segundo
-- chequeo (reponer*factor vs unit_base) fallara en casos que si superaban el 40%
-- real (ej. ANARA X 50 SOBRES: necesidad real 5 unidades, unit_base=12 -> 41.7%
-- deberia redondear a la regla completa, pero el reponer ya redondeado a 4
-- unidades quedaba en 33% y no despachaba nada).
--
-- Fix: se agrega need_u (la necesidad real sin redondear) a _necesidades y se
-- propaga hasta _con_reglas. La decision de umbral 40% contra unit_base ahora usa
-- need_u en vez de reponer*factor, tanto en asignado_uncapped (solo cuando la
-- sucursal no esta limitada por bodega, es decir asignado_raw = reponer, para no
-- afectar la logica de distribucion entre sucursales cuando bodega es escasa)
-- como en la clasificacion final revision_minmax/agotamiento (que no depende de
-- bodega). reponer, el filtro de entrada de _necesidades y la distribucion
-- proporcional entre sucursales quedan sin cambios.
--
-- Verificado contra datos reales: 16 de 1886 filas con dispatch_rules cambian
-- (delta neto -5 unidades), todas correcciones del mismo bug de doble redondeo.

CREATE OR REPLACE FUNCTION public.get_pedido_preview(p_sucursal_ids integer[], p_target_ids integer[] DEFAULT NULL::integer[])
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
BEGIN
  SET LOCAL work_mem = '32MB';

  CREATE TEMP TABLE _inv_agg ON COMMIT DROP AS
  SELECT i.erp_sucursal_id, i.erp_product_id,
    COALESCE(SUM(i.cantidad::numeric * COALESCE(vf.factor, NULLIF(split_part(LOWER(COALESCE(i.detalle,'')), 'x', 2), '')::numeric, 1)) FILTER (WHERE NOT i.is_vencidos), 0) AS units_vivos
  FROM inventory i
  LEFT JOIN mv_product_factor vf ON vf.product_id = i.erp_product_id AND vf.pres_key = UPPER(TRIM(i.presentacion))
  WHERE i.erp_sucursal_id = ANY(p_sucursal_ids)
  GROUP BY i.erp_sucursal_id, i.erp_product_id;
  CREATE INDEX ON _inv_agg(erp_sucursal_id, erp_product_id);

  CREATE TEMP TABLE _inv_bodega ON COMMIT DROP AS
  SELECT i.erp_product_id, i.lote, i.fecha_vencimiento,
    SUM(i.cantidad::numeric * COALESCE(vf.factor, NULLIF(split_part(LOWER(COALESCE(i.detalle,'')), 'x', 2), '')::numeric, 1)) AS unidades
  FROM inventory i
  LEFT JOIN mv_product_factor vf ON vf.product_id = i.erp_product_id AND vf.pres_key = UPPER(TRIM(i.presentacion))
  JOIN erp_sucursal_map bm ON bm.es_bodega AND i.erp_sucursal_id = bm.erp_sucursal_id
  WHERE NOT i.is_vencidos
  GROUP BY i.erp_product_id, i.lote, i.fecha_vencimiento;
  CREATE INDEX ON _inv_bodega(erp_product_id);

  CREATE TEMP TABLE _ventas_suc ON COMMIT DROP AS
  SELECT sm.erp_sucursal_id, s.erp_product_id, SUM(s.cantidad)::numeric AS ventas_6m
  FROM product_sales_monthly_agg s
  JOIN erp_sucursal_map sm ON sm.branch_id = s.branch_id AND NOT sm.es_bodega
  WHERE sm.erp_sucursal_id = ANY(p_sucursal_ids)
    AND s.year_month >= to_char(NOW() - INTERVAL '6 months', 'YYYY-MM')
  GROUP BY sm.erp_sucursal_id, s.erp_product_id;
  CREATE INDEX ON _ventas_suc(erp_sucursal_id, erp_product_id);

  CREATE TEMP TABLE _necesidades ON COMMIT DROP AS
  WITH pref_factor AS (
    SELECT dr.erp_product_id, pp.factor AS pref
    FROM dispatch_rules dr
    JOIN product_precios pp ON pp.product_id = dr.erp_product_id AND pp.id_presentacion = dr.dispatch_id_presentacion
    WHERE dr.dispatch_id_presentacion IS NOT NULL
  ),
  stock_sucursal AS (
    SELECT DISTINCT ON (psp.erp_sucursal_id, psp.erp_product_id)
      psp.erp_sucursal_id, psp.erp_product_id, pp.id_presentacion AS erp_presentacion_id,
      ROUND(COALESCE(psp.manual_min, psp.min_units, 0)::numeric / NULLIF(pp.factor::numeric, 0))::integer AS min_qty,
      ROUND(COALESCE(psp.manual_max, psp.max_units, 0)::numeric / NULLIF(pp.factor::numeric, 0))::integer AS max_qty,
      COALESCE(psp.manual_max, psp.max_units, 0)::integer AS max_units_raw,
      COALESCE(ia.units_vivos, 0) AS stock_units_raw,
      pr.tipo AS presentacion_tipo, pp.factor::numeric AS factor,
      ROUND(COALESCE(ia.units_vivos, 0) / NULLIF(pp.factor::numeric, 0), 2) AS stock_pk
    FROM product_stock_params psp
    JOIN product_precios pp ON pp.product_id = psp.erp_product_id AND pp.activo = true
    JOIN presentaciones pr ON pr.id = pp.id_presentacion
    LEFT JOIN _inv_agg ia ON ia.erp_sucursal_id = psp.erp_sucursal_id AND ia.erp_product_id = psp.erp_product_id
    LEFT JOIN pref_factor pf ON pf.erp_product_id = psp.erp_product_id
    WHERE psp.erp_sucursal_id = ANY(p_sucursal_ids)
      AND COALESCE(psp.manual_max, psp.max_units, 0) > 0
      AND ROUND(COALESCE(psp.manual_max, psp.max_units, 0)::numeric / NULLIF(pp.factor::numeric, 0)) >= 1
    ORDER BY psp.erp_sucursal_id, psp.erp_product_id,
      (pp.factor = COALESCE(pf.pref, -1)) DESC,
      CASE WHEN pf.pref IS NULL THEN (pp.factor > 1)::int ELSE 0 END DESC,
      pp.factor ASC, pp.id_presentacion
  )
  SELECT ss.*, nu.need_u,
    (FLOOR(need_u::numeric / NULLIF(ss.factor, 0))
     + CASE WHEN (need_u::numeric % NULLIF(ss.factor, 0)) >= 0.40 * ss.factor THEN 1 ELSE 0 END
    )::integer AS reponer
  FROM stock_sucursal ss
  CROSS JOIN LATERAL (SELECT GREATEST(0, ss.max_units_raw - FLOOR(ss.stock_units_raw))::integer AS need_u) nu
  WHERE nu.need_u > 0
    AND (FLOOR(nu.need_u::numeric / NULLIF(ss.factor, 0)) + CASE WHEN (nu.need_u::numeric % NULLIF(ss.factor, 0)) >= 0.40 * ss.factor THEN 1 ELSE 0 END) > 0;
  CREATE INDEX ON _necesidades(erp_product_id, erp_presentacion_id);
  CREATE INDEX ON _necesidades(erp_sucursal_id, erp_product_id);

  CREATE TEMP TABLE _bodega ON COMMIT DROP AS
  WITH pres_units_needed AS (
    SELECT erp_product_id, erp_presentacion_id, factor, SUM(reponer)::numeric * factor AS units_needed
    FROM _necesidades GROUP BY erp_product_id, erp_presentacion_id, factor
  ),
  pres_units_total AS (
    SELECT erp_product_id, SUM(units_needed) AS units_total FROM pres_units_needed GROUP BY erp_product_id
  ),
  pending_committed AS (
    SELECT pi.erp_product_id, SUM(pi.cantidad_asignada::numeric * COALESCE(pp.factor, 1)) AS committed_units
    FROM pedido_items pi
    JOIN pedidos pd ON pd.id = pi.pedido_id
    JOIN pedido_sucursal_status pss ON pss.pedido_id = pi.pedido_id AND pss.erp_sucursal_id = pi.erp_sucursal_id
    LEFT JOIN product_precios pp ON pp.product_id = pi.erp_product_id AND pp.id_presentacion = pi.erp_presentacion_id
    WHERE pi.status = 'pendiente' AND pd.status NOT IN ('anulado','completado') AND pss.finalizado_at IS NULL
    GROUP BY pi.erp_product_id
  )
  SELECT pu.erp_product_id, pu.erp_presentacion_id,
    ROUND(GREATEST(0, COALESCE(SUM(ib.unidades), 0) - COALESCE(MAX(pc.committed_units), 0))
      * COALESCE(pu.units_needed / NULLIF(pt.units_total, 0), 1.0)
      / NULLIF(pu.factor, 0), 2) AS bodega_pk
  FROM pres_units_needed pu
  LEFT JOIN _inv_bodega ib ON ib.erp_product_id = pu.erp_product_id
  LEFT JOIN pres_units_total pt ON pt.erp_product_id = pu.erp_product_id
  LEFT JOIN pending_committed pc ON pc.erp_product_id = pu.erp_product_id
  GROUP BY pu.erp_product_id, pu.erp_presentacion_id, pu.factor, pu.units_needed, pt.units_total;
  CREATE INDEX ON _bodega(erp_product_id, erp_presentacion_id);

  CREATE TEMP TABLE _distribucion ON COMMIT DROP AS
  WITH ventas_total AS (
    SELECT erp_product_id, SUM(ventas_6m) AS ventas_total_6m FROM _ventas_suc GROUP BY erp_product_id
  ),
  distrib_totals AS (
    SELECT n.erp_product_id, n.erp_presentacion_id,
      SUM(n.reponer) AS total_reponer,
      SUM(CASE WHEN COALESCE(vt.ventas_total_6m,0)=0 THEN n.reponer::numeric ELSE COALESCE(vs.ventas_6m,0) END) AS total_pesos,
      COALESCE(b.bodega_pk, 0) AS bodega_disponible
    FROM _necesidades n
    LEFT JOIN _ventas_suc vs ON vs.erp_sucursal_id=n.erp_sucursal_id AND vs.erp_product_id=n.erp_product_id
    LEFT JOIN ventas_total vt ON vt.erp_product_id=n.erp_product_id
    LEFT JOIN _bodega b ON b.erp_product_id=n.erp_product_id AND b.erp_presentacion_id=n.erp_presentacion_id
    GROUP BY n.erp_product_id, n.erp_presentacion_id, b.bodega_pk
  ),
  distrib_floor AS (
    SELECT n.erp_sucursal_id, n.erp_product_id, n.erp_presentacion_id, n.stock_pk, n.min_qty, n.max_qty, n.presentacion_tipo, n.factor, n.reponer, n.need_u,
      COALESCE(vs.ventas_6m, 0) AS ventas_6m, t.bodega_disponible, t.total_reponer,
      CASE WHEN COALESCE(vt.ventas_total_6m,0)=0 THEN n.reponer::numeric ELSE COALESCE(vs.ventas_6m,0) END AS peso_suc,
      CASE WHEN t.bodega_disponible<=0 OR t.bodega_disponible>=t.total_reponer THEN 0::numeric
        WHEN t.total_pesos=0 THEN LEAST(n.reponer::numeric, t.bodega_disponible*n.reponer::numeric/NULLIF(t.total_reponer,0))
        ELSE LEAST(n.reponer::numeric, t.bodega_disponible*(CASE WHEN COALESCE(vt.ventas_total_6m,0)=0 THEN n.reponer::numeric ELSE COALESCE(vs.ventas_6m,0) END)/t.total_pesos)
      END AS quota_real,
      CASE WHEN t.bodega_disponible<=0 THEN 0
        WHEN t.bodega_disponible>=t.total_reponer THEN n.reponer
        WHEN t.total_pesos=0 THEN LEAST(n.reponer, FLOOR(t.bodega_disponible*n.reponer::numeric/NULLIF(t.total_reponer,0)))::integer
        ELSE LEAST(n.reponer, FLOOR(t.bodega_disponible*(CASE WHEN COALESCE(vt.ventas_total_6m,0)=0 THEN n.reponer::numeric ELSE COALESCE(vs.ventas_6m,0) END)/t.total_pesos))::integer
      END AS asignado_floor
    FROM _necesidades n
    JOIN distrib_totals t ON t.erp_product_id=n.erp_product_id AND t.erp_presentacion_id=n.erp_presentacion_id
    LEFT JOIN _ventas_suc vs ON vs.erp_sucursal_id=n.erp_sucursal_id AND vs.erp_product_id=n.erp_product_id
    LEFT JOIN ventas_total vt ON vt.erp_product_id=n.erp_product_id
  ),
  distrib_lr AS (
    SELECT df.*,
      GREATEST(0, FLOOR(df.bodega_disponible)::integer - SUM(df.asignado_floor) OVER (PARTITION BY df.erp_product_id, df.erp_presentacion_id)) AS sobrante,
      ROW_NUMBER() OVER (PARTITION BY df.erp_product_id, df.erp_presentacion_id ORDER BY (df.quota_real - df.asignado_floor) DESC, df.erp_sucursal_id) AS rn_fraccion
    FROM distrib_floor df
  )
  SELECT lr.erp_sucursal_id, lr.erp_product_id, lr.erp_presentacion_id, lr.stock_pk, lr.min_qty, lr.max_qty, lr.presentacion_tipo, lr.factor, lr.reponer, lr.need_u, lr.ventas_6m, lr.bodega_disponible,
    CASE WHEN lr.bodega_disponible<=0 OR lr.bodega_disponible>=lr.total_reponer THEN lr.asignado_floor
      WHEN lr.reponer>lr.asignado_floor AND lr.rn_fraccion<=lr.sobrante THEN lr.asignado_floor+1
      ELSE lr.asignado_floor END AS asignado_raw
  FROM distrib_lr lr;
  CREATE INDEX ON _distribucion(erp_product_id, erp_presentacion_id);

  CREATE TEMP TABLE _con_reglas_uncapped ON COMMIT DROP AS
  WITH raw_totals AS (
    SELECT erp_product_id, erp_presentacion_id, SUM(asignado_raw)::numeric AS total_raw_assigned
    FROM _distribucion GROUP BY erp_product_id, erp_presentacion_id
  ),
  caja_factor_map AS (
    SELECT DISTINCT ON (pp.product_id) pp.product_id, pp.factor AS caja_factor
    FROM product_precios pp JOIN presentaciones pr ON pr.id = pp.id_presentacion
    WHERE pr.tipo ILIKE 'CAJA%' OR pr.tipo ILIKE 'BOLSA%'
    ORDER BY pp.product_id, pp.factor DESC
  ),
  dispatch_pres_factor AS (
    SELECT DISTINCT ON (dr.erp_product_id) dr.erp_product_id,
      pp.factor::numeric AS dp_factor,
      COALESCE(dr.dispatch_multiplo,1)::numeric AS dp_multiplo,
      COALESCE(dr.dispatch_label, pres.tipo) AS dp_tipo,
      (dr.dispatch_label IS NOT NULL) AS dp_tiene_label,
      CASE WHEN dr.dispatch_label IS NOT NULL THEN pp.factor::numeric * COALESCE(dr.dispatch_multiplo,1)::numeric ELSE pp.factor::numeric END AS dp_display_factor
    FROM dispatch_rules dr
    JOIN product_precios pp ON pp.product_id=dr.erp_product_id AND pp.id_presentacion=dr.dispatch_id_presentacion
    JOIN presentaciones pres ON pres.id=dr.dispatch_id_presentacion
    WHERE dr.dispatch_id_presentacion IS NOT NULL
    ORDER BY dr.erp_product_id, pp.factor DESC
  ),
  auto_pres_factor AS (
    SELECT DISTINCT ON (pp.product_id) pp.product_id, pp.factor::numeric AS ap_factor, pres.tipo AS ap_tipo
    FROM product_precios pp JOIN presentaciones pres ON pres.id=pp.id_presentacion
    WHERE pp.factor > 1 ORDER BY pp.product_id, pp.factor ASC
  ),
  con_reglas_unit AS (
    SELECT d.*, rt.total_raw_assigned,
      d.asignado_raw::numeric + GREATEST(0, d.bodega_disponible - rt.total_raw_assigned) * d.asignado_raw::numeric / NULLIF(rt.total_raw_assigned, 0) AS max_asignable,
      (dr.erp_product_id IS NOT NULL) AS tiene_regla,
      dr.multiplo AS regla_multiplo, dr.blister AS regla_blister,
      COALESCE(dr.solo_cajas, false) AS regla_solo_cajas, dr.multiplo_unidades AS regla_multiplo_unidades,
      COALESCE(dr.caja_especial, false) AS caja_especial,
      dpf.dp_tipo AS dp_tipo,
      dpf.dp_display_factor AS dp_display_factor,
      dpf.dp_factor AS dp_factor,
      dpf.dp_multiplo AS dp_multiplo,
      COALESCE(dpf.dp_tiene_label, false) AS tiene_dispatch_label,
      caja_factor_map.caja_factor,
      CASE
        WHEN dpf.dp_factor IS NOT NULL THEN dpf.dp_factor * dpf.dp_multiplo
        WHEN COALESCE(dr.solo_cajas,false)=true AND dr.multiplo IS NULL AND dr.blister IS NULL AND dr.multiplo_unidades IS NULL AND d.presentacion_tipo!='CAJA' AND caja_factor_map.caja_factor IS NOT NULL THEN caja_factor_map.caja_factor
        WHEN dr.multiplo IS NOT NULL THEN dr.multiplo * d.factor
        WHEN dr.blister IS NOT NULL THEN dr.blister * d.factor
        WHEN dr.multiplo_unidades IS NOT NULL THEN dr.multiplo_unidades::numeric
        WHEN dr.erp_product_id IS NULL AND apf.ap_factor IS NOT NULL THEN apf.ap_factor
        ELSE NULL
      END AS unit_base
    FROM _distribucion d
    JOIN raw_totals rt ON rt.erp_product_id=d.erp_product_id AND rt.erp_presentacion_id=d.erp_presentacion_id
    LEFT JOIN dispatch_rules dr ON dr.erp_product_id=d.erp_product_id
    LEFT JOIN caja_factor_map ON caja_factor_map.product_id=d.erp_product_id
    LEFT JOIN dispatch_pres_factor dpf ON dpf.erp_product_id=d.erp_product_id
    LEFT JOIN auto_pres_factor apf ON apf.product_id=d.erp_product_id
  )
  SELECT cu.*,
    CASE
      WHEN cu.asignado_raw<=0 OR cu.bodega_disponible<=0 THEN 0
      WHEN cu.unit_base IS NULL THEN cu.asignado_raw
      ELSE
        CASE
          WHEN (FLOOR(eu.units/cu.unit_base)
               + CASE WHEN (eu.units - FLOOR(eu.units/cu.unit_base)*cu.unit_base) >= 0.40*cu.unit_base THEN 1 ELSE 0 END) > 0
          THEN GREATEST(0, (FLOOR(eu.units/cu.unit_base)
               + CASE WHEN (eu.units - FLOOR(eu.units/cu.unit_base)*cu.unit_base) >= 0.40*cu.unit_base THEN 1 ELSE 0 END)
               * cu.unit_base / NULLIF(cu.factor,0))::integer
          WHEN NOT cu.tiene_regla OR cu.bodega_disponible * cu.factor < cu.unit_base
          THEN cu.asignado_raw
          ELSE 0
        END
    END AS asignado_uncapped
  FROM con_reglas_unit cu
  CROSS JOIN LATERAL (
    -- Si esta sucursal no esta limitada por bodega (recibe su reponer completo),
    -- usamos need_u (unidades reales, sin redondeo previo). Si esta limitada por
    -- bodega (asignado_raw < reponer, competencia con otras sucursales), se
    -- mantiene el comportamiento original basado en asignado_raw*factor.
    SELECT CASE WHEN cu.asignado_raw = cu.reponer THEN cu.need_u::numeric ELSE cu.asignado_raw::numeric*cu.factor END AS units
  ) eu;
  CREATE INDEX ON _con_reglas_uncapped(erp_product_id, erp_presentacion_id);

  CREATE TEMP TABLE _con_reglas ON COMMIT DROP AS
  WITH box_totals_per_product AS (
    SELECT DISTINCT ON (cu.erp_product_id, cu.erp_presentacion_id)
      cu.erp_product_id, cu.erp_presentacion_id, cu.unit_base, cu.factor, cu.bodega_disponible,
      FLOOR(cu.bodega_disponible*cu.factor/NULLIF(cu.unit_base,0))::integer AS cajas_bodega
    FROM _con_reglas_uncapped cu
    WHERE cu.unit_base IS NOT NULL AND cu.bodega_disponible>0 AND FLOOR(cu.bodega_disponible*cu.factor/NULLIF(cu.unit_base,0))>=1
    ORDER BY cu.erp_product_id, cu.erp_presentacion_id
  ),
  box_cajas_case12 AS (
    SELECT cu.erp_product_id, cu.erp_presentacion_id,
      SUM(CASE WHEN cu.asignado_uncapped<=cu.max_asignable THEN CEIL(cu.asignado_uncapped*cu.factor/NULLIF(bt.unit_base,0))
               WHEN FLOOR(cu.max_asignable*cu.factor/NULLIF(bt.unit_base,0))>=1 THEN FLOOR(cu.max_asignable*cu.factor/NULLIF(bt.unit_base,0))
               ELSE 0 END)::integer AS cajas_ya_usadas
    FROM _con_reglas_uncapped cu
    JOIN box_totals_per_product bt ON bt.erp_product_id=cu.erp_product_id AND bt.erp_presentacion_id=cu.erp_presentacion_id
    GROUP BY cu.erp_product_id, cu.erp_presentacion_id
  ),
  box_fill_ranked AS (
    SELECT cu.erp_sucursal_id, cu.erp_product_id, cu.erp_presentacion_id, cu.reponer,
      GREATEST(0, bt.cajas_bodega - bc.cajas_ya_usadas)::integer AS cajas_restantes,
      bt.unit_base, bt.factor,
      GREATEST(0, FLOOR(cu.reponer::numeric*bt.factor/NULLIF(bt.unit_base,0))
        + CASE WHEN (cu.reponer::numeric*bt.factor - FLOOR(cu.reponer::numeric*bt.factor/NULLIF(bt.unit_base,0))*bt.unit_base) >= 0.40*bt.unit_base THEN 1 ELSE 0 END
      )::integer AS cajas_max
    FROM _con_reglas_uncapped cu
    JOIN box_totals_per_product bt ON bt.erp_product_id=cu.erp_product_id AND bt.erp_presentacion_id=cu.erp_presentacion_id
    JOIN box_cajas_case12 bc ON bc.erp_product_id=cu.erp_product_id AND bc.erp_presentacion_id=cu.erp_presentacion_id
    WHERE cu.reponer>0 AND cu.asignado_uncapped>cu.max_asignable AND FLOOR(cu.max_asignable*cu.factor/NULLIF(bt.unit_base,0))<1
  ),
  box_fill_final AS (
    SELECT bfr.erp_sucursal_id, bfr.erp_product_id, bfr.erp_presentacion_id,
      (GREATEST(0, LEAST(bfr.cajas_max, bfr.cajas_restantes
        - COALESCE(SUM(bfr.cajas_max) OVER (PARTITION BY bfr.erp_product_id, bfr.erp_presentacion_id ORDER BY bfr.reponer DESC, bfr.erp_sucursal_id ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0)))
       * bfr.unit_base / NULLIF(bfr.factor,0))::integer AS packs_asignados
    FROM box_fill_ranked bfr
  )
  SELECT cu.erp_sucursal_id, cu.erp_product_id, cu.erp_presentacion_id,
    cu.stock_pk, cu.min_qty, cu.max_qty, cu.presentacion_tipo, cu.factor,
    cu.reponer, cu.need_u, cu.ventas_6m, cu.bodega_disponible,
    cu.tiene_regla, cu.regla_multiplo, cu.regla_blister, cu.regla_solo_cajas, cu.regla_multiplo_unidades, cu.caja_especial,
    cu.tiene_dispatch_label,
    cu.unit_base,
    cu.dp_factor AS dispatch_pres_factor,
    COALESCE(cu.dp_multiplo::integer, 1) AS dispatch_multiplo,
    COALESCE(cu.dp_tipo, cu.presentacion_tipo) AS dispatch_tipo,
    COALESCE(cu.dp_display_factor, cu.factor) AS dispatch_factor,
    CASE
      WHEN cu.asignado_uncapped <= cu.max_asignable THEN cu.asignado_uncapped
      WHEN cu.unit_base IS NOT NULL AND FLOOR(cu.max_asignable*cu.factor/cu.unit_base)>=1
        THEN (FLOOR(cu.max_asignable*cu.factor/cu.unit_base)*cu.unit_base/NULLIF(cu.factor,0))::integer
      WHEN bff.packs_asignados IS NOT NULL THEN bff.packs_asignados
      ELSE cu.asignado_raw
    END AS asignado_final
  FROM _con_reglas_uncapped cu
  LEFT JOIN box_fill_final bff ON bff.erp_sucursal_id=cu.erp_sucursal_id AND bff.erp_product_id=cu.erp_product_id AND bff.erp_presentacion_id=cu.erp_presentacion_id;
  CREATE INDEX ON _con_reglas(erp_product_id, erp_presentacion_id);
  CREATE INDEX ON _con_reglas(erp_sucursal_id);

  CREATE TEMP TABLE _bodega_lotes ON COMMIT DROP AS
  WITH pres_units_needed AS (
    SELECT erp_product_id, erp_presentacion_id, factor, SUM(reponer)::numeric * factor AS units_needed
    FROM _necesidades GROUP BY erp_product_id, erp_presentacion_id, factor
  ),
  pres_units_total AS (
    SELECT erp_product_id, SUM(units_needed) AS units_total FROM pres_units_needed GROUP BY erp_product_id
  )
  SELECT ib.erp_product_id, pu.erp_presentacion_id, ib.lote, ib.fecha_vencimiento,
    GREATEST(0, FLOOR(ib.unidades * COALESCE(pu.units_needed / NULLIF(pt.units_total, 0), 1.0) / NULLIF(pu.factor, 0)))::integer AS lote_packs
  FROM _inv_bodega ib
  INNER JOIN (SELECT DISTINCT erp_product_id FROM _con_reglas) cr ON cr.erp_product_id = ib.erp_product_id
  JOIN pres_units_needed pu ON pu.erp_product_id = ib.erp_product_id
  JOIN pres_units_total  pt ON pt.erp_product_id = ib.erp_product_id
  WHERE ib.unidades > 0;
  CREATE INDEX ON _bodega_lotes(erp_product_id, erp_presentacion_id);

  CREATE TEMP TABLE _bodega_lotes_fefo ON COMMIT DROP AS
  SELECT bl.*,
    COALESCE(SUM(bl.lote_packs) OVER (PARTITION BY bl.erp_product_id, bl.erp_presentacion_id ORDER BY bl.fecha_vencimiento ASC NULLS LAST, bl.lote ASC ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0)::integer AS lote_cum_start,
    SUM(bl.lote_packs) OVER (PARTITION BY bl.erp_product_id, bl.erp_presentacion_id ORDER BY bl.fecha_vencimiento ASC NULLS LAST, bl.lote ASC ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)::integer AS lote_cum_end
  FROM _bodega_lotes bl WHERE bl.lote_packs > 0;
  CREATE INDEX ON _bodega_lotes_fefo(erp_product_id, erp_presentacion_id);

  CREATE TEMP TABLE _suc_order ON COMMIT DROP AS
  SELECT cr.erp_sucursal_id, cr.erp_product_id, cr.erp_presentacion_id, cr.asignado_final,
    COALESCE(SUM(cr.asignado_final) OVER (PARTITION BY cr.erp_product_id, cr.erp_presentacion_id ORDER BY COALESCE(esm.orden_despacho, 999) ASC, cr.erp_sucursal_id ASC ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0)::integer AS suc_cum_start,
    SUM(cr.asignado_final) OVER (PARTITION BY cr.erp_product_id, cr.erp_presentacion_id ORDER BY COALESCE(esm.orden_despacho, 999) ASC, cr.erp_sucursal_id ASC ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)::integer AS suc_cum_end
  FROM _con_reglas cr
  JOIN erp_sucursal_map esm ON esm.erp_sucursal_id = cr.erp_sucursal_id
  WHERE cr.asignado_final > 0;
  CREATE INDEX ON _suc_order(erp_product_id, erp_presentacion_id);

  CREATE TEMP TABLE _lotes_por_sucursal ON COMMIT DROP AS
  SELECT so.erp_sucursal_id, so.erp_product_id, so.erp_presentacion_id,
    jsonb_agg(
      jsonb_build_object('lote', lf.lote, 'fecha_vencimiento', lf.fecha_vencimiento,
        'packs', GREATEST(0, LEAST(so.suc_cum_end, lf.lote_cum_end) - GREATEST(so.suc_cum_start, lf.lote_cum_start))::integer)
      ORDER BY lf.fecha_vencimiento ASC NULLS LAST, lf.lote ASC
    ) FILTER (WHERE GREATEST(0, LEAST(so.suc_cum_end, lf.lote_cum_end) - GREATEST(so.suc_cum_start, lf.lote_cum_start)) > 0)
    AS lotes_seq
  FROM _suc_order so
  JOIN _bodega_lotes_fefo lf ON lf.erp_product_id=so.erp_product_id AND lf.erp_presentacion_id=so.erp_presentacion_id
  GROUP BY so.erp_sucursal_id, so.erp_product_id, so.erp_presentacion_id;

  RETURN (
    SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'erp_sucursal_id', cr.erp_sucursal_id, 'erp_product_id', cr.erp_product_id,
        'erp_presentacion_id', cr.erp_presentacion_id, 'product_name', p.nombre::text,
        'laboratorio', COALESCE(lab.nombre, '')::text, 'presentacion_tipo', cr.presentacion_tipo::text,
        'factor', cr.factor, 'stock_packs', ROUND(cr.stock_pk, 2),
        'min_qty', cr.min_qty, 'max_qty', cr.max_qty, 'cantidad_reponer', cr.reponer::integer,
        'bodega_stock_packs', ROUND(cr.bodega_disponible, 2), 'cantidad_asignada', cr.asignado_final,
        'sin_stock', (cr.bodega_disponible <= 0),
        'revision_minmax', (
          cr.bodega_disponible > 0
          AND cr.asignado_final = 0
          AND cr.reponer > 0
          AND COALESCE(cr.tiene_regla, false)
          AND cr.unit_base IS NOT NULL
          AND (
            FLOOR(cr.need_u::numeric / cr.unit_base)
            + CASE WHEN (cr.need_u::numeric - FLOOR(cr.need_u::numeric / cr.unit_base) * cr.unit_base
                        ) >= 0.40 * cr.unit_base THEN 1 ELSE 0 END
          ) = 0
        ),
        'agotamiento', (
          cr.bodega_disponible > 0 AND (
            (cr.asignado_final > 0 AND cr.asignado_final < cr.reponer)
            OR (
              cr.asignado_final = 0 AND cr.reponer > 0 AND (
                NOT COALESCE(cr.tiene_regla, false)
                OR cr.unit_base IS NULL
                OR (
                  FLOOR(cr.need_u::numeric / cr.unit_base)
                  + CASE WHEN (cr.need_u::numeric - FLOOR(cr.need_u::numeric / cr.unit_base) * cr.unit_base
                              ) >= 0.40 * cr.unit_base THEN 1 ELSE 0 END
                ) > 0
              )
            )
          )
        ),
        'urgencia_pct', LEAST(100, ROUND((cr.reponer::numeric / NULLIF(cr.max_qty, 0)) * 100))::integer,
        'tiene_regla_despacho', COALESCE(cr.tiene_regla, false),
        'regla_multiplo', cr.regla_multiplo, 'regla_blister', cr.regla_blister,
        'regla_solo_cajas', cr.regla_solo_cajas, 'regla_multiplo_unidades', cr.regla_multiplo_unidades,
        'caja_especial', COALESCE(cr.caja_especial, false), 'es_antibiotico', COALESCE(p.es_antibiotico, false),
        'ventas_6m', cr.ventas_6m, 'lotes_bodega', lps.lotes_seq,
        'dispatch_tipo', cr.dispatch_tipo, 'dispatch_factor', cr.dispatch_factor,
        'dispatch_pres_factor', cr.dispatch_pres_factor,
        'dispatch_multiplo', cr.dispatch_multiplo,
        'tiene_dispatch_label', COALESCE(cr.tiene_dispatch_label, false),
        'presentations', (
          SELECT COALESCE(jsonb_agg(jsonb_build_object('tipo', pr2.tipo, 'factor', pp2.factor) ORDER BY pp2.factor DESC), '[]'::jsonb)
          FROM product_precios pp2
          JOIN presentaciones pr2 ON pr2.id = pp2.id_presentacion
          WHERE pp2.product_id = cr.erp_product_id AND pp2.activo = true AND pp2.factor >= 1
        )
      )
      ORDER BY cr.erp_sucursal_id, LEAST(100, ROUND((cr.reponer::numeric / NULLIF(cr.max_qty, 0)) * 100))::integer DESC, p.nombre
    ), '[]'::jsonb)
    FROM _con_reglas cr
    JOIN products p ON p.id = cr.erp_product_id
    LEFT JOIN laboratorios lab ON lab.id = p.laboratorio_id
    LEFT JOIN _lotes_por_sucursal lps ON lps.erp_sucursal_id=cr.erp_sucursal_id AND lps.erp_product_id=cr.erp_product_id AND lps.erp_presentacion_id=cr.erp_presentacion_id
    WHERE cr.erp_sucursal_id = ANY(COALESCE(p_target_ids, p_sucursal_ids))
  );
END;
$function$
