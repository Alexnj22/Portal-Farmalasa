SET lock_timeout = '5s';

-- El carrito se paga DE UNA (2026-10-07): un solo cobro de Wompi por todo el
-- pedido, y el pedido dice qué documento quiere el cliente (consumidor final o
-- crédito fiscal, con sus datos). La sucursal factura con eso.
ALTER TABLE public.app_reservas
    ADD COLUMN documento text NOT NULL DEFAULT 'consumidor_final' CHECK (documento IN ('consumidor_final', 'credito_fiscal')),
    ADD COLUMN datos_fiscales jsonb,
    ADD CONSTRAINT app_reservas_ccf_con_datos CHECK (documento <> 'credito_fiscal' OR datos_fiscales IS NOT NULL);

-- Un intento de pago es de UNA reserva o de UN pedido entero.
ALTER TABLE public.app_reservas_pagos ALTER COLUMN reserva_id DROP NOT NULL;
ALTER TABLE public.app_reservas_pagos ADD COLUMN pedido text;
ALTER TABLE public.app_reservas_pagos ADD CONSTRAINT app_reservas_pagos_de_algo CHECK (reserva_id IS NOT NULL OR pedido IS NOT NULL);
CREATE INDEX app_reservas_pagos_pedido_idx ON public.app_reservas_pagos (pedido) WHERE pedido IS NOT NULL;

-- Confirmar: con pedido, se marcan pagadas TODAS sus filas. Partiendo de la
-- definición viva (de la sesión de Wompi); la rama de una reserva no cambia.
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
BEGIN
  SELECT * INTO p FROM public.app_reservas_pagos WHERE identificador = p_identificador FOR UPDATE;
  IF NOT FOUND THEN RETURN json_build_object('ok', false, 'motivo', 'sin_pago'); END IF;
  IF p.estado = 'aprobado' THEN
    RETURN json_build_object('ok', true, 'ya', true, 'reserva_id', p.reserva_id, 'pedido', p.pedido);
  END IF;
  -- Una transacción paga UNA reserva (o un pedido): el mismo id pegado a otro
  -- enlace es alguien reusando su comprobante.
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

  SELECT array_agg(id) INTO v_ids FROM public.app_reservas
   WHERE (p.pedido IS NOT NULL AND pedido = p.pedido) OR (p.pedido IS NULL AND id = p.reserva_id);

  FOR r IN SELECT * FROM public.app_reservas WHERE id = ANY (v_ids) FOR UPDATE LOOP
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
                               'estado_antes', r.estado, 'forma', p_forma, 'pedido', p.pedido),
            r.branch_id, 'SYSTEM');
  END LOOP;
  RETURN json_build_object('ok', true, 'reserva_id', p.reserva_id, 'pedido', p.pedido, 'reservas', coalesce(array_length(v_ids, 1), 0));
END;
$function$;
