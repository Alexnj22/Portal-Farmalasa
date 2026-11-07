SET lock_timeout = '5s';

-- El resumen del conteo contaba como «diferencia» y como «faltante» lo que
-- sólo cambió de lote: en Salud 4 (2026-11-06) la existencia «sin lote» se
-- contó en sus lotes reales, los 5 productos cuadraban en total y la tarjeta
-- decía «10 diferencias» y «Faltante $22.59» en rojo. Se agregan las cifras
-- POR PRODUCTO (neteado en unidades con el mismo `mult` que
-- `get_conteo_products_page`, y en dinero con el costo de cada renglón):
--   productos_con_diferencia — productos cuyo total no cuadra
--   renglones_reacomodo      — renglones con diferencia dentro de un producto que sí cuadra
--   faltante_neto / sobrante_neto — lo que falta/sobra después de netear cada producto
--   valor_reacomodado        — el dinero que sólo cambia de renglón (sale y entra igual)
-- Las columnas de siempre (con_diferencia, valor_faltante, valor_sobrante) se
-- quedan: las lee la app y son las dos mitades del ajuste que se aplica.
CREATE OR REPLACE FUNCTION public.get_conteo_resumen(p_conteo_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  -- Mismo predicado que las cinco RPCs de lectura: sin el permiso y con el
  -- conteo abierto, las cifras del sistema no salen de la base.
  v_ver boolean := public.conteo_puede_ver_sistema(p_conteo_id);
  v_montos boolean;
BEGIN
  v_montos := v_ver AND (SELECT public.auth_has_module_permission('conteo_inventario_ver_montos', 'can_view'));
  RETURN (
    WITH it AS MATERIALIZED (
      SELECT ci.id, ci.erp_product_id, ci.is_vencidos, ci.estado_item, ci.recontado_at,
             ci.es_agregado_manual, ci.contado_por, ci.diferencia, nt.factor,
             (SELECT cc.costo_unitario FROM public.conteo_inventario_costos cc WHERE cc.item_id = ci.id) AS costo,
             bool_or(coalesce(nt.grupo_mixto, false))
               OVER (PARTITION BY ci.erp_product_id, ci.is_vencidos) AS prod_mixto
      FROM public.conteo_inventario_items ci
      LEFT JOIN public.conteo_lineas_netas(p_conteo_id) nt ON nt.item_id = ci.id
      WHERE ci.conteo_id = p_conteo_id
    ),
    prod AS (
      SELECT it.erp_product_id, it.is_vencidos,
             sum(it.diferencia * CASE WHEN it.prod_mixto THEN coalesce(it.factor, 1) ELSE 1 END) AS neto_u,
             count(*) FILTER (WHERE it.diferencia IS NOT NULL AND it.diferencia <> 0) AS renglones_dif,
             coalesce(sum(greatest(-it.diferencia, 0) * coalesce(it.costo, 0)), 0) AS fal,
             coalesce(sum(greatest( it.diferencia, 0) * coalesce(it.costo, 0)), 0) AS sob
      FROM it GROUP BY 1, 2
    ),
    pr AS (
      SELECT
        count(*) FILTER (WHERE coalesce(p.neto_u, 0) <> 0)::int                              AS productos_con_diferencia,
        coalesce(sum(p.renglones_dif) FILTER (WHERE coalesce(p.neto_u, 0) = 0), 0)::int        AS renglones_reacomodo,
        coalesce(sum(greatest(p.fal - p.sob, 0)), 0)                                           AS faltante_neto,
        coalesce(sum(greatest(p.sob - p.fal, 0)), 0)                                           AS sobrante_neto,
        coalesce(sum(least(p.fal, p.sob)), 0)                                                  AS valor_reacomodado
      FROM prod p
    ),
    ag AS (
      SELECT
        count(*)::int                                                                  AS total_items,
        count(DISTINCT it.erp_product_id)::int                                         AS total_productos,
        count(*) FILTER (WHERE it.estado_item <> 'PENDIENTE')::int                     AS contados,
        count(*) FILTER (WHERE it.estado_item = 'PENDIENTE')::int                      AS pendientes,
        count(*) FILTER (WHERE it.estado_item = 'SIN_UBICAR')::int                     AS sin_ubicar,
        count(*) FILTER (WHERE it.recontado_at IS NOT NULL)::int                       AS recontados,
        count(*) FILTER (WHERE it.es_agregado_manual)::int                             AS agregados,
        count(DISTINCT it.contado_por)::int                                            AS contadores,
        count(DISTINCT it.erp_product_id)
          FILTER (WHERE it.estado_item = 'PENDIENTE' AND NOT it.is_vencidos)::int      AS pendientes_bodega,
        count(DISTINCT it.erp_product_id)
          FILTER (WHERE it.estado_item = 'PENDIENTE' AND it.is_vencidos)::int          AS pendientes_vencidos,
        count(DISTINCT it.erp_product_id) FILTER (WHERE NOT it.is_vencidos)::int       AS productos_bodega,
        count(DISTINCT it.erp_product_id) FILTER (WHERE it.is_vencidos)::int           AS productos_vencidos,
        count(*) FILTER (WHERE it.diferencia IS NOT NULL AND it.diferencia <> 0)::int AS con_diferencia_raw,
        COALESCE(SUM(GREATEST(-it.diferencia, 0) * COALESCE(it.costo, 0)), 0)          AS valor_faltante_raw,
        COALESCE(SUM(GREATEST( it.diferencia, 0) * COALESCE(it.costo, 0)), 0)          AS valor_sobrante_raw
      FROM it
    )
    SELECT to_json(t) FROM (
      SELECT ag.total_items, ag.total_productos, ag.contados, ag.pendientes, ag.sin_ubicar,
             ag.recontados, ag.agregados, ag.contadores, ag.pendientes_bodega, ag.pendientes_vencidos,
             ag.productos_bodega, ag.productos_vencidos,
             CASE WHEN v_ver THEN ag.con_diferencia_raw END        AS con_diferencia,
             CASE WHEN v_montos THEN ag.valor_faltante_raw END     AS valor_faltante,
             CASE WHEN v_montos THEN ag.valor_sobrante_raw END     AS valor_sobrante,
             CASE WHEN v_ver THEN pr.productos_con_diferencia END  AS productos_con_diferencia,
             CASE WHEN v_ver THEN pr.renglones_reacomodo END       AS renglones_reacomodo,
             CASE WHEN v_montos THEN pr.faltante_neto END          AS faltante_neto,
             CASE WHEN v_montos THEN pr.sobrante_neto END          AS sobrante_neto,
             CASE WHEN v_montos THEN pr.valor_reacomodado END      AS valor_reacomodado,
             v_ver                                                 AS ver_sistema
      FROM ag CROSS JOIN pr
    ) t
  );
END;
$function$;
