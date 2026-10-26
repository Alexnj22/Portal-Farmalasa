-- Reservas: arreglos de la revisión del 2026-10-26, alineados al reglamento de
-- reservas y encargos especiales (docs/legal/reglamento-de-reservas.html).
-- Cada función parte de su definición VIVA (pg_get_functiondef).
SET lock_timeout = '5s';


-- 1 · Los plazos de UNA reserva se deciden por su propia fecha (la de «lista»),
-- no por la de hoy. Es el mismo criterio de `app_reservas_guardas`: un juez.
-- Reglamento, cláusula 1: lo emitido antes de su vigencia se rige por sus
-- condiciones. Sin esto, una reserva v1 lista antes del 15-nov perdía su
-- prórroga el 15-nov, y un pago en línea la pasaba a los días de v2.

CREATE OR REPLACE FUNCTION public.reserva_plazos(p_en timestamp with time zone, OUT dias_pagada integer, OUT dias_apartado integer, OUT horas_sin_foto integer, OUT horas_receta_sin_revisar integer, OUT horas_para_preparar integer, OUT dias_saldo_favor integer, OUT dias_sin_pagar integer, OUT dias_prorroga integer, OUT dias_encargo integer)
 RETURNS record
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT CASE WHEN v THEN 60 ELSE 7 END, CASE WHEN v THEN 30 ELSE 7 END, 24, 24, 24,
         public.saldo_favor_dias(), CASE WHEN v THEN 7 ELSE 3 END, CASE WHEN v THEN 0 ELSE 7 END,
         CASE WHEN v THEN 60 ELSE 7 END
    FROM (SELECT public.reservas_v2_rige(p_en) AS v) x;
$function$;

REVOKE EXECUTE ON FUNCTION public.reserva_plazos(timestamp with time zone) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reserva_plazos(timestamp with time zone) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.reserva_prorrogable(r app_reservas)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT r.estado = 'lista' AND r.vence_at IS NOT NULL AND r.prorrogada_at IS NULL AND NOT public.reservas_v2_rige(r.lista_at);
$function$;

CREATE OR REPLACE FUNCTION public.reserva_prorrogar(p_id bigint)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE r public.app_reservas; v_emp uuid := public.auth_employee_id(); v_vence timestamptz; v_codigo text;
BEGIN
  SELECT * INTO r FROM public.app_reservas WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Esa reserva no existe.'; END IF;
  IF public.reservas_v2_rige(r.lista_at) THEN
    RAISE EXCEPTION 'Los plazos para retirar ya no se prorrogan.' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public.reserva_puede_manejar(r.branch_id) THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501'; END IF;
  IF r.estado <> 'lista' OR r.vence_at IS NULL THEN RAISE EXCEPTION 'Sólo se prorroga una reserva lista para retirar.'; END IF;
  IF r.prorrogada_at IS NOT NULL THEN RAISE EXCEPTION 'Esta reserva ya se prorrogó una vez: no admite otra prórroga.'; END IF;
  UPDATE public.app_reservas
     SET vence_at = vence_at + make_interval(days => (SELECT p.dias_prorroga FROM public.reserva_plazos(r.lista_at) p)),
         prorrogada_at = now(), prorrogada_por = v_emp, updated_at = now()
   WHERE id = p_id RETURNING vence_at INTO v_vence;
  v_codigo := coalesce(r.pedido, 'R-' || lpad(p_id::text, 6, '0'));
  IF r.origen = 'app' THEN
    INSERT INTO public.app_cliente_avisos (customer_id, tipo, ref, titulo, cuerpo, url)
    VALUES (r.customer_id, 'reserva', 'base:prorroga:' || p_id, 'Tu reserva tiene más plazo',
            'Puedes retirar ' || coalesce(r.producto_nombre, 'tu reserva') || ' hasta el '
              || to_char((v_vence AT TIME ZONE 'America/El_Salvador')::date, 'DD/MM/YYYY') || ', todo el día.',
            '/reservas')
    ON CONFLICT (customer_id, tipo, ref) DO NOTHING;
  END IF;
  INSERT INTO public.audit_logs (user_id, action, target_id, details, branch_id, source)
  VALUES (v_emp, 'RESERVA_PRORROGADA', p_id::text, jsonb_build_object('antes', r.vence_at, 'ahora', v_vence), r.branch_id, 'ADMIN_PANEL');
  RETURN json_build_object('ok', true, 'codigo', v_codigo, 'vence_at', v_vence);
END $function$;

