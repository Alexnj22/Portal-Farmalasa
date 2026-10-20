SET lock_timeout = '5s';

-- ═══════════════════════════════════════════════════════════════════════════
-- Pagar un crédito desde la app con Wompi (2026-10-20).
--
-- Decisiones del dueño: se paga el saldo TOTAL de un crédito; queda en el
-- sistema de la caja como «Transferencia», en la sala del crédito; se aplica
-- SOLO cuando Wompi lo aprobó; y si el crédito ya estaba pagado cuando llega
-- el dinero, se le devuelve al cliente en caja (Wompi no anula cobros de
-- enlace de pago: su API sólo anula los de Visa Direct).
--
-- El cobro reusa `app_reservas_pagos` —el mismo enlace, el mismo aviso, la
-- misma confirmación idempotente— con tres columnas que dicen a qué crédito
-- va. El ABONO no se hace dentro de la confirmación: el sistema de la caja
-- tarda hasta 45 s y el aviso de Wompi tiene que contestar rápido. La
-- confirmación deja `abono_estado = 'pendiente'` y lo aplica
-- `_shared/creditoEnLinea.ts` (enseguida, y `sync-creditos` lo reintenta).
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.app_reservas_pagos
  ADD COLUMN IF NOT EXISTS credito_id        bigint REFERENCES public.creditos_de_clientes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS credito_branch_id integer REFERENCES public.branches(id),
  ADD COLUMN IF NOT EXISTS credito_erp       text,
  ADD COLUMN IF NOT EXISTS customer_id       bigint REFERENCES public.customers(id),
  -- pendiente → aplicando → aplicado | por_devolver; fallo se reintenta.
  -- `prueba`: un cobro de mentira de Wompi NUNCA mueve una deuda real.
  ADD COLUMN IF NOT EXISTS abono_estado      text,
  ADD COLUMN IF NOT EXISTS abono_intentos    integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS abono_tomado_at   timestamptz,
  ADD COLUMN IF NOT EXISTS abono_error       text,
  ADD COLUMN IF NOT EXISTS abono_at          timestamptz,
  ADD COLUMN IF NOT EXISTS devolver_monto    numeric;

ALTER TABLE public.app_reservas_pagos DROP CONSTRAINT IF EXISTS app_reservas_pagos_de_algo;
ALTER TABLE public.app_reservas_pagos ADD CONSTRAINT app_reservas_pagos_de_algo
  CHECK (reserva_id IS NOT NULL OR pedido IS NOT NULL OR encargo_id IS NOT NULL
         OR (credito_branch_id IS NOT NULL AND credito_erp IS NOT NULL));
ALTER TABLE public.app_reservas_pagos DROP CONSTRAINT IF EXISTS app_reservas_pagos_abono_estado_check;
ALTER TABLE public.app_reservas_pagos ADD CONSTRAINT app_reservas_pagos_abono_estado_check
  CHECK (abono_estado IS NULL OR abono_estado IN ('pendiente', 'aplicando', 'aplicado', 'por_devolver', 'fallo', 'prueba'));

CREATE INDEX IF NOT EXISTS app_reservas_pagos_credito_idx
  ON public.app_reservas_pagos (credito_branch_id, credito_erp) WHERE credito_erp IS NOT NULL;
CREATE INDEX IF NOT EXISTS app_reservas_pagos_credito_id_idx
  ON public.app_reservas_pagos (credito_id) WHERE credito_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS app_reservas_pagos_customer_idx
  ON public.app_reservas_pagos (customer_id) WHERE customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS app_reservas_pagos_abono_por_aplicar_idx
  ON public.app_reservas_pagos (id) WHERE abono_estado IN ('pendiente', 'aplicando', 'fallo');

