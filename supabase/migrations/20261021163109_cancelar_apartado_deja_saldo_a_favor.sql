-- Cancelar una reserva con ANTICIPO de caja deja ese anticipo a favor del
-- cliente (2026-10-21, auditoría del flujo de reservas). Antes sólo lo hacía
-- el vencimiento (`reservas_vencer`); la X de la sala lo perdía: el efectivo
-- quedaba en el cajón y el cliente sin nada. Misma regla y mismo plazo que
-- `reservas_vencer` (saldo_favor_dias()). Lo pagado en línea sigue saliendo
-- del trigger `app_reservas_guardas`. Resto: definición viva
-- (md5 5e6af1a5216e94ce79545d0a00293b12).
SET lock_timeout = '5s';

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
    v_horas := CASE WHEN r.pago_estado = 'pagado' THEN 7 * 24
                    ELSE coalesce((public.puntos_nivel_de(public.puntos_compra_12m(r.customer_id,
                           (now() AT TIME ZONE 'America/El_Salvador')::date))).horas_reserva, 24) END;
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
  ELSIF p_estado = 'cancelada' AND r.estado IN ('pendiente', 'lista') THEN
    UPDATE public.app_reservas SET estado = 'cancelada', cerrada_at = now(), cerrada_por = v_emp, updated_at = now(),
           -- El anticipo de caja queda a favor, igual que al vencer.
           saldo_favor = CASE WHEN anticipo > 0 AND pago_metodo <> 'en_linea' AND saldo_favor IS NULL THEN anticipo ELSE saldo_favor END,
           saldo_favor_vence = CASE WHEN anticipo > 0 AND pago_metodo <> 'en_linea' AND saldo_favor IS NULL
                                    THEN (now() AT TIME ZONE 'America/El_Salvador')::date + public.saldo_favor_dias() ELSE saldo_favor_vence END,
           saldo_favor_origen = CASE WHEN anticipo > 0 AND pago_metodo <> 'en_linea' AND saldo_favor IS NULL THEN 'anticipo' ELSE saldo_favor_origen END
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
$function$;
