-- PENDIENTES 30: la rebaja «a mano» dice además por qué no es de campaña
-- cuando hay una campaña del mismo producto que casi la explica: con la misma
-- rebaja pero fuera de fecha (medido: GRIIN SKIN el 3-ago, $4.96 = «OFERTA
-- ESPECIAL», que terminó el 29-jul), en otra sala, o en fecha con otro monto.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.rebajas_en_ventas(p_desde date, p_hasta date, p_branch_id bigint DEFAULT NULL)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, extensions
SET plan_cache_mode = 'force_custom_plan'
AS $function$
DECLARE
  r json;
BEGIN
  IF p_desde IS NULL OR p_hasta IS NULL OR p_hasta < p_desde OR p_hasta - p_desde > 92 THEN
    RAISE EXCEPTION 'Rango inválido: hasta 92 días.' USING ERRCODE = '22023';
  END IF;

  -- Se entra por los renglones candidatos (índice parcial
  -- `sales_invoice_items_con_rebaja_idx`, ~3,800 en toda la tabla) y no por
  -- las facturas del período: un mes eran 78K bloques por el otro lado, 4.8K
  -- por éste. El predicado del índice va escrito IGUAL para que lo use.
  WITH candidato AS MATERIALIZED (
    SELECT ii.id, ii.invoice_id, ii.erp_product_id, ii.descripcion, ii.presentacion,
           ii.cantidad, ii.precio_unitario, ii.total_linea
      FROM public.sales_invoice_items ii
     WHERE ii.total_linea < ii.precio_unitario * ii.cantidad - 0.02
       AND ii.erp_product_id <> 0
  ), renglon AS (
    SELECT ii.id, si.fecha, si.branch_id, si.correlativo, si.tipo_documento, si.cliente, si.cod_vendedor,
           ii.erp_product_id AS pid, ii.descripcion, ii.presentacion, ii.cantidad, ii.total_linea,
           CASE WHEN si.tipo_documento = 'CCF' THEN 1.13 ELSE 1 END AS iva,
           round(ii.precio_unitario * ii.cantidad / CASE WHEN si.tipo_documento = 'CCF' THEN 1.13 ELSE 1 END, 2) AS bruto
      FROM candidato ii
      JOIN public.sales_invoices si ON si.id = ii.invoice_id
     WHERE si.fecha BETWEEN p_desde AND p_hasta
       AND public.venta_valida(si.estado)
       AND (p_branch_id IS NULL OR si.branch_id = p_branch_id)
  ), rebaja AS (
    SELECT x.*, x.bruto - x.total_linea AS monto_rebaja
      FROM renglon x
     WHERE x.total_linea < x.bruto - 0.02
  ), clasificada AS (
    SELECT b.*, c.id AS campana_id, cerca.descripcion AS campana_cercana,
           cerca.motivo AS cercana_motivo, cerca.fin AS cercana_fin
      FROM rebaja b
      LEFT JOIN LATERAL (
        SELECT d.id FROM public.descuentos_espejo d
         WHERE b.pid = ANY (d.productos) AND b.fecha BETWEEN d.inicio AND d.fin
           AND (d.todas_las_salas OR d.branch_id = b.branch_id)
           AND abs(round(CASE WHEN d.tipo = '%' THEN b.bruto * d.monto / 100
                              ELSE d.monto * b.cantidad / b.iva END, 2) - b.monto_rebaja) <= 0.02
         ORDER BY d.id LIMIT 1) c ON true
      LEFT JOIN LATERAL (
        SELECT d.descripcion, d.fin,
               CASE WHEN b.fecha NOT BETWEEN d.inicio AND d.fin THEN 'fuera_de_fecha'
                    WHEN NOT (d.todas_las_salas OR d.branch_id = b.branch_id) THEN 'otra_sala'
                    ELSE 'otro_monto' END AS motivo
          FROM public.descuentos_espejo d
         WHERE c.id IS NULL AND b.pid = ANY (d.productos)
           AND (b.fecha BETWEEN d.inicio AND d.fin
                OR abs(round(CASE WHEN d.tipo = '%' THEN b.bruto * d.monto / 100
                                  ELSE d.monto * b.cantidad / b.iva END, 2) - b.monto_rebaja) <= 0.02)
         ORDER BY (b.fecha BETWEEN d.inicio AND d.fin) DESC, abs(b.fecha - d.fin), d.id
         LIMIT 1) cerca ON true
  )
  SELECT json_build_object(
    'resumen', (SELECT json_build_object(
        'campana', json_build_object('renglones', count(*) FILTER (WHERE campana_id IS NOT NULL),
                                     'monto', coalesce(sum(monto_rebaja) FILTER (WHERE campana_id IS NOT NULL), 0)),
        'a_mano',  json_build_object('renglones', count(*) FILTER (WHERE campana_id IS NULL),
                                     'monto', coalesce(sum(monto_rebaja) FILTER (WHERE campana_id IS NULL), 0)))
      FROM clasificada),
    'por_campana', (SELECT coalesce(json_agg(t ORDER BY t.rebajado DESC), '[]'::json) FROM (
        SELECT d.id, d.descripcion, d.tipo, d.monto, d.inicio, d.fin, d.borrado_at IS NOT NULL AS borrada,
               count(*) AS renglones, sum(k.cantidad) AS unidades,
               sum(k.total_linea) AS cobrado, sum(k.monto_rebaja) AS rebajado
          FROM clasificada k JOIN public.descuentos_espejo d ON d.id = k.campana_id
         GROUP BY d.id) t),
    'a_mano', (SELECT coalesce(json_agg(t ORDER BY t.fecha DESC, t.correlativo), '[]'::json) FROM (
        SELECT k.id, k.fecha, k.branch_id, k.correlativo, k.tipo_documento, k.cliente, k.cod_vendedor,
               e.id AS vendedor_id, e.name AS vendedor, k.descripcion AS producto, k.presentacion, k.cantidad,
               k.bruto AS precio, k.total_linea AS cobrado, k.monto_rebaja AS rebaja,
               round(100 * k.monto_rebaja / nullif(k.bruto, 0), 1) AS porcentaje, k.campana_cercana, k.cercana_motivo, k.cercana_fin
          FROM clasificada k
          LEFT JOIN LATERAL (SELECT e.id, e.name FROM public.employees e
                              WHERE e.code = k.cod_vendedor ORDER BY e.id LIMIT 1) e ON true
         WHERE k.campana_id IS NULL) t)
  ) INTO r;
  RETURN r;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.rebajas_en_ventas(date, date, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rebajas_en_ventas(date, date, bigint) TO authenticated, service_role;
