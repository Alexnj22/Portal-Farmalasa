SET lock_timeout = '5s';

-- Pago en línea de las reservas de la app, con Wompi (2026-10-07).
--
-- Decisiones del usuario:
--   · el cliente puede pagar apenas reserva o cuando la sucursal la apartó;
--   · una reserva PAGADA no vence a las 24 h: tiene 7 días desde que se
--     apartó. Cumplidos, el producto se libera pero la reserva NO se pierde —
--     vuelve a «pendiente», sigue pagada, y la sucursal la aparta de nuevo
--     cuando el cliente venga;
--   · formas de pago: tarjeta y QuickPay.
--
-- Cada intento de pago es un ENLACE de Wompi y una fila acá. El pago se da por
-- bueno SÓLO desde el servidor (`app_reserva_pago_confirmar`, service_role),
-- después de consultar la transacción en Wompi: ni el aviso ni la vuelta del
-- navegador alcanzan solos.

CREATE TABLE public.app_reservas_pagos (
    id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    reserva_id         bigint NOT NULL REFERENCES public.app_reservas(id) ON DELETE CASCADE,
    identificador      text NOT NULL UNIQUE,           -- identificadorEnlaceComercio
    monto              numeric(10,2) NOT NULL CHECK (monto > 0),
    enlace_id          bigint,                          -- idEnlace de Wompi
    enlace_url         text,
    estado             text NOT NULL DEFAULT 'creado' CHECK (estado IN ('creado', 'aprobado')),
    id_transaccion     text UNIQUE,
    es_real            boolean,
    codigo_autorizacion text,
    forma_pago         text,
    detalle            jsonb,
    pagado_at          timestamptz,
    created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX app_reservas_pagos_reserva_idx ON public.app_reservas_pagos (reserva_id);

ALTER TABLE public.app_reservas_pagos ENABLE ROW LEVEL SECURITY;
CREATE POLICY app_reservas_pagos_select ON public.app_reservas_pagos
    FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM public.app_reservas r WHERE r.id = reserva_id
                   AND (r.branch_id = (SELECT public.auth_employee_branch_id())
                        OR (SELECT public.auth_has_module_permission('ofertas_clientes', 'can_view')))));
REVOKE ALL ON public.app_reservas_pagos FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.app_reservas_pagos TO authenticated;
GRANT ALL ON public.app_reservas_pagos TO service_role;

-- Confirmar un pago YA verificado contra Wompi. Idempotente: el aviso de
-- Wompi se reintenta y la vuelta del navegador llega también; la segunda vez
-- no hace nada. Si el pago llega sobre una reserva cerrada (venció o se
-- canceló mientras el cliente pagaba), la reabre como «pendiente»: cerrada no
-- aparece en la lista de la sucursal, y un pago que nadie ve es dinero perdido.
CREATE OR REPLACE FUNCTION public.app_reserva_pago_confirmar(
    p_identificador text, p_id_transaccion text, p_monto numeric,
    p_es_real boolean, p_codigo text, p_forma text, p_detalle jsonb)
 RETURNS json
 LANGUAGE plpgsql SECURITY DEFINER
 SET search_path = public, extensions
AS $$
DECLARE
  p public.app_reservas_pagos;
  r public.app_reservas;
BEGIN
  SELECT * INTO p FROM public.app_reservas_pagos WHERE identificador = p_identificador FOR UPDATE;
  IF NOT FOUND THEN RETURN json_build_object('ok', false, 'motivo', 'sin_pago'); END IF;
  IF p.estado = 'aprobado' THEN
    RETURN json_build_object('ok', true, 'ya', true, 'reserva_id', p.reserva_id);
  END IF;
  -- Una transacción paga UNA reserva: el mismo id pegado a otro enlace es
  -- alguien reusando su comprobante.
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

  SELECT * INTO r FROM public.app_reservas WHERE id = p.reserva_id FOR UPDATE;
  UPDATE public.app_reservas
     SET pago_estado = 'pagado', pago_metodo = 'en_linea', pagado_at = now(), updated_at = now(),
         -- Apartada: el plazo pasa a 7 días desde que se apartó.
         vence_at = CASE WHEN estado = 'lista' THEN lista_at + interval '7 days' ELSE vence_at END,
         -- Cerrada mientras pagaba: vuelve a la lista de la sucursal.
         estado = CASE WHEN estado IN ('vencida', 'cancelada') THEN 'pendiente' ELSE estado END,
         cerrada_at = CASE WHEN estado IN ('vencida', 'cancelada') THEN NULL ELSE cerrada_at END
   WHERE id = r.id;

  INSERT INTO public.audit_logs (action, target_id, details, branch_id, source)
  VALUES ('RESERVA_PAGADA_EN_LINEA', r.id::text,
          jsonb_build_object('monto', p.monto, 'transaccion', p_id_transaccion, 'es_real', p_es_real,
                             'estado_antes', r.estado, 'forma', p_forma),
          r.branch_id, 'SYSTEM');
  RETURN json_build_object('ok', true, 'reserva_id', r.id, 'reabierta', r.estado IN ('vencida', 'cancelada'));
