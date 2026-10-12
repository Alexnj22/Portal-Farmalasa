SET lock_timeout = '5s';
CREATE OR REPLACE FUNCTION public.app_catalogo_rehacer_destacados()
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v integer;
BEGIN
  DELETE FROM public.app_catalogo_destacados;
  INSERT INTO public.app_catalogo_destacados (product_id, unidades, posicion)
  SELECT x.id, x.vendido, row_number() OVER (ORDER BY x.vendido DESC, x.id)
    FROM (
      -- Primero lo vendido en la ventana (entra por la fecha de la factura) y
      -- DESPUÉS el filtro de producto. Al revés, el planificador recorría el
      -- historial ENTERO de cada producto (600k renglones para quedarse con 61k):
      -- 585,908 bloques y 8.4 s contra 126,341 y 140 ms, mismas 300 filas.
      WITH v AS MATERIALIZED (
        SELECT ii.erp_product_id AS id, sum(ii.total_linea) AS vendido
          FROM public.sales_invoices si
          JOIN public.sales_invoice_items ii ON ii.invoice_id = si.id
         WHERE si.fecha > (now() AT TIME ZONE 'America/El_Salvador')::date - 60
           AND public.venta_valida(si.estado)
         GROUP BY 1
      )
      SELECT p.id, v.vendido
        FROM v
        JOIN public.products p ON p.id = v.id
        LEFT JOIN public.laboratorios lab ON lab.id = p.laboratorio_id
       WHERE p.activo IS DISTINCT FROM false AND NOT coalesce(p.oculto_en_ventas, false)
         AND coalesce(lab.acumula_puntos, true)
         AND NOT EXISTS (SELECT 1 FROM public.puntos_producto_no_acumula x WHERE x.product_id = p.id)
         AND EXISTS (SELECT 1 FROM public.product_precios pp WHERE pp.product_id = p.id AND pp.activo AND pp.vineta > 0)
       ORDER BY 2 DESC, 1
       LIMIT 300
    ) x;
  GET DIAGNOSTICS v = ROW_COUNT;
  RETURN v;
END $function$;