-- El abono que hace la app no lo cobró una persona: `abonado_por` queda
-- vacío y `origen = 'app'` lo dice. Un pago, un abono (índice único).
ALTER TABLE public.creditos_abonos_portal ALTER COLUMN abonado_por DROP NOT NULL;
ALTER TABLE public.creditos_abonos_portal
  ADD COLUMN IF NOT EXISTS origen      text NOT NULL DEFAULT 'portal',
  ADD COLUMN IF NOT EXISTS app_pago_id bigint REFERENCES public.app_reservas_pagos(id);
ALTER TABLE public.creditos_abonos_portal DROP CONSTRAINT IF EXISTS creditos_abonos_portal_origen_check;
ALTER TABLE public.creditos_abonos_portal ADD CONSTRAINT creditos_abonos_portal_origen_check
  CHECK (origen IN ('portal', 'app') AND (abonado_por IS NOT NULL OR origen = 'app'));
CREATE UNIQUE INDEX IF NOT EXISTS creditos_abonos_portal_app_pago_uq
  ON public.creditos_abonos_portal (app_pago_id) WHERE app_pago_id IS NOT NULL;

-- ── La confirmación: misma función, con la rama del crédito ───────────────
-- Partida de la definición VIVA (pg_get_functiondef, 2026-10-20). Lo único
-- nuevo es el bloque «Un crédito» y que el «ya estaba» devuelva `credito`.
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

-- ── Tomar un pago para abonarlo: de a uno y una sola vez ──────────────────
-- Atómico: dos procesos a la vez (el aviso de Wompi y la vuelta del
-- navegador, o el reintento de `sync-creditos`) no pueden abonar el mismo
-- pago. Uno 'aplicando' de más de 10 minutos se da por caído y se vuelve a
-- tomar: quien lo toma busca PRIMERO en la caja si el abono ya está (por su
-- documento `WOMPI-<transacción>`) antes de abonar otra vez.
CREATE OR REPLACE FUNCTION public.credito_pago_tomar(p_pago_id bigint)
 RETURNS SETOF public.app_reservas_pagos
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
  UPDATE public.app_reservas_pagos
     SET abono_estado = 'aplicando', abono_tomado_at = now(), abono_intentos = abono_intentos + 1
   WHERE id = p_pago_id AND estado = 'aprobado' AND es_real AND credito_erp IS NOT NULL
     AND (abono_estado IN ('pendiente', 'fallo')
          OR (abono_estado = 'aplicando' AND abono_tomado_at < now() - interval '10 minutes'))
  RETURNING *;
$function$;
REVOKE EXECUTE ON FUNCTION public.credito_pago_tomar(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.credito_pago_tomar(bigint) TO service_role;

-- ── Avisar a Administración: hay que devolver, o no se pudo abonar ────────
CREATE OR REPLACE FUNCTION public.credito_pago_avisar(p_pago_id bigint, p_tipo text, p_texto text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_dest uuid[];
  p public.app_reservas_pagos;
BEGIN
  SELECT * INTO p FROM public.app_reservas_pagos WHERE id = p_pago_id;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT array_agg(e.id) INTO v_dest FROM public.employees e
   WHERE e.status = 'ACTIVO' AND public.rango_de_empleado(e.id) >= 3;
  IF v_dest IS NOT NULL THEN
    PERFORM public.notify_employees(v_dest, p_tipo,
      CASE p_tipo WHEN 'CREDITO_PAGO_POR_DEVOLVER' THEN 'Devolver un pago en línea'
                  ELSE 'Pago en línea sin abonar' END,
      p_texto, '/cuentas-por-cobrar',
      jsonb_build_object('check_key', lower(p_tipo) || ':' || p_pago_id), true, p.credito_branch_id);
  END IF;
  INSERT INTO public.audit_logs (action, target_id, details, branch_id, source, severity)
  VALUES (p_tipo, p.credito_erp,
          jsonb_build_object('pago_id', p.id, 'monto', p.monto, 'devolver', p.devolver_monto,
                             'transaccion', p.id_transaccion, 'texto', p_texto),
          p.credito_branch_id, 'SYSTEM', 'WARNING');
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.credito_pago_avisar(bigint, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.credito_pago_avisar(bigint, text, text) TO service_role;
