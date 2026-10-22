-- Reglamento de reservas v4 (2026-10-22): la sala responde en 24 h (preparar y
-- revisar la receta); si no alcanza, avisa a supervisión y jefatura; el cliente
-- cancela y pide la prórroga desde la app; y el anticipo pagado EN LÍNEA a medias
-- queda a favor al cancelar o vencer (antes se perdía: la condición excluía
-- todo pago_metodo 'en_linea' y el trigger sólo cubre el pagado completo).
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.reserva_plazos(OUT dias_pagada integer, OUT dias_apartado integer, OUT horas_sin_foto integer, OUT horas_receta_sin_revisar integer, OUT horas_para_preparar integer, OUT dias_saldo_favor integer, OUT dias_sin_pagar integer, OUT dias_prorroga integer, OUT dias_encargo integer)
 RETURNS record
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  -- Pagada en línea o apartada en caja: 7 días para retirarla. App sin la
  -- foto de la receta (u «otra foto»): 24 h. Foto sin revisar: 24 h. Sin
  -- preparar: 24 h. Saldo a favor: `saldo_favor_dias()`. App sin pagar: 3
  -- días. Prórroga (una sola): 7 días. Encargo que llegó: 7 días.
  SELECT 7, 7, 24, 24, 24, public.saldo_favor_dias(), 3, 7, 7;
$function$
;

CREATE OR REPLACE FUNCTION public.reservas_vencer()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_hoy date := (now() AT TIME ZONE 'America/El_Salvador')::date;
  v_ids bigint[];
  t record;
  v_dest uuid[];