CREATE OR REPLACE FUNCTION public.reserva_prorrogar_por_cliente(p_id bigint, p_customer bigint)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE r public.app_reservas; v_vence timestamptz; v_codigo text; v_dest uuid[];
BEGIN
  SELECT * INTO r FROM public.app_reservas WHERE id = p_id AND customer_id = p_customer FOR UPDATE;
  IF NOT FOUND OR r.estado <> 'lista' OR r.vence_at IS NULL THEN
    RETURN json_build_object('ok', false, 'mensaje', 'Sólo se puede pedir más plazo cuando la reserva ya está lista para retirar.');
  END IF;
  IF public.reservas_v2_rige(r.lista_at) THEN
    RETURN json_build_object('ok', false, 'mensaje', 'Los plazos para retirar no se prorrogan.');
  END IF;
  IF r.prorrogada_at IS NOT NULL THEN
    RETURN json_build_object('ok', false, 'mensaje', 'Esta reserva ya tuvo su prórroga: no admite otra.');
  END IF;
  UPDATE public.app_reservas
     SET vence_at = vence_at + make_interval(days => (SELECT p.dias_prorroga FROM public.reserva_plazos(r.lista_at) p)),
         prorrogada_at = now(), updated_at = now()
   WHERE id = p_id RETURNING vence_at INTO v_vence;
  v_codigo := coalesce(r.pedido, 'R-' || lpad(p_id::text, 6, '0'));
  INSERT INTO public.audit_logs (action, target_id, details, branch_id, source)
  VALUES ('RESERVA_PRORROGADA', p_id::text, jsonb_build_object('antes', r.vence_at, 'ahora', v_vence, 'desde', 'app', 'customer_id', p_customer), r.branch_id, 'SYSTEM');
  v_dest := public.destinatarios_de_reservas(r.branch_id);
  IF v_dest IS NOT NULL THEN
    PERFORM public.notify_employees(v_dest, 'RESERVA_APP', 'Prórroga de ' || v_codigo,
      'El cliente pidió más plazo desde la app: retira hasta el '
        || to_char((v_vence AT TIME ZONE 'America/El_Salvador')::date, 'DD/MM/YYYY') || '. Sigue separada.',
      '/reservas', jsonb_build_object('check_key', 'reserva_prorroga_cliente:' || p_id, 'reserva_id', p_id),
      false, r.branch_id::integer);
  END IF;
  RETURN json_build_object('ok', true, 'vence_at', v_vence);
END $function$;


-- 2 · Un solo juez del vencimiento de una reserva lista.
CREATE OR REPLACE FUNCTION public.reserva_plazo_hasta(r app_reservas)
 RETURNS timestamp with time zone
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT CASE
    WHEN r.estado = 'en_revision' AND coalesce(r.receta_estado, 'otra_foto') = 'otra_foto'
      THEN greatest(r.created_at, coalesce(r.receta_revisada_at, r.created_at)) + make_interval(hours => p.horas_sin_foto)
    WHEN r.estado = 'en_revision' AND r.receta_estado = 'pendiente'
      THEN r.receta_subida_at + make_interval(hours => p.horas_receta_sin_revisar)
    -- Viene en camino: el plazo de la sala está detenido.
    WHEN r.estado = 'pendiente' AND r.origen = 'app'
         AND (r.traslado_estado IN ('pedido', 'bodega') OR coalesce(r.traslado_por_llegar, 0) > 0)
      THEN NULL
    -- El traslado no salió, llegó una parte o Bodega dio otro precio: 24 h desde ese cambio.
    WHEN r.estado = 'pendiente' AND r.origen = 'app' AND r.traslado_estado IS NOT NULL
      THEN greatest(coalesce(r.pendiente_at, r.created_at), coalesce(r.traslado_cambio_at, r.updated_at)) + make_interval(hours => p.horas_para_preparar)
    WHEN r.estado = 'pendiente' AND r.origen = 'app'
      THEN coalesce(r.pendiente_at, r.created_at) + make_interval(hours => p.horas_para_preparar)
    -- Lista: vale TODO el día de su vencimiento, en hora de El Salvador
    -- (reglamento 3.4: «avisada un lunes, hasta el lunes siguiente»). Es lo
    -- mismo que mira `reservas_vencer`; antes éste decía la hora exacta y el
    -- cron la vencía al día siguiente: dos jueces.
    WHEN r.estado = 'lista' THEN
      ((((r.vence_at AT TIME ZONE 'America/El_Salvador')::date + 1)::timestamp) AT TIME ZONE 'America/El_Salvador') - interval '1 second'
  END
  FROM public.reserva_plazos() p;
$function$;


