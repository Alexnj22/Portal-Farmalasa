SET lock_timeout = '5s';

-- ═══ El estado de puntos de cada venta, desde el libro del portal ═══════════
-- La columna «Puntos» de Ventas y su filtro leen `puntos_enviados.estado_puntos`.
-- Hasta el corte esa tabla la llenaba `sync-puntos` (el puente con la base
-- vieja), y el arranque del 1-oct lo apaga: sin esto, desde ese día cada venta
-- nueva aparecía SIN estado y el filtro no la encontraba — sin error, con la
-- columna vacía.
--
-- `src/data/puntos.js` ya lo había previsto: «el día que los puntos vivan acá
-- se reescribe la función de abajo y la columna generada de la base — y ni la
-- lista de ventas ni la ficha del cliente se enteran». Es eso: el motor sella
-- el estado en la MISMA tabla, con los MISMOS valores que la columna generada
-- ya traduce. La pantalla no cambia.
--
--   lo que pasó en el libro                        → estado_puntos
--   la venta tiene lote                            → acumulado     (aplicado = 1)
--   se anuló y se le quitaron puntos               → devuelto      (reversion RESTADA)
--   se anuló con el lote ya gastado entero         → por_revisar   (reversion PUNTOS_YA_DADOS)
--   no cumple las reglas                           → sin_enviar    (la fila, sin más)
--
-- Sólo desde `puntos_config.inicio`: lo anterior conserva el estado que le dio
-- el circuito viejo, que es el que era cierto en su momento.
CREATE OR REPLACE FUNCTION public.puntos_sellar_estado(p_desde date, p_hasta date)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE v_acum int; v_dev int; v_rev int; v_sin int;
BEGIN
  IF (SELECT inicio FROM public.puntos_config WHERE id) IS NULL THEN
    RETURN json_build_object('ok', true, 'sin_inicio', true);
  END IF;
  p_desde := public.puntos_desde_efectivo(p_desde);
  IF p_desde > p_hasta THEN RETURN json_build_object('ok', true, 'antes_del_inicio', true); END IF;

  -- 1 · Acumuló. Si la fila ya existía como «sin puntos» (la venta llegó entre
  -- la acumulación y el sello de una corrida anterior), pasa a acumulado.
  INSERT INTO public.puntos_enviados
    (invoice_id, sucursal, erp_invoice_id, correlativo, cliente, cod_vendedor, total, fecha, aplicado, visto_at)
  SELECT si.id, l.sucursal, si.erp_invoice_id, si.correlativo, si.cliente,
         CASE WHEN si.cod_vendedor ~ '^[0-9]{1,9}$' THEN si.cod_vendedor::int END,
         si.total, si.fecha, 1, now()
    FROM public.puntos_lote l
    JOIN public.sales_invoices si ON si.id = l.invoice_id
   WHERE l.origen = 'venta' AND si.fecha BETWEEN p_desde AND p_hasta
  ON CONFLICT (invoice_id) DO UPDATE SET aplicado = 1, visto_at = now()
   WHERE public.puntos_enviados.aplicado IS DISTINCT FROM 1
     AND public.puntos_enviados.reversion IS NULL;
  GET DIAGNOSTICS v_acum = ROW_COUNT;

  -- 2 · Se anuló y se quitaron puntos (todos o parte).
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

  -- 3 · Se anuló con el lote ya gastado entero: no había qué quitar. Es el
  -- caso que alguien tiene que mirar.
  UPDATE public.puntos_enviados pe
     SET reversion = 'PUNTOS_YA_DADOS', anulada_at = coalesce(pe.anulada_at, now()),
         estado_anulada = si.estado, puntos_no_recuperados = l.puntos
    FROM public.puntos_lote l
    JOIN public.sales_invoices si ON si.id = l.invoice_id
   WHERE l.origen = 'venta' AND pe.invoice_id = l.invoice_id
     AND si.fecha BETWEEN p_desde AND p_hasta
     AND si.estado <> 'FINALIZADA' AND l.restantes = 0
     AND NOT EXISTS (SELECT 1 FROM public.puntos_salida s
                      WHERE s.invoice_id = l.invoice_id AND s.tipo = 'anulacion')
     AND pe.reversion IS NULL;
  GET DIAGNOSTICS v_rev = ROW_COUNT;

  -- 4 · El resto: la venta existe y no ganó puntos.
  v_sin := public.puntos_marcar_sin_enviar(p_desde, p_hasta);

  RETURN json_build_object('ok', true, 'desde', p_desde, 'hasta', p_hasta,
    'acumulado', v_acum, 'devuelto', v_dev, 'por_revisar', v_rev, 'sin_puntos', v_sin);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.puntos_sellar_estado(date, date) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.puntos_sellar_estado(date, date) TO service_role;
