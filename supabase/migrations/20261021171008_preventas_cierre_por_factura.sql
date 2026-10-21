-- Preventas de reservas (2026-10-21), 3 de 5: el cierre cuando llega la factura.
--
-- Liga SÓLO por el número guardado (`externo_id` = `sales_invoices.erp_invoice_id`,
-- su índice único). Medido: la factura conserva el id de la preventa — la 396306
-- de Salud 2 llegó con ese mismo `erp_invoice_id`, mismo cliente y total. Nunca
-- por nombre ni por monto. Sin trigger en `sales_invoices` (tabla caliente): un
-- cron cada 3 minutos mientras corre la sincronización de ventas.
--
-- La reserva pasa a retirada —y a pagada, porque YA hay factura ligada— sólo si
-- no tiene un pago sin aplicar: con anticipo o pago en línea, el cierre lo hace
-- «Retirar», que aplica lo pagado a la factura; acá se liga y se avisa.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.preventas_cerrar_facturadas()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  p record; a record; k record;
  v_cerradas int := 0; v_dest uuid[]; v_pend text[]; v_ok text[]; v_cod text;
BEGIN
  -- Un envío que nunca contestó no traba la reserva para siempre.
  UPDATE public.preventas SET estado = 'fallida', error = coalesce(error, 'el envío no terminó'), updated_at = now()
   WHERE estado = 'enviando' AND created_at < now() - interval '10 minutes';

  FOR p IN
    SELECT pv.id, pv.branch_id, pv.reservas_ids, pv.externo_ref, si.id AS si_id, si.correlativo, si.codigo_generacion
      FROM public.preventas pv
      JOIN public.sales_invoices si ON si.erp_invoice_id = pv.externo_id
     WHERE pv.estado = 'viva' AND pv.sistema = 'caja' AND pv.externo_id IS NOT NULL
       AND si.branch_id = pv.branch_id AND public.venta_valida(si.estado)
       FOR UPDATE OF pv SKIP LOCKED
  LOOP
    UPDATE public.preventas
       SET estado = 'facturada', sales_invoice_id = p.si_id, codigo_generacion = p.codigo_generacion,
           facturada_at = now(), updated_at = now()
     WHERE id = p.id;
    v_pend := ARRAY[]::text[]; v_ok := ARRAY[]::text[];

    FOR a IN SELECT * FROM public.app_reservas WHERE id = ANY (p.reservas_ids) AND preventa_id = p.id ORDER BY id FOR UPDATE LOOP
      v_cod := coalesce(a.pedido, 'R-' || lpad(a.id::text, 6, '0'));
      SELECT * INTO k FROM public.reserva_cuenta(a.id);
      IF a.estado NOT IN ('pendiente', 'lista') THEN
        v_pend := v_pend || (v_cod || ' ya estaba ' || a.estado);
        CONTINUE;
      END IF;
      IF k.pagado > 0.004 AND NOT EXISTS (SELECT 1 FROM public.apartado_aplicaciones x WHERE x.reserva_id = a.id) THEN
        v_pend := v_pend || (v_cod || ': tiene $' || to_char(k.pagado, 'FM999990.00') || ' pagado; termínala con «Retirar»');
        CONTINUE;
      END IF;
      BEGIN
        UPDATE public.app_reservas
           SET estado = 'retirada', cerrada_at = now(), updated_at = now(),
               pago_estado = CASE WHEN pago_estado IN ('pendiente', 'anticipo') THEN 'pagado' ELSE pago_estado END,
               pagado_at = coalesce(pagado_at, now())
         WHERE id = a.id;
        INSERT INTO public.audit_logs (user_id, action, target_id, details, branch_id, source)
        VALUES (NULL, 'RESERVA_RETIRADA', a.id::text,
                jsonb_build_object('por', 'factura', 'preventa', p.id, 'factura', p.correlativo, 'sales_invoice_id', p.si_id),
                a.branch_id, 'SYSTEM');
        IF a.origen = 'app' THEN
          INSERT INTO public.app_cliente_avisos (customer_id, tipo, ref, titulo, cuerpo, url)
          VALUES (a.customer_id, 'reserva', 'base:retirada:' || v_cod, '¡Gracias por tu compra!',
                  a.producto_nombre || ' ya es tuyo. Tu reserva quedó entregada.', '/reservas')
          ON CONFLICT (customer_id, tipo, ref) DO NOTHING;
        END IF;
        v_ok := v_ok || v_cod;
        v_cerradas := v_cerradas + 1;
      EXCEPTION WHEN OTHERS THEN
        v_pend := v_pend || (v_cod || ': no se pudo cerrar (' || SQLERRM || ')');
      END;
    END LOOP;

    v_dest := public.destinatarios_de_reservas(p.branch_id);
    IF v_dest IS NOT NULL THEN
      PERFORM public.notify_employees(v_dest, 'RESERVA_APP',
        CASE WHEN cardinality(v_pend) = 0 THEN 'Reserva entregada · ' ELSE 'Reserva facturada · ' END
          || coalesce(v_ok[1], split_part(coalesce(v_pend[1], ''), ':', 1)),
        CASE WHEN cardinality(v_ok) > 0 THEN 'Se cerró sola con la factura ' || coalesce(p.correlativo, '') || '.'
             ELSE 'Se facturó la preventa #' || coalesce(p.externo_ref, '') || '.' END
          || CASE WHEN cardinality(v_pend) > 0 THEN ' ' || array_to_string(v_pend, '. ') || '.' ELSE '' END,
        '/reservas', jsonb_build_object('check_key', 'reserva_facturada:' || p.id, 'preventa_id', p.id), true, p.branch_id::int);
    END IF;
  END LOOP;
  RETURN v_cerradas;
END;
$$;
REVOKE ALL ON FUNCTION public.preventas_cerrar_facturadas() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.preventas_cerrar_facturadas() TO service_role;

SELECT cron.schedule('preventas-cerrar-facturadas', '*/3 12-23,0-5 * * *',
                     'SELECT public.preventas_cerrar_facturadas()');
