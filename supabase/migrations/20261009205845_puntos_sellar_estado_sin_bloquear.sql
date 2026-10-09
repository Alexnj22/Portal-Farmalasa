SET lock_timeout = '5s';
-- puntos_sellar_estado deja de bloquear ~1,450 filas por minuto para no escribir
-- nada (2026-10-09): 1,350 registros de WAL por llamada, ~172 MB de WAL al día.
-- El ON CONFLICT DO UPDATE bloquea la fila aunque su WHERE sea falso; ahora las
-- ya selladas se descartan ANTES del INSERT (mismo resultado) y l.ganado_el se
-- acota a la ventana (para origen 'venta' = fecha de la factura).
CREATE OR REPLACE FUNCTION public.puntos_sellar_estado(p_desde date, p_hasta date)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v_acum int; v_dev int; v_rev int; v_sin int;
BEGIN
  IF (SELECT inicio FROM public.puntos_config WHERE id) IS NULL THEN
    RETURN json_build_object('ok', true, 'sin_inicio', true);
  END IF;
  p_desde := public.puntos_desde_efectivo(p_desde);
  IF p_desde > p_hasta THEN RETURN json_build_object('ok', true, 'antes_del_inicio', true); END IF;

  INSERT INTO public.puntos_enviados
    (invoice_id, sucursal, erp_invoice_id, correlativo, cliente, cod_vendedor, total, fecha, aplicado, visto_at)
  SELECT si.id, l.sucursal, si.erp_invoice_id, si.correlativo, si.cliente,
         CASE WHEN si.cod_vendedor ~ '^[0-9]{1,9}$' THEN si.cod_vendedor::int END,
         si.total, si.fecha, 1, now()
    FROM public.puntos_lote l
    JOIN public.sales_invoices si ON si.id = l.invoice_id
   WHERE l.origen = 'venta'
     AND l.ganado_el BETWEEN p_desde AND p_hasta
     AND si.fecha BETWEEN p_desde AND p_hasta
     AND NOT EXISTS (SELECT 1 FROM public.puntos_enviados pe
                      WHERE pe.invoice_id = si.id
                        AND (pe.aplicado = 1 OR pe.reversion IS NOT NULL))
  ON CONFLICT (invoice_id) DO UPDATE SET aplicado = 1, visto_at = now()
   WHERE public.puntos_enviados.aplicado IS DISTINCT FROM 1
     AND public.puntos_enviados.reversion IS NULL;
  GET DIAGNOSTICS v_acum = ROW_COUNT;

  UPDATE public.puntos_enviados pe
     SET reversion = 'RESTADA', revertida_at = now(), anulada_at = coalesce(pe.anulada_at, now()),
         estado_anulada = si.estado, puntos_devueltos = s.puntos,
         puntos_no_recuperados = l.puntos - s.puntos
    FROM public.puntos_salida s
    JOIN public.sales_invoices si ON si.id = s.invoice_id
    JOIN public.puntos_lote l ON l.invoice_id = s.invoice_id
   WHERE s.tipo = 'anulacion' AND pe.invoice_id = s.invoice_id
     AND si.fecha BETWEEN p_desde AND p_hasta
     AND pe.reversion IS NULL;
  GET DIAGNOSTICS v_dev = ROW_COUNT;

  UPDATE public.puntos_enviados pe
     SET reversion = 'PUNTOS_YA_DADOS', anulada_at = coalesce(pe.anulada_at, now()),
         estado_anulada = si.estado, puntos_no_recuperados = l.puntos
    FROM public.puntos_lote l
    JOIN public.sales_invoices si ON si.id = l.invoice_id
   WHERE l.origen = 'venta' AND pe.invoice_id = l.invoice_id
     AND l.ganado_el BETWEEN p_desde AND p_hasta
     AND si.fecha BETWEEN p_desde AND p_hasta
     AND si.estado <> 'FINALIZADA' AND l.restantes = 0
     AND NOT EXISTS (SELECT 1 FROM public.puntos_salida s
                      WHERE s.invoice_id = l.invoice_id AND s.tipo = 'anulacion')
     AND pe.reversion IS NULL;
  GET DIAGNOSTICS v_rev = ROW_COUNT;

  v_sin := public.puntos_marcar_sin_enviar(p_desde, p_hasta);

  RETURN json_build_object('ok', true, 'desde', p_desde, 'hasta', p_hasta,
    'acumulado', v_acum, 'devuelto', v_dev, 'por_revisar', v_rev, 'sin_puntos', v_sin);
END;
$function$;