BEGIN
  WITH v AS (
    UPDATE public.app_reservas r
       SET estado = 'vencida', cerrada_at = now(), updated_at = now(),
           vencida_motivo = CASE
             WHEN r.estado = 'en_revision' AND r.receta_estado = 'pendiente' THEN 'receta_sin_revisar'
             WHEN r.estado = 'en_revision' THEN 'sin_receta'
             WHEN r.estado = 'lista' THEN 'sin_retirar'
             WHEN r.origen = 'app' AND public.reserva_plazo_hasta(r) < now() THEN 'sin_preparar'
             ELSE 'oferta_terminada' END,
           saldo_favor = CASE WHEN r.anticipo > 0 AND NOT (r.pago_metodo = 'en_linea' AND r.pago_estado = 'pagado') AND r.saldo_favor IS NULL AND NOT coalesce(r.pago_prueba, false) THEN r.anticipo ELSE r.saldo_favor END,
           saldo_favor_vence = CASE WHEN r.anticipo > 0 AND NOT (r.pago_metodo = 'en_linea' AND r.pago_estado = 'pagado') AND r.saldo_favor IS NULL AND NOT coalesce(r.pago_prueba, false) THEN v_hoy + public.saldo_favor_dias() ELSE r.saldo_favor_vence END,
           saldo_favor_origen = CASE WHEN r.anticipo > 0 AND NOT (r.pago_metodo = 'en_linea' AND r.pago_estado = 'pagado') AND r.saldo_favor IS NULL AND NOT coalesce(r.pago_prueba, false) THEN 'anticipo' ELSE r.saldo_favor_origen END
     WHERE ((r.estado = 'en_revision' AND public.reserva_plazo_hasta(r) < now())
            OR (r.estado = 'pendiente' AND r.origen = 'app' AND public.reserva_plazo_hasta(r) < now())
            OR (r.estado = 'pendiente' AND r.pago_estado <> 'pagado' AND r.oferta_fin IS NOT NULL AND r.oferta_fin < v_hoy)
            -- Vence cuando TERMINA el día de `vence_at` en El Salvador, no a su hora.
            OR (r.estado = 'lista' AND (r.vence_at AT TIME ZONE 'America/El_Salvador')::date < v_hoy))
       AND NOT EXISTS (SELECT 1 FROM public.apartado_aplicaciones a WHERE a.reserva_id = r.id)
    RETURNING r.id)
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

  -- La sala no alcanzó a preparar o a revisar la receta (reglamento v4,
  -- 3.8): se les avisa a supervisión de ventas y a la jefatura de esa sala.
  FOR t IN
    SELECT r.branch_id, r.vencida_motivo, coalesce(r.pedido, 'R-' || lpad(r.id::text, 6, '0')) AS codigo,
           string_agg(DISTINCT r.producto_nombre, ', ') AS productos, min(r.id) AS id
      FROM public.app_reservas r
     WHERE r.id = ANY (v_ids) AND r.vencida_motivo IN ('sin_preparar', 'receta_sin_revisar')
     GROUP BY 1, 2, 3
  LOOP
    SELECT array_agg(DISTINCT e.id) INTO v_dest
      FROM public.employees e
     WHERE e.status = 'ACTIVO'
       AND (13 IN (e.role_id, e.secondary_role_id)
            OR (19 IN (e.role_id, e.secondary_role_id) AND e.branch_id = t.branch_id));
    IF v_dest IS NOT NULL THEN
      PERFORM public.notify_employees(v_dest, 'RESERVA_APP',
        CASE t.vencida_motivo WHEN 'sin_preparar' THEN 'Reserva vencida sin preparar' ELSE 'Receta vencida sin revisar' END,
        format('%s (%s, %s) venció porque la sala no %s a tiempo. Al cliente no le cuenta en contra.',
               t.codigo, t.productos, (SELECT b.name FROM public.branches b WHERE b.id = t.branch_id),
               CASE t.vencida_motivo WHEN 'sin_preparar' THEN 'la preparó' ELSE 'revisó la receta' END),
        '/reservas', jsonb_build_object('check_key', 'reserva_sala_tarde:' || t.id, 'reserva_id', t.id),
        true, t.branch_id::integer);
    END IF;
  END LOOP;

  RETURN array_length(v_ids, 1);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.reserva_cambiar_estado(p_id bigint, p_estado text, p_motivo text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  r public.app_reservas;
  v_emp uuid := public.auth_employee_id();
  v_horas integer;
  v_saldo numeric;
  v_hoy date := (now() AT TIME ZONE 'America/El_Salvador')::date;
BEGIN
  SELECT * INTO r FROM public.app_reservas WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NO_EXISTE'; END IF;
  IF NOT public.reserva_puede_manejar(r.branch_id) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF p_estado IN ('lista', 'retirada') AND r.origen = 'app' AND r.bajo_receta AND r.receta_estado IS DISTINCT FROM 'aprobada' THEN
    RAISE EXCEPTION 'La receta de esta reserva todavía no está aprobada.' USING ERRCODE = 'P0001';
  END IF;
  IF p_estado = 'lista' AND r.estado = 'pendiente' THEN
    -- El plazo: la única regla (`reserva_horas_al_preparar` → `puntos_horas_reserva`).
    v_horas := public.reserva_horas_al_preparar(r);
    UPDATE public.app_reservas SET estado = 'lista', lista_at = now(), vence_at = now() + make_interval(hours => v_horas),
           preparada_por = v_emp, updated_at = now() WHERE id = p_id;
  ELSIF p_estado = 'retirada' AND r.estado = 'lista' THEN
    -- Con anticipo, el retiro lo hace `apartado_entregar` / «Retirar» (2026-10-20).
    IF NOT coalesce(r.pago_prueba, false)
       AND greatest(coalesce(r.anticipo, 0), CASE WHEN r.pago_estado = 'pagado' THEN 1 ELSE 0 END) > 0
       AND NOT EXISTS (SELECT 1 FROM public.apartado_aplicaciones a WHERE a.reserva_id = r.id) THEN
      RAISE EXCEPTION 'Esta reserva tiene un pago: usa «Retirar» para aplicarlo a la factura.' USING ERRCODE = 'P0001';
    END IF;
    UPDATE public.app_reservas SET estado = 'retirada', cerrada_at = now(), cerrada_por = v_emp, updated_at = now(),
           pago_estado = CASE WHEN pago_estado IN ('pendiente', 'anticipo') THEN 'pagado' ELSE pago_estado END,
           pagado_at = coalesce(pagado_at, now())
     WHERE id = p_id;
  ELSIF p_estado = 'cancelada' AND r.estado IN ('en_revision', 'pendiente', 'lista') THEN
    -- Un anticipo ya aplicado a una factura es dinero de esa venta: no se
    -- cancela ni vuelve como saldo a favor.
    IF EXISTS (SELECT 1 FROM public.apartado_aplicaciones a WHERE a.reserva_id = r.id) THEN
      RAISE EXCEPTION 'El anticipo de esta reserva ya se aplicó a una factura: no se puede cancelar.' USING ERRCODE = 'P0001';
    END IF;
    UPDATE public.app_reservas SET estado = 'cancelada', cerrada_at = now(), cerrada_por = v_emp, updated_at = now(),
           -- El anticipo de caja queda a favor, igual que al vencer. Uno de
           -- PRUEBA no es dinero: no deja saldo.
           saldo_favor = CASE WHEN anticipo > 0 AND NOT (pago_metodo = 'en_linea' AND pago_estado = 'pagado') AND saldo_favor IS NULL AND NOT coalesce(pago_prueba, false) THEN anticipo ELSE saldo_favor END,
           saldo_favor_vence = CASE WHEN anticipo > 0 AND NOT (pago_metodo = 'en_linea' AND pago_estado = 'pagado') AND saldo_favor IS NULL AND NOT coalesce(pago_prueba, false)
                                    THEN v_hoy + public.saldo_favor_dias() ELSE saldo_favor_vence END,
           saldo_favor_origen = CASE WHEN anticipo > 0 AND NOT (pago_metodo = 'en_linea' AND pago_estado = 'pagado') AND saldo_favor IS NULL AND NOT coalesce(pago_prueba, false) THEN 'anticipo' ELSE saldo_favor_origen END
     WHERE id = p_id
    RETURNING saldo_favor INTO v_saldo;
    IF r.origen = 'app' THEN
      INSERT INTO public.app_cliente_avisos (customer_id, tipo, ref, titulo, cuerpo, url)
      VALUES (r.customer_id, 'reserva', 'base:cancelada:' || r.id,
              'La sucursal canceló tu reserva',
              r.producto_nombre || coalesce(' · ' || nullif(btrim(p_motivo), ''), '')
                || CASE WHEN coalesce(v_saldo, 0) > 0 THEN '. Lo que pagaste quedó a tu favor para otra compra en cualquier sucursal.' ELSE '.' END,
              '/reservas')
      ON CONFLICT (customer_id, tipo, ref) DO NOTHING;
    END IF;
  ELSE
    RAISE EXCEPTION 'TRANSICION_INVALIDA: % → %', r.estado, p_estado;
  END IF;
  INSERT INTO public.audit_logs (user_id, action, target_id, details, branch_id, source)
  VALUES (public.auth_employee_id(), 'RESERVA_' || upper(p_estado), p_id::text,
          jsonb_build_object('antes', r.estado, 'motivo', p_motivo, 'saldo_favor', v_saldo), r.branch_id, 'ADMIN_PANEL');
  RETURN json_build_object('ok', true, 'id', p_id, 'estado', p_estado, 'saldo_favor', v_saldo);
END;
$function$
;

-- El cliente cancela desde la app lo que ve en ella (reglamento v4, 3.10):
-- lo que pagó —anticipo de caja o en línea, total o parcial— queda a favor,
-- igual que cuando la cancela la sala. Sólo lo llama `app-clientes`, que
-- pasa el cliente de la SESIÓN.
CREATE OR REPLACE FUNCTION public.reserva_cancelar_por_cliente(p_id bigint, p_customer bigint)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  r public.app_reservas;
  v_saldo numeric;
  v_hoy date := (now() AT TIME ZONE 'America/El_Salvador')::date;
  v_codigo text;
  v_dest uuid[];
BEGIN
  SELECT * INTO r FROM public.app_reservas WHERE id = p_id AND customer_id = p_customer FOR UPDATE;
  IF NOT FOUND OR r.estado NOT IN ('en_revision', 'pendiente', 'lista') THEN
    RETURN json_build_object('ok', false, 'mensaje', 'Esa reserva ya no está abierta.');
  END IF;
  IF EXISTS (SELECT 1 FROM public.apartado_aplicaciones a WHERE a.reserva_id = r.id) THEN
    RETURN json_build_object('ok', false, 'mensaje', 'Esa reserva ya se está facturando en la sucursal.');
  END IF;
  UPDATE public.app_reservas SET estado = 'cancelada', cerrada_at = now(), updated_at = now(),
         saldo_favor = CASE WHEN anticipo > 0 AND NOT (pago_metodo = 'en_linea' AND pago_estado = 'pagado') AND saldo_favor IS NULL AND NOT coalesce(pago_prueba, false) THEN anticipo ELSE saldo_favor END,
         saldo_favor_vence = CASE WHEN anticipo > 0 AND NOT (pago_metodo = 'en_linea' AND pago_estado = 'pagado') AND saldo_favor IS NULL AND NOT coalesce(pago_prueba, false)
                                  THEN v_hoy + public.saldo_favor_dias() ELSE saldo_favor_vence END,
         saldo_favor_origen = CASE WHEN anticipo > 0 AND NOT (pago_metodo = 'en_linea' AND pago_estado = 'pagado') AND saldo_favor IS NULL AND NOT coalesce(pago_prueba, false) THEN 'anticipo' ELSE saldo_favor_origen END
   WHERE id = p_id
  RETURNING saldo_favor INTO v_saldo;
  v_codigo := coalesce(r.pedido, 'R-' || lpad(p_id::text, 6, '0'));
  INSERT INTO public.audit_logs (action, target_id, details, branch_id, source)
  VALUES ('RESERVA_CANCELADA_POR_CLIENTE', p_id::text,
          jsonb_build_object('antes', r.estado, 'customer_id', p_customer, 'saldo_favor', v_saldo, 'desde', 'app'), r.branch_id, 'SYSTEM');
  -- La sala la tenía separada: que sepa que puede devolverla al estante.
  IF r.estado = 'lista' OR r.origen = 'sucursal' OR coalesce(v_saldo, 0) > 0 THEN
    v_dest := public.destinatarios_de_reservas(r.branch_id);
    IF v_dest IS NOT NULL THEN
      PERFORM public.notify_employees(v_dest, 'RESERVA_APP', 'El cliente canceló ' || v_codigo,
        coalesce(r.producto_nombre, 'La reserva') || ' se canceló desde la app.'
          || CASE WHEN r.estado = 'lista' THEN ' Si estaba separada, vuelve a la venta.' ELSE '' END
          || CASE WHEN coalesce(v_saldo, 0) > 0 THEN ' Lo pagado (' || to_char(v_saldo, 'FM$999,990.00') || ') quedó a su favor.' ELSE '' END,
        '/reservas', jsonb_build_object('check_key', 'reserva_cancelada_cliente:' || p_id, 'reserva_id', p_id),
        true, r.branch_id::integer);
    END IF;
  END IF;
  RETURN json_build_object('ok', true, 'saldo_favor', v_saldo);
END $function$;
REVOKE EXECUTE ON FUNCTION public.reserva_cancelar_por_cliente(bigint, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserva_cancelar_por_cliente(bigint, bigint) TO service_role;

-- La prórroga única también se pide desde la app (reglamento v4, 7.2). Misma
-- regla que `reserva_prorrogar`: lista, una sola vez, 7 días.
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
  IF r.prorrogada_at IS NOT NULL THEN
    RETURN json_build_object('ok', false, 'mensaje', 'Esta reserva ya tuvo su prórroga: no admite otra.');
  END IF;
  UPDATE public.app_reservas
     SET vence_at = vence_at + make_interval(days => (SELECT p.dias_prorroga FROM public.reserva_plazos() p)),
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
REVOKE EXECUTE ON FUNCTION public.reserva_prorrogar_por_cliente(bigint, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserva_prorrogar_por_cliente(bigint, bigint) TO service_role;

CREATE OR REPLACE FUNCTION public.encargo_prorrogar_por_cliente(p_id bigint, p_customer bigint)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE e public.app_encargos; v_dest uuid[];
BEGIN
  SELECT * INTO e FROM public.app_encargos WHERE id = p_id AND customer_id = p_customer FOR UPDATE;
  IF NOT FOUND OR e.estado <> 'listo' THEN
    RETURN json_build_object('ok', false, 'mensaje', 'Sólo se puede pedir más plazo cuando el encargo ya llegó.');
  END IF;
  IF e.prorrogado_at IS NOT NULL THEN
    RETURN json_build_object('ok', false, 'mensaje', 'Este encargo ya tuvo su prórroga: no admite otra.');
  END IF;
  UPDATE public.app_encargos SET prorrogado_at = now(), aviso_sin_retirar_at = NULL, updated_at = now()
   WHERE id = p_id RETURNING * INTO e;
  INSERT INTO public.audit_logs (action, target_id, details, branch_id, source)
  VALUES ('ENCARGO_PRORROGADO', p_id::text, jsonb_build_object('hasta', public.encargo_retirar_hasta(e), 'desde', 'app', 'customer_id', p_customer), e.branch_id, 'SYSTEM');
  v_dest := public.destinatarios_de_reservas(e.branch_id);
  IF v_dest IS NOT NULL THEN
    PERFORM public.notify_employees(v_dest, 'RESERVA_APP', 'Prórroga de un encargo',
      coalesce(e.producto_nombre, 'Un encargo') || ': el cliente pidió más plazo desde la app. Retira hasta el '
        || to_char(public.encargo_retirar_hasta(e), 'DD/MM/YYYY') || '.',
      '/reservas', jsonb_build_object('check_key', 'encargo_prorroga_cliente:' || p_id, 'encargo_id', p_id),
      false, e.branch_id::integer);
  END IF;
  RETURN json_build_object('ok', true, 'retirar_hasta', public.encargo_retirar_hasta(e));
END $function$;
REVOKE EXECUTE ON FUNCTION public.encargo_prorrogar_por_cliente(bigint, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.encargo_prorrogar_por_cliente(bigint, bigint) TO service_role;