-- 3 · Pago en línea: encargos de prueba/tardíos, plazo que no se acorta, sobrante anotado una vez.
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
  enc public.app_encargos;
  v_saldo_id bigint;
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

  -- Un encargo: pagado el 100 %, queda ACEPTADO para que se pida (reglamento 4.3).
  -- (2026-10-26) Un cobro de PRUEBA no lo da por pagado: un encargo aceptado
  -- se le pide al proveedor, y sin dinero de verdad no se pide nada (igual que
  -- el anticipo de una reserva, abajo). Y un pago que llega cuando el encargo
  -- ya no espera pago —cancelado, rechazado o ya pagado— queda como SALDO A
  -- FAVOR del cliente (cláusulas 7 y 8); antes se marcaba «pagado» sobre un
  -- encargo cancelado y el dinero no quedaba en ninguna parte.
  IF p.encargo_id IS NOT NULL THEN
    SELECT * INTO enc FROM public.app_encargos WHERE id = p.encargo_id FOR UPDATE;
    IF NOT p_es_real THEN
      INSERT INTO public.audit_logs (action, target_id, details, branch_id, source)
      VALUES ('ENCARGO_PAGO_EN_LINEA_PRUEBA', p.encargo_id::text,
              jsonb_build_object('monto', p.monto, 'transaccion', p_id_transaccion, 'estado', enc.estado), enc.branch_id, 'SYSTEM');
      RETURN json_build_object('ok', true, 'encargo_id', p.encargo_id, 'prueba', true);
    END IF;
    IF enc.estado = 'confirmado' AND enc.pago_estado <> 'pagado' THEN
      UPDATE public.app_encargos SET pago_estado = 'pagado', pagado_at = now(), updated_at = now(), estado = 'aceptado'
       WHERE id = p.encargo_id;
      INSERT INTO public.audit_logs (action, target_id, details, branch_id, source)
      VALUES ('ENCARGO_PAGADO_EN_LINEA', p.encargo_id::text,
              jsonb_build_object('monto', p.monto, 'transaccion', p_id_transaccion, 'es_real', p_es_real), enc.branch_id, 'SYSTEM');
      RETURN json_build_object('ok', true, 'encargo_id', p.encargo_id, 'prueba', false);
    END IF;
    -- Llegó tarde o repetido. El saldo de un encargo vive en una fila
    -- cancelada de `app_reservas` (como `encargo_pasar_a_saldo`); un producto
    -- nuevo sin vincular no tiene `producto_id` para esa fila: se anota y se
    -- avisa a supervisión para resolverlo a mano.
    IF enc.product_id IS NOT NULL THEN
      INSERT INTO public.app_reservas (customer_id, branch_id, origen, producto_id, producto_nombre, cantidad, factor,
          precio_unitario, precio_normal, estado, terminos_version, anticipo, pago_estado, pago_metodo, pagado_at,
          cerrada_at, saldo_favor, saldo_favor_vence, saldo_favor_origen)
      VALUES (enc.customer_id, enc.branch_id, 'sucursal', enc.product_id,
          left('Encargo E-' || lpad(enc.id::text, 6, '0') || ' · ' || enc.producto_nombre, 200),
          1, greatest(coalesce(enc.factor, 1), 1), 0, 0, 'cancelada', 'encargo', p.monto, 'anticipo', 'en_linea', now(),
          now(), p.monto, (now() AT TIME ZONE 'America/El_Salvador')::date + public.saldo_favor_dias(),
          CASE WHEN enc.pago_estado = 'pagado' THEN 'pago_duplicado' ELSE 'pago_tardio' END)
      RETURNING id INTO v_saldo_id;
      UPDATE public.app_encargos SET saldo_reserva_id = coalesce(saldo_reserva_id, v_saldo_id), updated_at = now()
       WHERE id = enc.id;
      INSERT INTO public.app_cliente_avisos (customer_id, tipo, ref, titulo, cuerpo, url)
      VALUES (enc.customer_id, 'reserva', 'base:encargo_pago_tardio:' || p.id, 'Tu pago quedó como saldo a favor',
              'Recibimos ' || to_char(p.monto, 'FM$999,990.00') || ' por ' || coalesce(enc.producto_nombre, 'tu encargo')
                || CASE WHEN enc.pago_estado = 'pagado' THEN ', que ya estaba pagado' ELSE ', que ya no esperaba pago' END
                || '. Queda a tu favor por ' || public.saldo_favor_dias() || ' días, para otra compra en cualquier sucursal.',
              '/reservas')
      ON CONFLICT (customer_id, tipo, ref) DO NOTHING;
    ELSE
      PERFORM public.saldo_favor_anotar('encargo_pago_tardio:' || p.id, 'saldo_favor_pago_tardio',
        enc.customer_id, enc.branch_id, NULL, NULL, p.monto,
        format('Llegó un pago en línea de %s para el encargo E-%s (%s), que ya estaba %s (transacción %s). Es un producto sin vincular al catálogo: vincúlalo y déjalo a favor del cliente, o devuélveselo.',
               to_char(p.monto, 'FM$999,990.00'), lpad(enc.id::text, 6, '0'), enc.producto_nombre, enc.estado, p_id_transaccion),
        jsonb_build_object('encargo_id', enc.id, 'pago_id', p.id, 'estado', enc.estado));
    END IF;
    v_dest := public.destinatarios_de_reservas(enc.branch_id);
    IF v_dest IS NOT NULL THEN
      PERFORM public.notify_employees(v_dest, 'ENCARGO_APP',
        'Pago que llegó tarde · E-' || lpad(enc.id::text, 6, '0'),
        to_char(p.monto, 'FM$999,990.00') || ' pagados en línea por ' || coalesce(enc.producto_nombre, 'un encargo')
          || ' cuando ya estaba ' || enc.estado || CASE WHEN v_saldo_id IS NOT NULL THEN ': quedó como saldo a favor del cliente.' ELSE ': hay que resolverlo a mano.' END,
        '/reservas', jsonb_build_object('check_key', 'encargo_pago_tardio:' || p.id, 'encargo_id', enc.id),
        true, enc.branch_id::integer);
    END IF;
    INSERT INTO public.audit_logs (action, target_id, details, branch_id, source)
    VALUES ('ENCARGO_PAGO_TARDIO_A_FAVOR', enc.id::text,
            jsonb_build_object('monto', p.monto, 'transaccion', p_id_transaccion, 'estado', enc.estado,
                               'pago_estado', enc.pago_estado, 'reserva_saldo', v_saldo_id), enc.branch_id, 'SYSTEM');
    RETURN json_build_object('ok', true, 'encargo_id', p.encargo_id, 'prueba', false, 'a_favor', true);
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
                             THEN greatest(vence_at, lista_at + make_interval(days => (SELECT pl.dias_apartado FROM public.reserva_plazos(lista_at) pl)))
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
      -- (2026-10-26) No se anota acá: este renglón no suma a `v_aplicado`, así
      -- que su monto entra entero en el sobrante de abajo, que lo deja a favor
      -- o lo anota UNA vez. Anotado acá también, el mismo dinero salía dos
      -- veces en «por devolver».
      CONTINUE;
    END IF;
    -- Lo que este cobro cubre de la fila es lo que le FALTABA (`reserva_cuenta`:
    -- descuenta un anticipo de caja), sin su envío, que va aparte.
    SELECT * INTO k FROM public.reserva_cuenta(r.id);
    UPDATE public.app_reservas
       SET pago_estado = 'pagado', pago_metodo = 'en_linea', pagado_at = now(), updated_at = now(),
           pago_prueba = NOT p_es_real,
           vence_at = CASE WHEN estado = 'lista' THEN greatest(vence_at, lista_at + make_interval(days => (SELECT pl.dias_pagada FROM public.reserva_plazos(lista_at) pl))) ELSE vence_at END
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