END;
$$;
REVOKE EXECUTE ON FUNCTION public.app_reserva_pago_confirmar(text, text, numeric, boolean, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_reserva_pago_confirmar(text, text, numeric, boolean, text, text, jsonb) TO service_role;

-- Apartar una reserva ya pagada: 7 días en vez de las horas del nivel.
-- Partiendo de la definición viva (2026-10-07); sólo cambia la rama 'lista'.
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
BEGIN
  SELECT * INTO r FROM public.app_reservas WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NO_EXISTE'; END IF;
  IF NOT public.reserva_puede_manejar(r.branch_id) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF p_estado = 'lista' AND r.estado = 'pendiente' THEN
    v_horas := CASE WHEN r.pago_estado = 'pagado' THEN 7 * 24
                    ELSE coalesce((public.puntos_nivel_de(public.puntos_compra_12m(r.customer_id,
                           (now() AT TIME ZONE 'America/El_Salvador')::date))).horas_reserva, 24) END;
    UPDATE public.app_reservas SET estado = 'lista', lista_at = now(), vence_at = now() + make_interval(hours => v_horas),
           preparada_por = v_emp, updated_at = now() WHERE id = p_id;
  ELSIF p_estado = 'retirada' AND r.estado = 'lista' THEN
    UPDATE public.app_reservas SET estado = 'retirada', cerrada_at = now(), cerrada_por = v_emp, updated_at = now(),
           pago_estado = CASE WHEN pago_estado IN ('pendiente', 'anticipo') THEN 'pagado' ELSE pago_estado END,
           pagado_at = coalesce(pagado_at, now())
     WHERE id = p_id;
  ELSIF p_estado = 'cancelada' AND r.estado IN ('pendiente', 'lista') THEN
    UPDATE public.app_reservas SET estado = 'cancelada', cerrada_at = now(), cerrada_por = v_emp, updated_at = now() WHERE id = p_id;
  ELSE
    RAISE EXCEPTION 'TRANSICION_INVALIDA: % → %', r.estado, p_estado;
  END IF;
  INSERT INTO public.audit_logs (user_id, action, target_id, details, branch_id, source)
  VALUES (public.auth_employee_id(), 'RESERVA_' || upper(p_estado), p_id::text,
          jsonb_build_object('antes', r.estado, 'motivo', p_motivo), r.branch_id, 'portal');
  RETURN json_build_object('ok', true, 'id', p_id, 'estado', p_estado);
END;
$function$;

-- Vencer. Una reserva PAGADA no se pierde nunca sola: cumplido su plazo de
-- apartada, vuelve a «pendiente» (el producto se libera, el pago sigue), y no
-- la vence el fin de la oferta — el precio quedó pagado.
CREATE OR REPLACE FUNCTION public.reservas_vencer()
 RETURNS integer
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
  WITH liberadas AS (
    UPDATE public.app_reservas SET estado = 'pendiente', lista_at = NULL, vence_at = NULL, updated_at = now()
     WHERE estado = 'lista' AND vence_at < now() AND pago_estado = 'pagado'
    RETURNING 1),
  v AS (
    UPDATE public.app_reservas SET estado = 'vencida', cerrada_at = now(), updated_at = now()
     WHERE pago_estado <> 'pagado'
       AND ((estado = 'lista' AND vence_at < now())
         OR (estado = 'pendiente' AND oferta_fin IS NOT NULL
             AND oferta_fin < (now() AT TIME ZONE 'America/El_Salvador')::date))
    RETURNING 1)
  SELECT ((SELECT count(*) FROM liberadas) + (SELECT count(*) FROM v))::int;
$function$;
