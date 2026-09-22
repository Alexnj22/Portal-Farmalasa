-- F7 (parte 2) · Una factura sin renglones TODAVÍA no se decide.
--
-- `sync-dte-sales` escribe la factura y sus renglones en dos sentencias
-- seguidas, así que hay una ventana de milisegundos en la que la factura existe
-- sin renglones. Si `sync-puntos` mira justo ahí, `ventas_para_puntos` no la
-- devuelve (sin renglones no hay nada que evaluar) y `puntos_marcar_sin_enviar`
-- la sellaba como «sin enviar».
--
-- Hasta hoy eso se corregía solo porque la corrida de cada minuto re-evaluaba
-- las `sin_enviar`. Desde 20260922170243 esa re-evaluación es por hora, así que
-- la factura esperaría hasta una hora para acreditar sus puntos — y la cadencia
-- de un minuto existe justamente porque el cliente puede presentar el ticket al
-- rato de comprar.
--
-- La guarda: una factura sin renglones no se decide hasta que los tenga, o
-- hasta que pasen 15 minutos desde que entró (hay 4 facturas en 30 días que
-- nunca tuvieron renglones; sin el plazo quedarían sin fila para siempre y se
-- rompería la invariante «una fila por venta»).
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.puntos_marcar_sin_enviar(p_desde date, p_hasta date)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  n integer;
BEGIN
  INSERT INTO public.puntos_enviados
    (invoice_id, sucursal, erp_invoice_id, correlativo, cliente, cod_vendedor,
     total, fecha, enviado_at)
  SELECT si.id, b.codigo_puntos, si.erp_invoice_id, si.correlativo, si.cliente,
         CASE WHEN si.cod_vendedor ~ '^[0-9]{1,9}$' THEN si.cod_vendedor::int END,
         si.total, si.fecha, now()
  FROM public.sales_invoices si
  JOIN public.branches b ON b.id = si.branch_id AND b.codigo_puntos IS NOT NULL
  LEFT JOIN public.puntos_enviados pe ON pe.invoice_id = si.id
  WHERE pe.invoice_id IS NULL
    AND si.fecha BETWEEN p_desde AND p_hasta
    -- Ver el encabezado: una factura a medio escribir no se sella.
    AND (EXISTS (SELECT 1 FROM public.sales_invoice_items ii WHERE ii.invoice_id = si.id)
         OR si.created_at < now() - interval '15 minutes')
  ON CONFLICT (invoice_id) DO NOTHING;

  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$function$;