-- 4 · Vigilancia de lo que se queda esperando para siempre.
CREATE OR REPLACE FUNCTION public.reservas_vigilar()
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_hoy date := (now() AT TIME ZONE 'America/El_Salvador')::date;
  v_apagados integer := 0;
  v_avisos integer := 0;
  v_reversos integer := 0;
  v_encargos integer := 0;
  v_detenidas integer := 0;
  v_ids integer[];
  v_dest uuid[];
  v_clave text;
  v_monto numeric(12,2);
  v_usado numeric(12,2);
  v_queda numeric(12,2);
  v_codigo text;
  v_salida bigint;
  v_nota text;
  r public.app_reservas;
  m record;
  s record;
  x record;
BEGIN
  -- 0 · saldo usado que ninguna factura canjeó en una hora (2026-10-21).
  -- Lo usado se volvió puntos del titular para que la caja lo descuente como
  -- un canje. Si en una hora no hubo canje (la factura salió a otro nombre o
  -- como consumidor final), esos puntos se quitan del libro con una salida
  -- de ajuste y el monto vuelve a la reserva como movimiento 'reverso'. Si se
  -- canjeó una parte, vuelve sólo lo que quedó en el lote.
  FOR m IN
    SELECT mv.id, mv.reserva_id, mv.monto, mv.branch_id, mv.employee_id, mv.created_at,
           l.id AS lote_id, l.customer_id AS titular, l.restantes, l.puntos
      FROM public.saldo_favor_movimientos mv
      JOIN public.puntos_lote l ON l.id = mv.puntos_lote_id
     WHERE mv.tipo = 'uso' AND mv.created_at < now() - interval '1 hour'
       AND l.origen = 'saldo_favor' AND l.restantes > 0
       AND NOT EXISTS (SELECT 1 FROM public.saldo_favor_movimientos z
                        WHERE z.tipo = 'reverso' AND z.puntos_lote_id = mv.puntos_lote_id)
     ORDER BY mv.id
     FOR UPDATE OF l SKIP LOCKED
  LOOP
    SELECT * INTO r FROM public.app_reservas WHERE id = m.reserva_id FOR UPDATE;
    v_monto := round(m.restantes / 100.0, 2);
    v_usado := round((m.puntos - m.restantes) / 100.0, 2);
    v_codigo := coalesce(r.pedido, 'R-' || lpad(r.id::text, 6, '0'));

    PERFORM 1 FROM public.puntos_cuenta WHERE customer_id = m.titular FOR UPDATE;
    INSERT INTO public.puntos_salida (customer_id, tipo, puntos, monto, sucursal, motivo)
    VALUES (m.titular, 'ajuste', m.restantes, v_monto,
            (SELECT b.codigo_puntos FROM public.branches b WHERE b.id = m.branch_id),
            'Saldo a favor de la reserva ' || v_codigo || ' sin canjear en una hora: vuelve a la reserva')
    RETURNING id INTO v_salida;
    INSERT INTO public.puntos_salida_lote (salida_id, lote_id, puntos) VALUES (v_salida, m.lote_id, m.restantes);
    UPDATE public.puntos_lote SET restantes = 0 WHERE id = m.lote_id;
    UPDATE public.puntos_cuenta
       SET saldo = saldo - m.restantes, usados = usados + m.restantes, updated_at = now()
     WHERE customer_id = m.titular;

    v_queda := coalesce(r.saldo_favor, 0) + v_monto;
    UPDATE public.app_reservas
       SET saldo_favor = v_queda,
           saldo_favor_usado_at = NULL, saldo_favor_usado_por = NULL, saldo_favor_usado_branch = NULL,
           updated_at = now()
     WHERE id = r.id;

    v_nota := CASE WHEN v_usado > 0
      THEN format('Se usaron %s del saldo de %s y la factura descontó sólo %s: los %s restantes volvieron a la reserva.',
                  to_char(m.monto, 'FM$999,990.00'), v_codigo, to_char(v_usado, 'FM$999,990.00'), to_char(v_monto, 'FM$999,990.00'))
      ELSE format('Se usaron %s del saldo de %s y en una hora ninguna factura a su nombre los descontó (¿salió a otro nombre o como consumidor final?): volvieron a la reserva.',
                  to_char(m.monto, 'FM$999,990.00'), v_codigo) END;

    INSERT INTO public.saldo_favor_movimientos (reserva_id, tipo, monto, saldo_despues, branch_id, puntos_lote_id, nota)
    VALUES (r.id, 'reverso', v_monto, v_queda, m.branch_id, m.lote_id,
            CASE WHEN v_usado > 0 THEN 'canje parcial: vuelve lo no descontado' ELSE 'sin canje en una hora' END);

    INSERT INTO public.audit_logs (action, target_id, details, branch_id, source)
    VALUES ('RESERVA_SALDO_FAVOR_REVERSO', r.id::text,
            jsonb_build_object('movimiento', m.id, 'lote', m.lote_id, 'usado', m.monto, 'canjeado', v_usado,
                               'devuelto', v_monto, 'queda', v_queda, 'salida', v_salida),
            m.branch_id, 'SYSTEM');

    PERFORM public.saldo_favor_anotar('saldo_reverso:' || m.id, 'saldo_favor_no_canjeado', r.customer_id,
      m.branch_id, NULL, m.employee_id, v_monto, v_nota,
      jsonb_build_object('reserva_id', r.id, 'codigo', v_codigo, 'usado', m.monto, 'canjeado', v_usado, 'movimiento', m.id));

    SELECT array_agg(DISTINCT d) INTO v_dest
      FROM unnest(coalesce(public.destinatarios_de_reservas(m.branch_id), '{}'::uuid[])
                  || coalesce(public.destinatarios_de_reservas(r.branch_id), '{}'::uuid[])) d;
    IF v_dest IS NOT NULL THEN
      PERFORM public.notify_employees(v_dest, 'RESERVA_APP',
        'El saldo a favor no se descontó',
        v_nota || ' Si la venta ya salió sin el descuento, hay que revisarla con el cliente.',
        '/puntos?tab=avisos', jsonb_build_object('check_key', 'saldo_reverso:' || m.id, 'reserva_id', r.id),
        true, m.branch_id::integer);
      UPDATE public.puntos_irregularidad SET avisado_at = now() WHERE clave = 'saldo_reverso:' || m.id;
    END IF;
    v_reversos := v_reversos + 1;
  END LOOP;

  -- 1 · saldos vencidos
  FOR s IN
    SELECT id, saldo_favor, customer_id, branch_id, pedido FROM public.app_reservas
     WHERE saldo_favor > 0 AND saldo_favor_usado_at IS NULL AND saldo_favor_devuelto_at IS NULL
       AND saldo_favor_vence < v_hoy
     FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE public.app_reservas
       SET saldo_favor_inicial = coalesce(saldo_favor_inicial, saldo_favor), saldo_favor = 0, updated_at = now()
     WHERE id = s.id;
    INSERT INTO public.saldo_favor_movimientos (reserva_id, tipo, monto, saldo_despues, nota)
    VALUES (s.id, 'vencimiento', s.saldo_favor, 0, 'venció sin usarse');
    PERFORM public.saldo_favor_anotar('saldo_vencido:' || s.id, 'saldo_favor_vencido', s.customer_id,
      s.branch_id, NULL, NULL, s.saldo_favor,
      format('El saldo a favor de %s (%s) venció sin usarse.',
             coalesce(s.pedido, 'R-' || lpad(s.id::text, 6, '0')), to_char(s.saldo_favor, 'FM$999,990.00')),
      jsonb_build_object('reserva_id', s.id));
    v_apagados := v_apagados + 1;
  END LOOP;

  -- 2 · existencia por debajo de lo apartado
  SELECT array_agg(DISTINCT producto_id::int) INTO v_ids
    FROM public.app_reservas
   WHERE estado IN ('en_revision', 'pendiente', 'lista') AND producto_id IS NOT NULL;
  IF v_ids IS NOT NULL THEN
    FOR x IN
      SELECT e.product_id, e.branch_id, e.existencia, e.apartadas,
             (SELECT r2.producto_nombre FROM public.app_reservas r2
               WHERE r2.producto_id = e.product_id AND r2.branch_id = e.branch_id
                 AND r2.estado IN ('en_revision', 'pendiente', 'lista') ORDER BY r2.id LIMIT 1) AS producto,
             (SELECT count(*) FROM public.app_reservas r2
               WHERE r2.producto_id = e.product_id AND r2.branch_id = e.branch_id
                 AND r2.estado IN ('en_revision', 'pendiente', 'lista')) AS reservas
        FROM json_to_recordset(public.app_existencias_netas(v_ids))
             AS e(product_id int, branch_id bigint, existencia numeric, apartadas numeric, disponibles numeric)
       WHERE e.apartadas > 0 AND e.existencia < e.apartadas
    LOOP
      v_clave := 'reserva_sin_existencia:' || x.branch_id || ':' || x.product_id || ':' || v_hoy;
      CONTINUE WHEN EXISTS (SELECT 1 FROM public.notifications n
                             WHERE n.metadata ? 'check_key' AND n.metadata->>'check_key' = v_clave);
      v_dest := public.destinatarios_de_reservas(x.branch_id);
      CONTINUE WHEN v_dest IS NULL;
      PERFORM public.notify_employees(v_dest, 'RESERVA_APP',
        'Falta existencia para una reserva',
        coalesce(x.producto, 'Un producto') || ': hay ' || trim(to_char(x.existencia, 'FM999,990'))
          || ' y ' || CASE WHEN x.reservas = 1 THEN 'una reserva aparta ' ELSE x.reservas || ' reservas apartan ' END
          || trim(to_char(x.apartadas, 'FM999,990')) || '. Revísalo antes de que el cliente llegue.',
        '/reservas', jsonb_build_object('check_key', v_clave, 'producto_id', x.product_id,
                                        'existencia', x.existencia, 'apartadas', x.apartadas),
        true, x.branch_id::integer);
      v_avisos := v_avisos + 1;
    END LOOP;
  END IF;

  -- 3 · encargos que llegaron y no se retiraron en su plazo (reglamento v2).
  -- No se cierran solos: la sala llama al cliente para confirmar y, si no lo
  -- va a retirar, lo pasa a saldo a favor (`encargo_pasar_a_saldo`).
  FOR x IN
    SELECT e.id, e.branch_id, e.producto_nombre, c.name AS cliente, c.phone
      FROM public.app_encargos e JOIN public.customers c ON c.id = e.customer_id
     WHERE e.estado = 'listo' AND e.aviso_sin_retirar_at IS NULL
       AND public.encargo_retirar_hasta(e) < v_hoy
  LOOP
    v_dest := public.destinatarios_de_reservas(x.branch_id);
    IF v_dest IS NOT NULL THEN
      PERFORM public.notify_employees(v_dest, 'RESERVA_APP',
        'Encargo sin retirar · E-' || lpad(x.id::text, 6, '0'),
        'Pasó el plazo y ' || coalesce(initcap(split_part(x.cliente, ' ', 1)), 'el cliente') || ' no ha retirado '
          || coalesce(x.producto_nombre, 'su encargo') || '. Llámalo' || coalesce(' al ' || x.phone, '')
          || ' para confirmar; si no lo va a retirar, pásalo a saldo a favor.',
        '/reservas', jsonb_build_object('check_key', 'encargo_sin_retirar:' || x.id, 'encargo_id', x.id),
        true, x.branch_id::integer);
    END IF;
    UPDATE public.app_encargos SET aviso_sin_retirar_at = now() WHERE id = x.id;
    v_encargos := v_encargos + 1;
  END LOOP;

  -- 4 · reservas detenidas (2026-10-26). Mientras lo que falta viene en
  -- camino el plazo de preparación se detiene (reglamento 3.5) y la reserva
  -- no vence sola; una pedida en la sala sin existencia tampoco tiene plazo.
  -- Si en 7 días no se movió, a la sala se le avisa una vez por semana: el
  -- cliente está esperando algo que puede no llegar nunca.
  FOR x IN
    SELECT ar.id, ar.branch_id, ar.producto_nombre, coalesce(ar.pedido, 'R-' || lpad(ar.id::text, 6, '0')) AS codigo,
           greatest(coalesce(ar.pendiente_at, ar.created_at), coalesce(ar.traslado_cambio_at, ar.created_at)) AS desde
      FROM public.app_reservas ar
     WHERE ar.estado = 'pendiente' AND public.reserva_plazo_hasta(ar) IS NULL
       AND greatest(coalesce(ar.pendiente_at, ar.created_at), coalesce(ar.traslado_cambio_at, ar.created_at)) < now() - interval '7 days'
  LOOP
    v_clave := 'reserva_detenida:' || x.id || ':' || to_char(v_hoy, 'IYYY-IW');
    CONTINUE WHEN EXISTS (SELECT 1 FROM public.notifications n
                           WHERE n.metadata ? 'check_key' AND n.metadata->>'check_key' = v_clave);
    v_dest := public.destinatarios_de_reservas(x.branch_id);
    CONTINUE WHEN v_dest IS NULL;
    PERFORM public.notify_employees(v_dest, 'RESERVA_APP',
      'Reserva detenida · ' || x.codigo,
      coalesce(x.producto_nombre, 'Una reserva') || ' lleva ' || (v_hoy - (x.desde AT TIME ZONE 'America/El_Salvador')::date)
        || ' días esperando lo que falta. Revisa el traslado o el pedido a Bodega, y llama al cliente: puede esperar o cancelarla.',
      '/reservas', jsonb_build_object('check_key', v_clave, 'reserva_id', x.id), true, x.branch_id::integer);
    v_detenidas := v_detenidas + 1;
  END LOOP;

  -- 5 · encargos cuya fecha estimada ya pasó sin que llegaran. La fecha no es
  -- garantizada, pero si cambia hay que avisarle al cliente (reglamento 4.4).
  FOR x IN
    SELECT e.id, e.branch_id, e.producto_nombre, e.fecha_estimada
      FROM public.app_encargos e
     WHERE e.estado IN ('aceptado', 'pedido') AND e.fecha_estimada IS NOT NULL AND e.fecha_estimada < v_hoy
  LOOP
    v_clave := 'encargo_fecha_pasada:' || x.id || ':' || x.fecha_estimada;
    CONTINUE WHEN EXISTS (SELECT 1 FROM public.notifications n
                           WHERE n.metadata ? 'check_key' AND n.metadata->>'check_key' = v_clave);
    v_dest := public.destinatarios_de_reservas(x.branch_id);
    CONTINUE WHEN v_dest IS NULL;
    PERFORM public.notify_employees(v_dest, 'ENCARGO_APP',
      'Encargo atrasado · E-' || lpad(x.id::text, 6, '0'),
      coalesce(x.producto_nombre, 'Un encargo') || ' debía llegar el ' || to_char(x.fecha_estimada, 'DD/MM')
        || ' y no ha llegado. Cambia la fecha estimada (el cliente recibe el aviso) o marca que el proveedor no entregó.',
      '/reservas', jsonb_build_object('check_key', v_clave, 'encargo_id', x.id), true, x.branch_id::integer);
  END LOOP;

  RETURN json_build_object('saldos_apagados', v_apagados, 'avisos_existencia', v_avisos, 'saldos_devueltos', v_reversos,
                           'encargos_sin_retirar', v_encargos, 'reservas_detenidas', v_detenidas);
