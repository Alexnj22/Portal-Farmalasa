-- Un pago en línea cubre lo que le FALTABA a la reserva (`reserva_cuenta`),
-- no su total: con un anticipo de caja, lo cobrado de más se detecta como
-- sobrante en vez de darse por aplicado (auditoría 2026-10-21, punto 3). El
-- plazo de la pagada sale de `reserva_plazos()`.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.app_reserva_pago_confirmar(p_identificador text, p_id_transaccion text, p_monto numeric, p_es_real boolean, p_codigo text, p_forma text, p_detalle jsonb)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  p public.app_reservas_pagos;
  r public.app_reservas;
  v_ids bigint[];
  v_cubiertos bigint[] := '{}';
  v_aplicado numeric := 0;
  v_saldo numeric := 0;
  v_envio numeric := 0;
  v_resto numeric;
  v_destino bigint;
  v_dest uuid[];
  k record;
BEGIN
  SELECT * INTO p FROM public.app_reservas_pagos WHERE identificador = p_identificador FOR UPDATE;
  IF NOT FOUND THEN RETURN json_build_object('ok', false, 'motivo', 'sin_pago'); END IF;
  IF p.estado = 'aprobado' THEN
    RETURN json_build_object('ok', true, 'ya', true, 'reserva_id', p.reserva_id, 'pedido', p.pedido, 'encargo_id', p.encargo_id,
                             'credito', p.credito_erp IS NOT NULL, 'pago_id', p.id, 'abono_estado', p.abono_estado);
  END IF;
  IF EXISTS (SELECT 1 FROM public.app_reservas_pagos WHERE id_transaccion = p_id_transaccion AND id <> p.id) THEN
    RETURN json_build_object('ok', false, 'motivo', 'tx_usada');
  END IF;
  IF round(p_monto, 2) <> p.monto THEN
    RETURN json_build_object('ok', false, 'motivo', 'monto', 'esperado', p.monto, 'recibido', p_monto);
  END IF;

  UPDATE public.app_reservas_pagos
     SET estado = 'aprobado', id_transaccion = p_id_transaccion, es_real = p_es_real,
         codigo_autorizacion = p_codigo, forma_pago = p_forma, detalle = p_detalle, pagado_at = now()
   WHERE id = p.id;

  -- Un crédito (2026-10-20): cobrado; el abono en la caja lo hace quien llama
  -- (`_shared/creditoEnLinea.ts`), fuera de esta transacción. Un cobro de
  -- PRUEBA queda en 'prueba' y no se abona nunca.
  IF p.credito_erp IS NOT NULL THEN
    UPDATE public.app_reservas_pagos
       SET abono_estado = CASE WHEN p_es_real THEN 'pendiente' ELSE 'prueba' END
     WHERE id = p.id;
    INSERT INTO public.audit_logs (action, target_id, details, branch_id, source)
    VALUES ('CREDITO_PAGADO_EN_LINEA', p.credito_erp,
            jsonb_build_object('monto', p.monto, 'transaccion', p_id_transaccion, 'es_real', p_es_real,
                               'pago_id', p.id, 'customer_id', p.customer_id),
            p.credito_branch_id, 'SYSTEM');
    RETURN json_build_object('ok', true, 'credito', true, 'pago_id', p.id, 'prueba', NOT p_es_real);
  END IF;

  -- Un encargo: pagado el anticipo, queda ACEPTADO para que se pida.
  IF p.encargo_id IS NOT NULL THEN
    UPDATE public.app_encargos SET pago_estado = 'pagado', pagado_at = now(), updated_at = now(),
           estado = CASE WHEN estado = 'confirmado' THEN 'aceptado' ELSE estado END
     WHERE id = p.encargo_id;
    INSERT INTO public.audit_logs (action, target_id, details, source)
    VALUES ('ENCARGO_PAGADO_EN_LINEA', p.encargo_id::text,
            jsonb_build_object('monto', p.monto, 'transaccion', p_id_transaccion, 'es_real', p_es_real), 'SYSTEM');
    RETURN json_build_object('ok', true, 'encargo_id', p.encargo_id, 'prueba', NOT p_es_real);
  END IF;

  SELECT array_agg(id ORDER BY id) INTO v_ids FROM public.app_reservas
   WHERE (p.pedido IS NOT NULL AND pedido = p.pedido) OR (p.pedido IS NULL AND id = p.reserva_id);

  FOR r IN SELECT * FROM public.app_reservas WHERE id = ANY (v_ids) ORDER BY id FOR UPDATE LOOP
    -- Lo que no entró en el monto: los renglones que el cobro no cubre (o, en
    -- un cobro sin esa lista, los que ya estaban cerrados al crearlo).
    IF (p.reservas_ids IS NOT NULL AND NOT (r.id = ANY (p.reservas_ids)))
       OR (p.reservas_ids IS NULL AND r.estado IN ('vencida', 'cancelada') AND r.cerrada_at IS NOT NULL AND r.cerrada_at < p.created_at) THEN
      CONTINUE;
    END IF;
    v_cubiertos := v_cubiertos || r.id;
    v_envio := greatest(v_envio, coalesce(r.costo_envio, 0));
    -- Ya pagada por otro cobro: este monto sobra (queda a favor, abajo).
    IF r.pago_estado = 'pagado' THEN CONTINUE; END IF;
    -- Lo que este cobro cubre de la fila es lo que le FALTABA (`reserva_cuenta`:
    -- descuenta un anticipo de caja), sin su envío, que va aparte.
    SELECT * INTO k FROM public.reserva_cuenta(r.id);
    UPDATE public.app_reservas
       SET pago_estado = 'pagado', pago_metodo = 'en_linea', pagado_at = now(), updated_at = now(),
           pago_prueba = NOT p_es_real,
           vence_at = CASE WHEN estado = 'lista' THEN lista_at + make_interval(days => (SELECT pl.dias_pagada FROM public.reserva_plazos() pl)) ELSE vence_at END
     WHERE id = r.id;
    IF r.estado IN ('vencida', 'cancelada') THEN
      v_saldo := v_saldo + round(coalesce(r.precio_unitario, 0) * r.cantidad, 2);
    ELSE
      v_aplicado := v_aplicado + greatest(round(k.falta_pagar - coalesce(r.costo_envio, 0), 2), 0);
    END IF;
    INSERT INTO public.audit_logs (action, target_id, details, branch_id, source)
    VALUES (CASE WHEN r.estado IN ('vencida', 'cancelada') THEN 'RESERVA_PAGO_TARDIO_A_FAVOR' ELSE 'RESERVA_PAGADA_EN_LINEA' END, r.id::text,
            jsonb_build_object('monto', p.monto, 'transaccion', p_id_transaccion, 'es_real', p_es_real,
                               'estado_antes', r.estado, 'forma', p_forma, 'pedido', p.pedido),
            r.branch_id, 'SYSTEM');
  END LOOP;

  -- Lo que sobra del monto: el envío se usó si algo del pedido sigue en pie; lo
  -- de renglones cerrados ya quedó a favor (trigger, con el envío si todo el
  -- pedido se cerró). Si aun así sobra, es un cobro duplicado sobre algo ya
  -- pagado. Va a favor en un renglón CERRADO y sin saldo; nunca en uno abierto,
  -- porque ese lugar lo necesita su propio saldo si después se cancela (medido
  -- en pruebas: puesto en el abierto, al cancelarlo se perdía lo suyo). Si no
  -- hay dónde, queda en la bitácora y se avisa a supervisión para devolverlo a
  -- mano. Sólo con dinero real.
  IF p_es_real THEN
    v_resto := p.monto - v_aplicado - v_saldo - CASE WHEN v_aplicado > 0 THEN v_envio ELSE 0 END
               - coalesce((SELECT sum(costo_envio) FROM public.app_reservas
                            WHERE id = ANY (v_cubiertos) AND saldo_incluye_envio
                              AND saldo_favor_origen = 'pago_tardio'), 0);
    IF v_resto > 0.005 THEN
      SELECT id INTO v_destino FROM public.app_reservas
       WHERE id = ANY (v_ids) AND estado IN ('vencida', 'cancelada') AND saldo_favor IS NULL ORDER BY id LIMIT 1;
      IF v_destino IS NOT NULL THEN
        UPDATE public.app_reservas
           SET saldo_favor = round(v_resto, 2), saldo_favor_origen = 'pago_duplicado',
               saldo_favor_vence = (now() AT TIME ZONE 'America/El_Salvador')::date + public.saldo_favor_dias(), updated_at = now()
         WHERE id = v_destino;
      ELSE
        SELECT array_agg(e.id) INTO v_dest FROM public.employees e
         WHERE e.status = 'ACTIVO' AND public.rango_de_empleado(e.id) >= 3;
        IF v_dest IS NOT NULL THEN
          PERFORM public.notify_employees(v_dest, 'PAGO_EN_LINEA_DE_MAS', 'Pago en línea de más',
            'El ' || coalesce('pedido ' || p.pedido, 'R-' || lpad(p.reserva_id::text, 6, '0')) || ' recibió $'
              || to_char(round(v_resto, 2), 'FM999990.00') || ' de más (transacción ' || p_id_transaccion || '). Hay que devolverlo al cliente.',
            '/', jsonb_build_object('check_key', 'pago-de-mas:' || p_id_transaccion), true, NULL);
        END IF;
      END IF;
      INSERT INTO public.audit_logs (action, target_id, details, source)
      VALUES ('RESERVA_PAGO_SOBRANTE', coalesce(p.pedido, p.reserva_id::text),
              jsonb_build_object('monto', p.monto, 'sobrante', round(v_resto, 2), 'a_favor_en', v_destino,
                                 'transaccion', p_id_transaccion), 'SYSTEM');
    END IF;
  END IF;

  RETURN json_build_object('ok', true, 'reserva_id', p.reserva_id, 'pedido', p.pedido,
                           'reservas', coalesce(array_length(v_cubiertos, 1), 0), 'prueba', NOT p_es_real);
END;
$function$;
