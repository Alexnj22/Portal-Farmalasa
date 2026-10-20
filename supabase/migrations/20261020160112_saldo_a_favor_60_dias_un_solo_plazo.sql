-- Saldo a favor: UN solo plazo, 60 días (decisión del usuario, 2026-10-20).
--
-- Había dos: 30 días para el anticipo pagado en sala de una reserva vencida
-- (decidido el 2026-10-08) y 90 para lo pagado en línea que se cerró o el cobro
-- duplicado (puesto por un agente el 2026-10-19, sin confirmar). El usuario
-- eligió 60 para todo: más tiempo que 30 para volver, y no queda abierto tanto
-- como 90.
--
-- El plazo vive en UNA función (saldo_favor_dias), no repetido en tres: así
-- vuelve a cambiar en un solo lugar. Las tres funciones se reescriben desde su
-- definición VIVA (pg_get_functiondef), cambiando sólo el número.
-- El saldo que ya existe conserva su fecha: no se le acorta el plazo a nadie.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.saldo_favor_dias()
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE
 SET search_path = public, extensions
AS $$ SELECT 60 $$;
REVOKE EXECUTE ON FUNCTION public.saldo_favor_dias() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.saldo_favor_dias() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.app_reservas_guardas()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_cerradas constant text[] := ARRAY['cancelada', 'vencida'];
  v_hoy date := (now() AT TIME ZONE 'America/El_Salvador')::date;
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- La regla del libro, decidida acá: lo que mande la app no cuenta.
    NEW.bajo_receta := public.clase_de_dispensacion(NEW.producto_id::int) IS NOT NULL;
    IF NEW.origen = 'app' AND NEW.bajo_receta AND NEW.estado = 'pendiente' THEN
      NEW.estado := 'en_revision';
    END IF;
  END IF;

  -- Desde cuándo espera que la preparen (48 h, `reservas_vencer`).
  IF NEW.estado = 'pendiente' AND (TG_OP = 'INSERT' OR OLD.estado IS DISTINCT FROM 'pendiente') THEN
    NEW.pendiente_at := now();
  END IF;

  -- Sin la receta aprobada no se prepara, no se marca lista ni se entrega.
  -- (El pago no se frena acá: un cobro que llega nunca se puede perder.)
  IF NEW.origen = 'app' AND NEW.bajo_receta AND NEW.estado IN ('pendiente', 'lista', 'retirada')
     AND NEW.receta_estado IS DISTINCT FROM 'aprobada'
     AND (TG_OP = 'INSERT' OR OLD.estado IS DISTINCT FROM NEW.estado) THEN
    RAISE EXCEPTION 'La receta de esta reserva todavía no está aprobada.' USING ERRCODE = 'P0001';
  END IF;

  -- Lo pagado en línea que se cierra (la sala la cancela, vence, o el pago
  -- llega cuando ya estaba cerrada) queda A FAVOR del cliente (punto 6). El
  -- envío, si el pedido entero se cerró, lo suma `app_reservas_saldo_envio`.
  -- Un cobro de PRUEBA no es dinero: no deja saldo.
  IF TG_OP = 'UPDATE' AND NEW.estado = ANY (v_cerradas) AND NEW.pago_estado = 'pagado'
     AND NEW.pago_metodo = 'en_linea' AND NOT NEW.pago_prueba AND NEW.saldo_favor IS NULL
     AND (NOT (OLD.estado = ANY (v_cerradas)) OR OLD.pago_estado IS DISTINCT FROM 'pagado') THEN
    NEW.saldo_favor := round(coalesce(NEW.precio_unitario, 0) * NEW.cantidad, 2);
    NEW.saldo_favor_vence := v_hoy + public.saldo_favor_dias();
    NEW.saldo_favor_origen := CASE WHEN OLD.estado = ANY (v_cerradas) THEN 'pago_tardio' ELSE 'pago_en_linea' END;
    IF NEW.saldo_favor <= 0 THEN
      NEW.saldo_favor := NULL; NEW.saldo_favor_vence := NULL; NEW.saldo_favor_origen := NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

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
BEGIN
  SELECT * INTO p FROM public.app_reservas_pagos WHERE identificador = p_identificador FOR UPDATE;
  IF NOT FOUND THEN RETURN json_build_object('ok', false, 'motivo', 'sin_pago'); END IF;
  IF p.estado = 'aprobado' THEN
    RETURN json_build_object('ok', true, 'ya', true, 'reserva_id', p.reserva_id, 'pedido', p.pedido, 'encargo_id', p.encargo_id);
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
    UPDATE public.app_reservas
       SET pago_estado = 'pagado', pago_metodo = 'en_linea', pagado_at = now(), updated_at = now(),
           pago_prueba = NOT p_es_real,
           vence_at = CASE WHEN estado = 'lista' THEN lista_at + interval '7 days' ELSE vence_at END
     WHERE id = r.id;
    IF r.estado IN ('vencida', 'cancelada') THEN
      v_saldo := v_saldo + round(coalesce(r.precio_unitario, 0) * r.cantidad, 2);
    ELSE
      v_aplicado := v_aplicado + round(coalesce(r.precio_unitario, 0) * r.cantidad, 2);
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