END $function$;


-- 5 · Devolver en dinero no compite con un uso que espera su factura.
CREATE OR REPLACE FUNCTION public.reserva_saldo_devolver(p_id bigint, p_motivo text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE r public.app_reservas; v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
BEGIN
  IF NOT public.auth_has_module_permission('dash_reservas_devolver_saldo', 'can_view') THEN
    RAISE EXCEPTION 'Sólo administración puede autorizar una devolución en dinero.' USING ERRCODE = '42501';
  END IF;
  -- (2026-10-26) Si una parte del saldo se usó hace menos de una hora y la
  -- factura todavía no la descontó, `reservas_vigilar` la puede devolver a
  -- esta fila después; con la devolución ya hecha, ese monto quedaría en una
  -- reserva cerrada que nadie puede usar ni devolver.
  IF EXISTS (SELECT 1 FROM public.saldo_favor_movimientos mv
               JOIN public.puntos_lote l ON l.id = mv.puntos_lote_id
              WHERE mv.reserva_id = p_id AND mv.tipo = 'uso' AND l.restantes > 0
                AND NOT EXISTS (SELECT 1 FROM public.saldo_favor_movimientos z
                                 WHERE z.tipo = 'reverso' AND z.puntos_lote_id = mv.puntos_lote_id)) THEN
    RAISE EXCEPTION 'Una parte de este saldo se usó en una compra que todavía no se factura. Espera una hora y vuelve a intentarlo.' USING ERRCODE = 'P0001';
  END IF;
  IF v_motivo IS NULL OR length(v_motivo) < 3 THEN RAISE EXCEPTION 'Escribe el motivo de la devolución.'; END IF;
  SELECT * INTO r FROM public.app_reservas WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No existe esa reserva'; END IF;
  IF coalesce(r.saldo_favor, 0) <= 0 THEN RAISE EXCEPTION 'Esa reserva no tiene saldo a favor'; END IF;
  IF r.saldo_favor_usado_at IS NOT NULL THEN RAISE EXCEPTION 'Ese saldo a favor ya se usó en una compra'; END IF;
  IF r.saldo_favor_devuelto_at IS NOT NULL THEN RAISE EXCEPTION 'Ese saldo a favor ya se devolvió'; END IF;
  -- Se devuelve lo que queda (2026-10-21): lo ya usado se convirtió en puntos.
  UPDATE public.app_reservas
     SET saldo_favor_inicial = coalesce(saldo_favor_inicial, saldo_favor),
         saldo_favor_devuelto_at = now(), saldo_favor_devuelto_por = public.auth_employee_id(),
         saldo_favor_devuelto_monto = r.saldo_favor, saldo_favor_devuelto_motivo = left(v_motivo, 300), updated_at = now()
   WHERE id = p_id;
  INSERT INTO public.saldo_favor_movimientos (reserva_id, tipo, monto, saldo_despues, branch_id, employee_id, nota)
  VALUES (p_id, 'devolucion', r.saldo_favor, 0,
          coalesce(public.empleado_sala_de_hoy(NULL, (now() AT TIME ZONE 'America/El_Salvador')::date), public.auth_employee_branch_id()),
          public.auth_employee_id(), left(v_motivo, 300));
  IF r.devolucion_pedida_at IS NOT NULL THEN
    PERFORM public.reserva_avisar_sala(p_id, 'Devolución en efectivo autorizada',
      format('Entrega $%s al cliente desde Reservas («Entregar en efectivo»): sale como vale de caja.', to_char(r.saldo_favor, 'FM999990.00')),
      'devolucion_autorizada');
  END IF;
  RETURN json_build_object('ok', true, 'monto', r.saldo_favor, 'por_vale', r.devolucion_pedida_at IS NOT NULL);
END $function$;


-- 6 · `reserva_prioridad` y `puntos_horas_reserva` leen el nivel de cualquier
-- cliente con su id. Sólo las llaman funciones DEFINER (corren como dueño) y
-- ninguna pantalla: con sesión no hace falta ejecutarlas.
REVOKE EXECUTE ON FUNCTION public.reserva_prioridad(bigint) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.puntos_horas_reserva(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserva_prioridad(bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.puntos_horas_reserva(bigint) TO service_role;
