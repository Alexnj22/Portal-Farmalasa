-- Saldo a favor (2026-10-21), parte 3: se anota el canje a otro nombre, el
-- titular que no coincide (y el intento repetido), el pago en línea que llega
-- a una reserva cerrada o ya pagada, y el pago de más que no tiene dónde quedar.
-- Las dos funciones vivas se editan desde su definición actual.
SET lock_timeout = '5s';

DO $do$
DECLARE v text; n int;
BEGIN
  -- puntos_consumir_canje: un saldo a favor descontado en una factura cuyo
  -- cliente no es el de la reserva (una cuenta unida, otra ficha).
  v := pg_get_functiondef('public.puntos_consumir_canje(bigint, integer, bigint)'::regprocedure);
  n := (length(v) - length(replace(v, $a$       WHERE s.id = p_salida_id AND m.puntos_lote_id = r.id AND m.invoice_id IS NULL;
    END IF;$a$, ''))) / length($a$       WHERE s.id = p_salida_id AND m.puntos_lote_id = r.id AND m.invoice_id IS NULL;
    END IF;$a$);
  IF n <> 1 THEN RAISE EXCEPTION 'puntos_consumir_canje: ancla encontrada % veces', n; END IF;
  v := replace(v, $a$       WHERE s.id = p_salida_id AND m.puntos_lote_id = r.id AND m.invoice_id IS NULL;
    END IF;$a$, $a$       WHERE s.id = p_salida_id AND m.puntos_lote_id = r.id AND m.invoice_id IS NULL;
      -- Descontado en una factura a otro nombre (2026-10-21): queda anotado.
      PERFORM public.saldo_favor_anotar('saldo_otro_nombre:' || p_salida_id || ':' || r.id, 'saldo_favor_otro_nombre',
                ar.customer_id, si.branch_id, si.id, NULL, round(v_toma / 100.0, 2),
                format('Se descontaron %s del saldo a favor de %s en la factura %s, que está a nombre de %s y no de %s.',
                       to_char(v_toma / 100.0, 'FM$999,990.00'), coalesce(ar.pedido, 'R-' || lpad(ar.id::text, 6, '0')),
                       coalesce(si.correlativo, si.id::text), coalesce(cf.name, 'consumidor final'), coalesce(cr.name, 'su titular')),
                jsonb_build_object('reserva_id', ar.id, 'cliente_factura', si.customer_id, 'lote', r.id))
        FROM public.puntos_salida s
        JOIN public.sales_invoices si ON si.id = s.invoice_id
        JOIN public.saldo_favor_movimientos mv ON mv.puntos_lote_id = r.id AND mv.tipo = 'uso'
        JOIN public.app_reservas ar ON ar.id = mv.reserva_id
        LEFT JOIN public.customers cf ON cf.id = si.customer_id
        LEFT JOIN public.customers cr ON cr.id = ar.customer_id
       WHERE s.id = p_salida_id AND si.customer_id IS DISTINCT FROM ar.customer_id;
    END IF;$a$);
  EXECUTE v;

  -- app_reserva_pago_confirmar: tres puntos.
  v := pg_get_functiondef('public.app_reserva_pago_confirmar(text, text, numeric, boolean, text, text, jsonb)'::regprocedure);
  IF (length(v) - length(replace(v, $a$    IF r.pago_estado = 'pagado' THEN CONTINUE; END IF;$a$, ''))) / length($a$    IF r.pago_estado = 'pagado' THEN CONTINUE; END IF;$a$) <> 1 THEN
    RAISE EXCEPTION 'pago_confirmar: ancla A';
  END IF;
  v := replace(v, $a$    IF r.pago_estado = 'pagado' THEN CONTINUE; END IF;$a$, $a$    IF r.pago_estado = 'pagado' THEN
      -- Anotado (2026-10-21): un pago real sobre una reserva ya pagada.
      IF p_es_real THEN
        PERFORM public.saldo_favor_anotar('pago_repetido:' || p.id || ':' || r.id, 'saldo_favor_pago_repetido',
          r.customer_id, r.branch_id, NULL, NULL, round(coalesce(r.precio_unitario, 0) * r.cantidad, 2),
          format('Llegó un pago en línea para %s, que ya estaba pagada (transacción %s): lo de más queda a favor o hay que devolverlo.',
                 coalesce(r.pedido, 'R-' || lpad(r.id::text, 6, '0')), p_id_transaccion),
          jsonb_build_object('reserva_id', r.id, 'pago_id', p.id, 'monto_pago', p.monto));
      END IF;
      CONTINUE;
    END IF;$a$);

  IF (length(v) - length(replace(v, $a$      v_saldo := v_saldo + round(coalesce(r.precio_unitario, 0) * r.cantidad, 2);$a$, ''))) / length($a$      v_saldo := v_saldo + round(coalesce(r.precio_unitario, 0) * r.cantidad, 2);$a$) <> 1 THEN
    RAISE EXCEPTION 'pago_confirmar: ancla B';
  END IF;
  v := replace(v, $a$      v_saldo := v_saldo + round(coalesce(r.precio_unitario, 0) * r.cantidad, 2);$a$, $a$      v_saldo := v_saldo + round(coalesce(r.precio_unitario, 0) * r.cantidad, 2);
      -- Anotado (2026-10-21): un pago real que llega a una reserva ya cerrada.
      IF p_es_real THEN
        PERFORM public.saldo_favor_anotar('pago_tardio:' || p.id || ':' || r.id, 'saldo_favor_pago_tardio',
          r.customer_id, r.branch_id, NULL, NULL, round(coalesce(r.precio_unitario, 0) * r.cantidad, 2),
          format('Llegó un pago en línea para %s cuando ya estaba %s (transacción %s): quedó a favor del cliente.',
                 coalesce(r.pedido, 'R-' || lpad(r.id::text, 6, '0')), r.estado, p_id_transaccion),
          jsonb_build_object('reserva_id', r.id, 'pago_id', p.id, 'estado', r.estado));
      END IF;$a$);

  IF (length(v) - length(replace(v, $a$        SELECT array_agg(e.id) INTO v_dest FROM public.employees e
         WHERE e.status = 'ACTIVO' AND public.rango_de_empleado(e.id) >= 3;$a$, ''))) / length($a$        SELECT array_agg(e.id) INTO v_dest FROM public.employees e
         WHERE e.status = 'ACTIVO' AND public.rango_de_empleado(e.id) >= 3;$a$) <> 1 THEN
    RAISE EXCEPTION 'pago_confirmar: ancla C';
  END IF;
  v := replace(v, $a$        SELECT array_agg(e.id) INTO v_dest FROM public.employees e
         WHERE e.status = 'ACTIVO' AND public.rango_de_empleado(e.id) >= 3;$a$, $a$        -- Anotado (2026-10-21): el sobrante no tiene dónde quedar a favor.
        PERFORM public.saldo_favor_anotar('sobrante_descartado:' || p.id, 'saldo_favor_sobrante_descartado',
          p.customer_id, (SELECT x.branch_id FROM public.app_reservas x WHERE x.id = ANY (v_ids) ORDER BY x.id LIMIT 1),
          NULL, NULL, round(v_resto, 2),
          format('El %s recibió %s de más (transacción %s) y no hay dónde dejarlo a favor: hay que devolverlo al cliente.',
                 coalesce('pedido ' || p.pedido, 'R-' || lpad(p.reserva_id::text, 6, '0')),
                 to_char(round(v_resto, 2), 'FM$999,990.00'), p_id_transaccion),
          jsonb_build_object('pago_id', p.id, 'pedido', p.pedido, 'reserva_id', p.reserva_id));
        SELECT array_agg(e.id) INTO v_dest FROM public.employees e
         WHERE e.status = 'ACTIVO' AND public.rango_de_empleado(e.id) >= 3;$a$);
  EXECUTE v;
END $do$;