CREATE OR REPLACE FUNCTION public.reservas_vencer()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_hoy date := (now() AT TIME ZONE 'America/El_Salvador')::date;
  v_ids bigint[];
BEGIN
  WITH v AS (
    UPDATE public.app_reservas
       SET estado = 'vencida', cerrada_at = now(), updated_at = now(),
           vencida_motivo = CASE
             WHEN estado = 'en_revision' AND receta_estado = 'pendiente' THEN 'receta_sin_revisar'
             WHEN estado = 'en_revision' THEN 'sin_receta'
             WHEN estado = 'lista' THEN 'sin_retirar'
             WHEN origen = 'app' AND coalesce(pendiente_at, created_at) < now() - interval '48 hours' THEN 'sin_preparar'
             ELSE 'oferta_terminada' END,
           saldo_favor = CASE WHEN anticipo > 0 AND pago_metodo <> 'en_linea' AND saldo_favor IS NULL THEN anticipo ELSE saldo_favor END,
           saldo_favor_vence = CASE WHEN anticipo > 0 AND pago_metodo <> 'en_linea' AND saldo_favor IS NULL THEN v_hoy + public.saldo_favor_dias() ELSE saldo_favor_vence END,
           saldo_favor_origen = CASE WHEN anticipo > 0 AND pago_metodo <> 'en_linea' AND saldo_favor IS NULL THEN 'anticipo' ELSE saldo_favor_origen END
     WHERE (estado = 'en_revision' AND coalesce(receta_estado, 'otra_foto') = 'otra_foto'
            AND greatest(created_at, coalesce(receta_revisada_at, created_at)) < now() - interval '24 hours')
        OR (estado = 'en_revision' AND receta_estado = 'pendiente' AND receta_subida_at < now() - interval '48 hours')
        OR (estado = 'pendiente' AND origen = 'app' AND coalesce(pendiente_at, created_at) < now() - interval '48 hours')
        OR (estado = 'pendiente' AND pago_estado <> 'pagado' AND oferta_fin IS NOT NULL AND oferta_fin < v_hoy)
        OR (estado = 'lista' AND vence_at < now())
    RETURNING id)
  SELECT array_agg(id) INTO v_ids FROM v;
  IF v_ids IS NULL THEN RETURN 0; END IF;

  -- Un aviso por pedido (o reserva suelta) de la app.
  INSERT INTO public.app_cliente_avisos (customer_id, tipo, ref, titulo, cuerpo, url)
  SELECT g.customer_id, 'reserva', 'base:vencida:' || g.grupo,
         CASE g.motivo WHEN 'sin_receta' THEN 'Tu reserva venció sin la foto de la receta'
                       WHEN 'receta_sin_revisar' THEN 'Tu reserva venció'
                       WHEN 'sin_preparar' THEN 'Tu reserva venció'
                       WHEN 'oferta_terminada' THEN 'Tu reserva venció'
                       ELSE 'Tu reserva venció sin retirar' END,
         CASE g.motivo WHEN 'sin_receta' THEN 'No recibimos la foto de tu receta a tiempo. Puedes volver a reservar cuando quieras.'
                       WHEN 'receta_sin_revisar' THEN 'La sucursal no alcanzó a revisar tu receta a tiempo. Disculpa: puedes volver a reservar y no cuenta en tu contra.'
                       WHEN 'sin_preparar' THEN 'La sucursal no alcanzó a preparar tu pedido a tiempo. Disculpa: puedes volver a reservar y no cuenta en tu contra.'
                       WHEN 'oferta_terminada' THEN 'La oferta terminó antes de que se preparara.'
                       ELSE 'Se cumplió el plazo para retirarla.' END
           || CASE WHEN g.saldo > 0 THEN ' Te quedaron $' || to_char(g.saldo, 'FM999990.00') || ' a favor para otra compra en cualquier sucursal.' ELSE '' END,
         '/reservas'
    FROM (SELECT customer_id, coalesce(pedido, id::text) AS grupo, min(vencida_motivo) AS motivo,
                 coalesce(sum(saldo_favor), 0) AS saldo
            FROM public.app_reservas
           WHERE id = ANY (v_ids) AND origen = 'app'
           GROUP BY 1, 2) g
  ON CONFLICT (customer_id, tipo, ref) DO NOTHING;

  RETURN array_length(v_ids, 1);
END;
$function$;
