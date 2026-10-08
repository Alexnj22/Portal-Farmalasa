SET lock_timeout = '5s';
-- `puntos_sellar_estado` corre cada minuto (puntos-motor) y leía ~26,000
-- bloques (203 MB) por llamada (gate:perf, 2026-10-08). Dos causas medidas:
--   1. Estadísticas viejas: `puntos_enviados` (384k filas) NUNCA se había
--      analizado y `puntos_lote` no desde el 25-sep; el planificador creía 1
--      lote de venta y recorría los 3,183. Con ANALYZE: 21,067 → 2,546 bloques.
--      Para que no vuelva: análisis y vacío automáticos al 2 % de cambio.
--   2. `puntos_marcar_sin_enviar` revisaba los renglones de TODAS las facturas
--      de la ventana antes de descartar las ya selladas (16,436 bloques). Ahora
--      descarta primero las selladas y sólo mira renglones de las que faltan.
ALTER TABLE public.puntos_enviados SET (autovacuum_analyze_scale_factor = 0.02, autovacuum_vacuum_scale_factor = 0.02, autovacuum_vacuum_insert_scale_factor = 0.02);
ALTER TABLE public.puntos_lote SET (autovacuum_analyze_scale_factor = 0.02, autovacuum_vacuum_scale_factor = 0.02, autovacuum_vacuum_insert_scale_factor = 0.02);

CREATE OR REPLACE FUNCTION public.puntos_marcar_sin_enviar(p_desde date, p_hasta date)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  n integer;
BEGIN
  WITH faltan AS MATERIALIZED (
    -- Primero: las facturas de la ventana que todavía no tienen sello.
    SELECT si.id, si.branch_id, si.erp_invoice_id, si.correlativo, si.cliente, si.cod_vendedor, si.total, si.fecha, si.created_at
      FROM public.sales_invoices si
     WHERE si.fecha BETWEEN p_desde AND p_hasta
       AND NOT EXISTS (SELECT 1 FROM public.puntos_enviados pe WHERE pe.invoice_id = si.id)
  )
  INSERT INTO public.puntos_enviados
    (invoice_id, sucursal, erp_invoice_id, correlativo, cliente, cod_vendedor,
     total, fecha, enviado_at)
  SELECT f.id, b.codigo_puntos, f.erp_invoice_id, f.correlativo, f.cliente,
         CASE WHEN f.cod_vendedor ~ '^[0-9]{1,9}$' THEN f.cod_vendedor::int END,
         f.total, f.fecha, now()
  FROM faltan f
  JOIN public.branches b ON b.id = f.branch_id AND b.codigo_puntos IS NOT NULL
  -- Ver el encabezado: una factura a medio escribir no se sella.
  WHERE (EXISTS (SELECT 1 FROM public.sales_invoice_items ii WHERE ii.invoice_id = f.id)
         OR f.created_at < now() - interval '15 minutes')
  ON CONFLICT (invoice_id) DO NOTHING;

  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$function$;
