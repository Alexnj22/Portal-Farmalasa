-- Reglamento de reservas v3 (2026-10-22): la sala manda un ENLACE DE PAGO para
-- el anticipo de un apartado (o el pago de un encargo confirmado). El enlace lo
-- crea `operar-caja` (acción `enlace_apartado`) con la llave de Wompi; la base
-- prepara el cobro, y `app_reserva_pago_confirmar` lo suma al anticipo cuando
-- Wompi lo aprueba. El retiro ya lo trata como pago en línea
-- (`apartado_para_retirar`: en_linea = pagado − efectivo − otras formas).
SET lock_timeout = '5s';

ALTER TABLE public.app_reservas_pagos
  ADD COLUMN IF NOT EXISTS es_anticipo boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS creado_por uuid;
COMMENT ON COLUMN public.app_reservas_pagos.es_anticipo IS
  'Enlace de anticipo mandado por la sala: al aprobarse suma al anticipo del apartado, no lo da por pagado entero.';

-- Prepara el cobro. Para un apartado NUEVO crea la reserva ya, sin pagar, con
-- el plazo de una reserva sin pagar (3 días): el producto queda separado
-- mientras el cliente paga. Si Wompi no da el enlace, `apartado_enlace_anular`.
CREATE OR REPLACE FUNCTION public.apartado_enlace_preparar(p_branch_id bigint, p_apartado jsonb, p_monto numeric, p_employee uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_cot json := public.apartado_cotizar(p_branch_id, p_apartado);
  v_modo text := p_apartado->>'modo';
  v_desde bigint := nullif(p_apartado->>'traslado_desde', '')::bigint;
  v_monto numeric := round(p_monto, 2);
  v_reserva bigint; v_encargo bigint; v_cliente bigint; v_codigo text; v_ident text; v_vence timestamptz;
  c record;
BEGIN
  IF v_monto IS NULL OR v_monto < (v_cot->>'minimo')::numeric - 0.004 OR v_monto > (v_cot->>'maximo')::numeric + 0.004 THEN
    RAISE EXCEPTION 'El cobro va de % a %.', to_char((v_cot->>'minimo')::numeric, 'FM$999,990.00'),
      to_char((v_cot->>'maximo')::numeric, 'FM$999,990.00');
  END IF;

  IF v_modo = 'nueva' THEN
    v_cliente := (p_apartado->>'customer_id')::bigint;
    INSERT INTO public.app_reservas (customer_id, branch_id, origen, producto_id, producto_nombre, cantidad, factor,
        precio_unitario, precio_normal, estado, terminos_version, anticipo, lista_at, vence_at, preparada_por,
        pendiente_at, traslado_desde, pago_estado)
    VALUES (v_cliente, p_branch_id, 'sucursal', (p_apartado->>'producto_id')::bigint,
        left(btrim(p_apartado->>'producto_nombre'), 200), (p_apartado->>'cantidad')::integer,
        greatest(coalesce((p_apartado->>'factor')::integer, 1), 1),
        round((p_apartado->>'precio')::numeric, 2), round((p_apartado->>'precio')::numeric, 2),
        CASE WHEN v_desde IS NULL THEN 'lista' ELSE 'pendiente' END, 'sucursal-v3', 0,
        CASE WHEN v_desde IS NULL THEN now() END,
        CASE WHEN v_desde IS NULL THEN now() + make_interval(days => (SELECT p.dias_sin_pagar FROM public.reserva_plazos() p)) END,
        CASE WHEN v_desde IS NULL THEN p_employee END,
        CASE WHEN v_desde IS NOT NULL THEN now() END, v_desde, 'pendiente')
    RETURNING id, vence_at INTO v_reserva, v_vence;
    v_codigo := 'R-' || lpad(v_reserva::text, 6, '0');
  ELSIF v_modo = 'reserva' THEN
    v_reserva := (p_apartado->>'reserva_id')::bigint;
    SELECT customer_id, vence_at INTO v_cliente, v_vence FROM public.app_reservas WHERE id = v_reserva;
    v_codigo := 'R-' || lpad(v_reserva::text, 6, '0');
  ELSIF v_modo = 'encargo' THEN
    v_encargo := (p_apartado->>'encargo_id')::bigint;
    SELECT customer_id INTO v_cliente FROM public.app_encargos WHERE id = v_encargo;
    v_codigo := 'E-' || lpad(v_encargo::text, 6, '0');
  ELSE
    RAISE EXCEPTION 'No se sabe qué se está apartando.';
  END IF;

  -- «AP-»: la vuelta del navegador sabe que quien paga puede no tener la app.
  v_ident := 'AP-' || v_codigo || '-' || to_hex((extract(epoch FROM clock_timestamp()) * 1000)::bigint);
  INSERT INTO public.app_reservas_pagos (reserva_id, encargo_id, identificador, monto, customer_id, es_anticipo, creado_por)
  VALUES (v_reserva, v_encargo, v_ident, v_monto, v_cliente, v_encargo IS NULL, p_employee);

  SELECT name, phone INTO c FROM public.customers WHERE id = v_cliente;
  INSERT INTO public.audit_logs (action, target_id, details, branch_id, user_id, source)
  VALUES ('APARTADO_ENLACE_DE_PAGO', v_codigo,
          jsonb_build_object('monto', v_monto, 'identificador', v_ident, 'modo', v_modo, 'traslado_desde', v_desde),
          p_branch_id, p_employee, 'ADMIN_PANEL');
  RETURN json_build_object('identificador', v_ident, 'codigo', v_codigo, 'monto', v_monto,
    'reserva_id', v_reserva, 'encargo_id', v_encargo, 'nueva', v_modo = 'nueva', 'vence_at', v_vence,
    'cliente', c.name, 'telefono', c.phone, 'detalle', v_cot->>'detalle', 'total', (v_cot->>'total')::numeric);
END $function$;

CREATE OR REPLACE FUNCTION public.apartado_enlace_guardar(p_identificador text, p_enlace_id bigint, p_url text, p_prueba boolean)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
  UPDATE public.app_reservas_pagos SET enlace_id = p_enlace_id, enlace_url = p_url, enlace_prueba = p_prueba
   WHERE identificador = p_identificador AND estado = 'creado';
$function$;

-- Wompi no dio el enlace: se borra el cobro y, si la reserva nació para él y
-- nadie le pagó nada, se cancela (el producto vuelve a estar disponible).
CREATE OR REPLACE FUNCTION public.apartado_enlace_anular(p_identificador text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE p public.app_reservas_pagos;
BEGIN
  SELECT * INTO p FROM public.app_reservas_pagos WHERE identificador = p_identificador AND estado = 'creado' FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  DELETE FROM public.app_reservas_pagos WHERE id = p.id;
  IF p.reserva_id IS NOT NULL THEN
    UPDATE public.app_reservas SET estado = 'cancelada', cerrada_at = now(), updated_at = now()
     WHERE id = p.reserva_id AND origen = 'sucursal' AND coalesce(anticipo, 0) = 0 AND pago_estado = 'pendiente'
       AND estado IN ('pendiente', 'lista') AND created_at > now() - interval '10 minutes'
       AND NOT EXISTS (SELECT 1 FROM public.app_reservas_pagos x WHERE x.reserva_id = p.reserva_id);
  END IF;
END $function$;

-- Las tres sólo desde el servidor: `operar-caja` ya miró permiso y sala.
REVOKE EXECUTE ON FUNCTION public.apartado_enlace_preparar(bigint, jsonb, numeric, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.apartado_enlace_guardar(text, bigint, text, boolean) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.apartado_enlace_anular(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apartado_enlace_preparar(bigint, jsonb, numeric, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.apartado_enlace_guardar(text, bigint, text, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.apartado_enlace_anular(text) TO service_role;

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

  -- Un ANTICIPO por enlace de la sala (reglamento v3, 2026-10-22): suma al
  -- anticipo del apartado —no lo da por pagado entero— y, si era el primer
  -- pago, el plazo pasa de «sin pagar» a los días de un apartado. Lo que no
  -- cabe (ya lo pagaron en caja, o la reserva se cerró) queda anotado para
  -- devolverlo o dejarlo a favor.
  IF p.es_anticipo AND p.reserva_id IS NOT NULL THEN
    SELECT * INTO r FROM public.app_reservas WHERE id = p.reserva_id FOR UPDATE;
    IF NOT p_es_real THEN
      INSERT INTO public.audit_logs (action, target_id, details, branch_id, source)
      VALUES ('RESERVA_ANTICIPO_EN_LINEA_PRUEBA', r.id::text,
              jsonb_build_object('monto', p.monto, 'transaccion', p_id_transaccion), r.branch_id, 'SYSTEM');
      RETURN json_build_object('ok', true, 'reserva_id', r.id, 'anticipo', true, 'prueba', true);
    END IF;
    IF r.estado IN ('pendiente', 'lista') THEN
      SELECT * INTO k FROM public.reserva_cuenta(r.id);
      v_aplicado := round(least(p.monto, k.falta_pagar), 2);
      UPDATE public.app_reservas
         SET anticipo = round(coalesce(anticipo, 0) + v_aplicado, 2),
             pago_estado = CASE WHEN round(coalesce(anticipo, 0) + v_aplicado, 2) >= k.total - 0.004 THEN 'pagado' ELSE 'anticipo' END,
             pago_metodo = CASE WHEN coalesce(anticipo, 0) <= 0.004 THEN 'en_linea' ELSE pago_metodo END, pagado_at = coalesce(pagado_at, now()), updated_at = now(),
             vence_at = CASE WHEN estado = 'lista' AND coalesce(anticipo, 0) <= 0.004
                             THEN greatest(vence_at, lista_at + make_interval(days => (SELECT pl.dias_apartado FROM public.reserva_plazos() pl)))
                             ELSE vence_at END
       WHERE id = r.id;
    END IF;
    v_resto := round(p.monto - v_aplicado, 2);
    IF v_resto > 0.005 THEN
      PERFORM public.saldo_favor_anotar('anticipo_de_mas:' || p.id, 'saldo_favor_pago_repetido',
        r.customer_id, r.branch_id, NULL, NULL, v_resto,
        format('El anticipo en línea de R-%s llegó por %s y sólo cabían %s (transacción %s): lo de más hay que devolverlo o dejarlo a favor.',
               lpad(r.id::text, 6, '0'), to_char(p.monto, 'FM$999,990.00'), to_char(v_aplicado, 'FM$999,990.00'), p_id_transaccion),
        jsonb_build_object('reserva_id', r.id, 'pago_id', p.id, 'estado', r.estado));
    END IF;
    INSERT INTO public.audit_logs (action, target_id, details, branch_id, source)
    VALUES ('RESERVA_ANTICIPO_EN_LINEA', r.id::text,
            jsonb_build_object('monto', p.monto, 'aplicado', v_aplicado, 'de_mas', v_resto, 'transaccion', p_id_transaccion,
                               'forma', p_forma, 'estado_antes', r.estado), r.branch_id, 'SYSTEM');
    v_dest := public.destinatarios_de_reservas(r.branch_id);
    IF v_dest IS NOT NULL THEN
      PERFORM public.notify_employees(v_dest, 'RESERVA_APP',
        'Anticipo en línea · R-' || lpad(r.id::text, 6, '0'),
        to_char(p.monto, 'FM$999,990.00') || ' pagados en línea por ' || coalesce(r.producto_nombre, 'el apartado')
          || CASE WHEN v_resto > 0.005 THEN '. Llegó de más: revisa el saldo a favor.' ELSE '.' END,
        '/reservas', jsonb_build_object('check_key', 'anticipo_en_linea:' || p.id, 'reserva_id', r.id),
        true, r.branch_id::integer);
    END IF;
    RETURN json_build_object('ok', true, 'reserva_id', r.id, 'anticipo', true, 'aplicado', v_aplicado, 'prueba', false);
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
    IF r.pago_estado = 'pagado' THEN
      -- Anotado (2026-10-21): un pago real sobre una reserva ya pagada.
      IF p_es_real THEN
        PERFORM public.saldo_favor_anotar('pago_repetido:' || p.id || ':' || r.id, 'saldo_favor_pago_repetido',
          r.customer_id, r.branch_id, NULL, NULL, round(coalesce(r.precio_unitario, 0) * r.cantidad, 2),
          format('Llegó un pago en línea para %s, que ya estaba pagada (transacción %s): lo de más queda a favor o hay que devolverlo.',
                 coalesce(r.pedido, 'R-' || lpad(r.id::text, 6, '0')), p_id_transaccion),
          jsonb_build_object('reserva_id', r.id, 'pago_id', p.id, 'monto_pago', p.monto));
      END IF;
      CONTINUE;
    END IF;
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
      -- Anotado (2026-10-21): un pago real que llega a una reserva ya cerrada.
      IF p_es_real THEN
        PERFORM public.saldo_favor_anotar('pago_tardio:' || p.id || ':' || r.id, 'saldo_favor_pago_tardio',
          r.customer_id, r.branch_id, NULL, NULL, round(coalesce(r.precio_unitario, 0) * r.cantidad, 2),
          format('Llegó un pago en línea para %s cuando ya estaba %s (transacción %s): quedó a favor del cliente.',
                 coalesce(r.pedido, 'R-' || lpad(r.id::text, 6, '0')), r.estado, p_id_transaccion),
          jsonb_build_object('reserva_id', r.id, 'pago_id', p.id, 'estado', r.estado));
      END IF;
    ELSE
      v_aplicado := v_aplicado + greatest(round(k.falta_pagar - public.reserva_envio(r.id), 2), 0);
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
        -- Anotado (2026-10-21): el sobrante no tiene dónde quedar a favor.
        PERFORM public.saldo_favor_anotar('sobrante_descartado:' || p.id, 'saldo_favor_sobrante_descartado',
          p.customer_id, (SELECT x.branch_id FROM public.app_reservas x WHERE x.id = ANY (v_ids) ORDER BY x.id LIMIT 1),
          NULL, NULL, round(v_resto, 2),
          format('El %s recibió %s de más (transacción %s) y no hay dónde dejarlo a favor: hay que devolverlo al cliente.',
                 coalesce('pedido ' || p.pedido, 'R-' || lpad(p.reserva_id::text, 6, '0')),
                 to_char(round(v_resto, 2), 'FM$999,990.00'), p_id_transaccion),
          jsonb_build_object('pago_id', p.id, 'pedido', p.pedido, 'reserva_id', p.reserva_id));
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
