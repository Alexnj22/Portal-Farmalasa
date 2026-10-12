SET lock_timeout = '5s';
CREATE OR REPLACE FUNCTION public.mayoristas_rehacer_resumen()
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v integer; v_desde date := date_trunc('month', (now() AT TIME ZONE 'America/El_Salvador')::date - interval '6 months')::date;
BEGIN
  CREATE TEMP TABLE _r ON COMMIT DROP AS
  WITH it AS (
    -- Un renglón = una fila. product_precios tiene VARIAS presentaciones activas
    -- con el mismo (producto, factor) —1,615 combinaciones el 2026-10-12— y el
    -- join sin agrupar duplicaba el renglón: los totales salían 44% inflados
    -- ($963,872 guardados contra $669,146 reales en los 6 meses).
    SELECT si.customer_id, si.id AS inv, si.fecha, max(si.total) AS total_factura,
           max(ii.total_linea) AS total_linea,
           max(coalesce(ii.costo_unitario, 0) * coalesce(ii.cantidad, 0)) AS costo_linea,
           CASE WHEN bool_or(pp.mayoreo > 0 AND abs(ii.precio_unitario - pp.mayoreo) < 0.005
                             AND pp.mayoreo < coalesce(nullif(pp.vip, 0), pp.vineta) - 0.005) THEN 'plus'
                WHEN bool_or(pp.clinica > 0 AND abs(ii.precio_unitario - pp.clinica) < 0.005
                             AND pp.clinica < coalesce(nullif(pp.vip, 0), pp.vineta) - 0.005) THEN 'mayoreo' END AS precio
      FROM public.sales_invoices si
      JOIN public.sales_invoice_items ii ON ii.invoice_id = si.id
      LEFT JOIN public.product_precios pp ON pp.product_id = ii.erp_product_id
           AND coalesce(pp.factor, 1) = coalesce(ii.factor_unidades, 1) AND pp.activo
     WHERE si.fecha >= v_desde AND si.customer_id IS NOT NULL AND public.venta_valida(si.estado)
     GROUP BY ii.id, si.customer_id, si.id, si.fecha
  ), quienes AS (
    SELECT DISTINCT customer_id FROM it WHERE precio IS NOT NULL
    UNION SELECT customer_id FROM public.clientes_mayoristas
  )
  SELECT it.customer_id, date_trunc('month', it.fecha)::date AS mes,
         round(sum(it.total_linea), 2) AS total,
         round(coalesce(sum(it.total_linea) FILTER (WHERE it.precio = 'mayoreo'), 0), 2) AS a_mayoreo,
         round(coalesce(sum(it.total_linea) FILTER (WHERE it.precio = 'plus'), 0), 2) AS a_plus,
         count(DISTINCT it.inv) AS facturas,
         count(DISTINCT it.inv) FILTER (WHERE it.precio IS NOT NULL) AS facturas_mayoreo,
         round(max(it.total_factura), 2) AS mayor_factura,
         round(sum(it.costo_linea), 2) AS costo,
         max(it.fecha) AS ultima_compra
    FROM it JOIN quienes q ON q.customer_id = it.customer_id
   GROUP BY 1, 2;
  DELETE FROM public.mayoristas_resumen_mensual WHERE mes >= v_desde OR mes < v_desde - interval '1 year';
  INSERT INTO public.mayoristas_resumen_mensual (customer_id, mes, total, a_mayoreo, a_plus, facturas, facturas_mayoreo, mayor_factura, costo, ultima_compra)
  SELECT * FROM _r;
  GET DIAGNOSTICS v = ROW_COUNT;
  UPDATE public.clientes_mayoristas SET estado = 'retirado', retiro_programado = NULL, updated_at = now()
   WHERE estado = 'aprobado' AND retiro_programado <= (now() AT TIME ZONE 'America/El_Salvador')::date;
  RETURN v;
END $function$;
