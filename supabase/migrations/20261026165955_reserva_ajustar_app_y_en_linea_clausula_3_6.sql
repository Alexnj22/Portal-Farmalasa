-- Reglamento de reservas, cláusula 3.6 (2026-10-26): si llega sólo una parte,
-- el cliente elige —quedarse con lo que llegó, cambiar por otro producto o
-- cancelar— y lo pagado cubre primero lo que se lleva; lo demás queda a su
-- favor. Hasta hoy `reserva_ajustar` lo negaba a las reservas de la APP y a
-- las pagadas EN LÍNEA: la sala sólo podía cancelarlas enteras, y el cliente
-- perdía también lo que sí había llegado.
--
-- Lo nuevo, sobre la definición viva:
--   · se ajusta cualquier reserva abierta, de la sala o de la app, pagada en
--     caja o en línea (un cobro de prueba cuenta como no pagado, igual que en
--     `reserva_cuenta`);
--   · el ENVÍO de un pedido a domicilio sigue con lo que se queda; si el
--     renglón se cambia entero y otro renglón del pedido sigue en pie, el envío
--     pasa a ése (lo mueve `reserva_envio`) y no se reparte acá; si no queda
--     ninguno, vuelve con el resto a favor del cliente;
--   · la alternativa no viaja en un pedido a domicilio: se aparta en la sala;
--   · al cliente de la app le llega el aviso de lo que quedó.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.reserva_ajustar(p_id bigint, p_cantidad integer, p_alternativa jsonb DEFAULT NULL::jsonb, p_motivo text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  r public.app_reservas; k record; x public.app_reservas;
  v_emp uuid := public.auth_employee_id();
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
  v_hoy date := (now() AT TIME ZONE 'America/El_Salvador')::date;
  v_t1 numeric; v_a1 numeric; v_resto numeric; v_cot json; v_t2 numeric := 0; v_a2 numeric := 0; v_sobra numeric;
  v_alt bigint; v_sobrante bigint;
  v_envio numeric; v_otra_abierta boolean; v_disp numeric; v_envio_a_favor boolean := false; v_codigo text;
BEGIN
  SELECT * INTO r FROM public.app_reservas WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Esa reserva no existe.'; END IF;
  IF NOT public.reserva_puede_manejar(r.branch_id) THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501'; END IF;
  IF r.estado NOT IN ('pendiente', 'lista') THEN RAISE EXCEPTION 'Sólo se ajusta una reserva abierta.'; END IF;
  IF EXISTS (SELECT 1 FROM public.apartado_aplicaciones a WHERE a.reserva_id = r.id) THEN
    RAISE EXCEPTION 'El anticipo de esta reserva ya se aplicó a una factura.';
  END IF;
  IF v_motivo IS NULL OR length(v_motivo) < 3 THEN RAISE EXCEPTION 'Escribe qué decidió el cliente.'; END IF;
  IF p_cantidad IS NULL OR p_cantidad < 0 OR p_cantidad > r.cantidad THEN RAISE EXCEPTION 'Del producto original se queda de 0 a %.', r.cantidad; END IF;
  IF p_cantidad = r.cantidad AND p_alternativa IS NULL THEN RAISE EXCEPTION 'Así no cambia nada.'; END IF;
  IF p_cantidad = 0 AND p_alternativa IS NULL THEN RAISE EXCEPTION 'Si no se lleva nada, cancela la reserva: lo pagado queda a su favor.'; END IF;
  IF EXISTS (SELECT 1 FROM public.app_encargos e WHERE e.reserva_id = p_id AND e.estado IN ('aceptado', 'pedido', 'listo')) THEN
    RAISE EXCEPTION 'Bodega ya pidió el resto de esta reserva: espera que llegue o habla con Bodega.';
  END IF;
  IF p_alternativa IS NOT NULL AND r.pedido IS NOT NULL AND EXISTS (
       SELECT 1 FROM public.app_reservas y WHERE y.pedido = r.pedido AND coalesce(y.costo_envio, 0) > 0) THEN
    RAISE EXCEPTION 'Este pedido va a domicilio y la alternativa no viaja con él: ajusta lo que se queda; el resto queda a su favor para que pida la alternativa.';
  END IF;

  SELECT * INTO k FROM public.reserva_cuenta(p_id);
  v_envio := public.reserva_envio(p_id);
  v_otra_abierta := r.pedido IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.app_reservas y WHERE y.pedido = r.pedido AND y.id <> p_id
       AND y.estado IN ('en_revision', 'pendiente', 'lista', 'retirada'));
  -- Lo que se queda lleva su envío; si no se queda nada, el envío pasa al
  -- renglón que sigue (no es dinero de esta fila) o, sin ninguno, vuelve.
  v_t1 := round(coalesce(r.precio_unitario, 0) * p_cantidad + CASE WHEN p_cantidad > 0 THEN v_envio ELSE 0 END, 2);
  v_disp := round(k.pagado - CASE WHEN p_cantidad = 0 AND v_otra_abierta THEN least(v_envio, k.pagado) ELSE 0 END, 2);
  v_envio_a_favor := p_cantidad = 0 AND NOT v_otra_abierta AND v_envio > 0;
  v_a1 := least(v_disp, v_t1);
  v_resto := round(v_disp - v_a1, 2);

  IF p_alternativa IS NOT NULL THEN
    IF (p_alternativa->>'producto_id')::bigint = r.producto_id THEN RAISE EXCEPTION 'La alternativa tiene que ser otro producto.'; END IF;
    v_cot := public.apartado_cotizar(r.branch_id, jsonb_build_object('modo', 'nueva', 'customer_id', r.customer_id,
      'producto_id', p_alternativa->'producto_id', 'producto_nombre', p_alternativa->>'producto_nombre',
      'factor', p_alternativa->'factor', 'cantidad', p_alternativa->'cantidad', 'precio', p_alternativa->'precio'));
    v_t2 := (v_cot->>'total')::numeric;
    v_a2 := least(v_resto, v_t2);
    INSERT INTO public.app_reservas (customer_id, branch_id, origen, producto_id, producto_nombre, cantidad, factor,
        precio_unitario, precio_normal, estado, terminos_version, anticipo, lista_at, preparada_por,
        pago_estado, pago_metodo, pagado_at, ajuste_de)
    VALUES (r.customer_id, r.branch_id, 'sucursal', (p_alternativa->>'producto_id')::bigint, left(btrim(p_alternativa->>'producto_nombre'), 200),
        (p_alternativa->>'cantidad')::integer, greatest(coalesce((p_alternativa->>'factor')::integer, 1), 1),
        round((p_alternativa->>'precio')::numeric, 2), round((p_alternativa->>'precio')::numeric, 2), 'lista', r.terminos_version, v_a2, now(), v_emp,
        CASE WHEN v_a2 > 0 AND v_a2 >= v_t2 - 0.004 THEN 'pagado' WHEN v_a2 > 0 THEN 'anticipo' ELSE 'pendiente' END,
        CASE WHEN v_a2 > 0 THEN r.pago_metodo ELSE 'al_retirar' END, CASE WHEN v_a2 > 0 THEN now() END, p_id)
    RETURNING * INTO x;
    v_alt := x.id;
    UPDATE public.app_reservas SET vence_at = now() + make_interval(hours => public.reserva_horas_al_preparar(x)) WHERE id = v_alt;
  END IF;
  v_sobra := round(v_resto - v_a2, 2);

  UPDATE public.app_encargos SET estado = 'cancelado', cerrado_at = now(), updated_at = now(),
         nota_sucursal = left(coalesce(nota_sucursal || ' · ', '') || 'El cliente decidió otra cosa.', 300)
   WHERE reserva_id = p_id AND estado IN ('solicitado', 'confirmado');

  IF p_cantidad = 0 THEN
    UPDATE public.app_reservas
       SET estado = 'cancelada', cerrada_at = now(), cerrada_por = v_emp, updated_at = now(),
           -- Lo que pasó a la alternativa ya no es de esta fila; lo que sobra sí.
           -- Sin 'pagado': el saldo lo pone esta función, no el trigger de
           -- `app_reservas_guardas` (que daría el total entero por pagado en línea).
           anticipo = v_sobra, pago_estado = CASE WHEN v_sobra > 0 THEN 'anticipo' ELSE 'pendiente' END,
           traslado_nota = left(format('El cliente cambió todo%s.', CASE WHEN v_alt IS NOT NULL THEN ' por R-' || lpad(v_alt::text, 6, '0') ELSE '' END), 300),
           saldo_favor = CASE WHEN v_sobra > 0 THEN v_sobra END,
           saldo_favor_vence = CASE WHEN v_sobra > 0 THEN v_hoy + public.saldo_favor_dias() END,
           saldo_favor_origen = CASE WHEN v_sobra > 0 THEN 'anticipo' END,
           saldo_incluye_envio = saldo_incluye_envio OR v_envio_a_favor
     WHERE id = p_id;
  ELSE
    UPDATE public.app_reservas
       SET cantidad = p_cantidad, anticipo = v_a1,
           pago_estado = CASE WHEN v_a1 > 0 AND v_a1 >= v_t1 - 0.004 THEN 'pagado' WHEN v_a1 > 0 THEN 'anticipo' ELSE 'pendiente' END,
           traslado_nota = left(format('El cliente se queda con %s de %s%s.', p_cantidad, r.cantidad,
             CASE WHEN v_alt IS NOT NULL THEN ' y lleva R-' || lpad(v_alt::text, 6, '0') ELSE '' END), 300),
           updated_at = now()
     WHERE id = p_id
    RETURNING * INTO x;
    IF x.estado = 'pendiente' AND x.traslado_llegaron >= x.cantidad THEN
      UPDATE public.app_reservas SET estado = 'lista', lista_at = now(), preparada_por = v_emp, traslado_estado = 'recibido',
             vence_at = now() + make_interval(hours => public.reserva_horas_al_preparar(x)), updated_at = now()
       WHERE id = p_id;
    END IF;
    IF v_sobra > 0 THEN
      INSERT INTO public.app_reservas (customer_id, branch_id, origen, producto_id, producto_nombre, cantidad, factor,
          precio_unitario, precio_normal, estado, terminos_version, anticipo, pago_estado, pago_metodo, pagado_at,
          cerrada_at, cerrada_por, saldo_favor, saldo_favor_vence, saldo_favor_origen, ajuste_de)
      VALUES (r.customer_id, r.branch_id, 'sucursal', r.producto_id, left('Sobrante de R-' || lpad(p_id::text, 6, '0') || ' · ' || r.producto_nombre, 200),
          1, r.factor, 0, 0, 'cancelada', r.terminos_version, v_sobra, 'anticipo', r.pago_metodo, now(),
          now(), v_emp, v_sobra, v_hoy + public.saldo_favor_dias(), 'anticipo', p_id)
      RETURNING id INTO v_sobrante;
    END IF;
  END IF;

  -- El cliente de la app se entera por la app de lo que quedó (la sala ya lo
  -- habló con él: el motivo dice qué decidió).
  IF r.origen = 'app' THEN
    v_codigo := coalesce(r.pedido, 'R-' || lpad(p_id::text, 6, '0'));
    INSERT INTO public.app_cliente_avisos (customer_id, tipo, ref, titulo, cuerpo, url)
    VALUES (r.customer_id, 'reserva', 'base:ajuste:' || p_id || ':' || coalesce(v_alt, 0) || ':' || p_cantidad, 'Tu reserva cambió',
            CASE WHEN p_cantidad > 0
                 THEN format('Te quedas con %s de %s de %s.', p_cantidad, r.cantidad, coalesce(r.producto_nombre, 'tu reserva'))
                 ELSE format('Cambiaste %s por otro producto.', coalesce(r.producto_nombre, 'tu reserva')) END
              || CASE WHEN v_alt IS NOT NULL THEN format(' Te apartamos %s × %s en la sala.', (p_alternativa->>'cantidad')::integer, left(btrim(p_alternativa->>'producto_nombre'), 120)) ELSE '' END
              || CASE WHEN v_sobra > 0 THEN format(' %s quedan a tu favor por %s días, para otra compra en cualquier sucursal.',
                                                   to_char(v_sobra, 'FM$999,990.00'), public.saldo_favor_dias()) ELSE '' END,
            '/reservas')
    ON CONFLICT (customer_id, tipo, ref) DO NOTHING;
  END IF;

  INSERT INTO public.audit_logs (user_id, action, target_id, details, branch_id, source)
  VALUES (v_emp, 'RESERVA_AJUSTADA', p_id::text,
          jsonb_build_object('antes', r.cantidad, 'queda', p_cantidad, 'alternativa', p_alternativa, 'nueva', v_alt,
                             'pagado', k.pagado, 'queda_pagado', v_a1, 'pasa_a_alternativa', v_a2, 'a_favor', v_sobra, 'motivo', v_motivo,
                             'origen', r.origen, 'pago_metodo', r.pago_metodo, 'envio', v_envio, 'envio_a_favor', v_envio_a_favor),
          r.branch_id, 'ADMIN_PANEL');
  RETURN json_build_object('ok', true, 'alternativa', CASE WHEN v_alt IS NOT NULL THEN 'R-' || lpad(v_alt::text, 6, '0') END,
                           'a_favor', v_sobra, 'cancelada', p_cantidad = 0);
END $function$;
