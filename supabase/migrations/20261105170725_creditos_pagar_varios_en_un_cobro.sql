-- Pagar varios créditos con un solo cobro de Wompi (2026-11-05).
-- Usuario: «ahí mismo en créditos para pagarlos, que haya una opción de pagar
-- todos o seleccionar para pagar unos».
--
-- Una fila «lote» (es_lote, identificador «CL-…») lleva el TOTAL que cobra
-- Wompi y no es de ningún crédito. Cada crédito elegido tiene su fila hija
-- (lote_de = lote) con su saldo y su credito_id/credito_erp/credito_branch_id.
-- Al confirmar el lote, las hijas quedan aprobadas con abono 'pendiente' y se
-- abonan una por una con la misma maquinaria de un pago suelto
-- (credito_pago_tomar + _shared/creditoEnLinea.ts; sync-creditos reintenta las
-- que fallen). La transacción de cada hija lleva «/n» porque id_transaccion es
-- UNIQUE, y el documento del abono en la caja sale de ella.
--
-- Función APARTE y no un bloque más en app_reserva_pago_confirmar: wompi-pagos
-- la elige por el prefijo «CL-» del identificador, y ésta además exige
-- es_lote. Así la función de reservas, encargos y créditos sueltos no se toca.
SET lock_timeout = '5s';

ALTER TABLE public.app_reservas_pagos
  ADD COLUMN IF NOT EXISTS es_lote boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS lote_de bigint REFERENCES public.app_reservas_pagos(id);

CREATE INDEX IF NOT EXISTS app_reservas_pagos_lote_de_idx
  ON public.app_reservas_pagos (lote_de) WHERE lote_de IS NOT NULL;

ALTER TABLE public.app_reservas_pagos DROP CONSTRAINT IF EXISTS app_reservas_pagos_de_algo;
ALTER TABLE public.app_reservas_pagos ADD CONSTRAINT app_reservas_pagos_de_algo
  CHECK (reserva_id IS NOT NULL OR pedido IS NOT NULL OR encargo_id IS NOT NULL
         OR (credito_branch_id IS NOT NULL AND credito_erp IS NOT NULL) OR es_lote);

CREATE OR REPLACE FUNCTION public.app_credito_lote_confirmar(
  p_identificador text, p_id_transaccion text, p_monto numeric, p_es_real boolean,
  p_codigo text, p_forma text, p_detalle jsonb)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  p public.app_reservas_pagos;
  v_suma numeric;
BEGIN
  SELECT * INTO p FROM public.app_reservas_pagos WHERE identificador = p_identificador FOR UPDATE;
  IF NOT FOUND OR NOT p.es_lote THEN RETURN json_build_object('ok', false, 'motivo', 'sin_pago'); END IF;
  -- Repetido (el aviso de Wompi y la vuelta del navegador llegan los dos): se
  -- devuelven las hijas que todavía esperan su abono, para reintentarlas.
  IF p.estado = 'aprobado' THEN
    RETURN json_build_object('ok', true, 'ya', true, 'credito', true, 'lote', true, 'pago_id', p.id, 'prueba', NOT coalesce(p.es_real, false),
      'pagos', (SELECT coalesce(json_agg(h.id ORDER BY h.id), '[]'::json) FROM public.app_reservas_pagos h
                 WHERE h.lote_de = p.id AND h.abono_estado IN ('pendiente', 'fallo')));
  END IF;
  IF EXISTS (SELECT 1 FROM public.app_reservas_pagos WHERE id_transaccion = p_id_transaccion AND id <> p.id) THEN
    RETURN json_build_object('ok', false, 'motivo', 'tx_usada');
  END IF;
  IF round(p_monto, 2) <> p.monto THEN
    RETURN json_build_object('ok', false, 'motivo', 'monto', 'esperado', p.monto, 'recibido', p_monto);
  END IF;
  -- Las hijas tienen que sumar el total cobrado: si no, algo se armó mal y no
  -- se abona nada a ciegas (queda para revisar a mano).
  SELECT round(coalesce(sum(monto), 0), 2) INTO v_suma FROM public.app_reservas_pagos WHERE lote_de = p.id;
  IF v_suma <> p.monto THEN
    RETURN json_build_object('ok', false, 'motivo', 'lote_descuadrado', 'esperado', p.monto, 'hijas', v_suma);
  END IF;

  UPDATE public.app_reservas_pagos
     SET estado = 'aprobado', id_transaccion = p_id_transaccion, es_real = p_es_real,
         codigo_autorizacion = p_codigo, forma_pago = p_forma, detalle = p_detalle, pagado_at = now()
   WHERE id = p.id;

  WITH h AS (
    SELECT id, row_number() OVER (ORDER BY id) AS n FROM public.app_reservas_pagos
     WHERE lote_de = p.id AND estado = 'creado'
  )
  UPDATE public.app_reservas_pagos x
     SET estado = 'aprobado', id_transaccion = p_id_transaccion || '/' || h.n, es_real = p_es_real,
         codigo_autorizacion = p_codigo, forma_pago = p_forma, detalle = p_detalle, pagado_at = now(),
         abono_estado = CASE WHEN p_es_real THEN 'pendiente' ELSE 'prueba' END
    FROM h WHERE x.id = h.id;

  INSERT INTO public.audit_logs (action, target_id, details, branch_id, source)
  SELECT 'CREDITO_PAGADO_EN_LINEA', h.credito_erp,
         jsonb_build_object('monto', h.monto, 'transaccion', h.id_transaccion, 'es_real', p_es_real,
                            'pago_id', h.id, 'lote', p.id, 'customer_id', h.customer_id),
         h.credito_branch_id, 'SYSTEM'
    FROM public.app_reservas_pagos h WHERE h.lote_de = p.id;

  RETURN json_build_object('ok', true, 'credito', true, 'lote', true, 'pago_id', p.id, 'prueba', NOT p_es_real,
    'pagos', (SELECT coalesce(json_agg(h.id ORDER BY h.id), '[]'::json) FROM public.app_reservas_pagos h WHERE h.lote_de = p.id));
END;
$$;

REVOKE EXECUTE ON FUNCTION public.app_credito_lote_confirmar(text, text, numeric, boolean, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_credito_lote_confirmar(text, text, numeric, boolean, text, text, jsonb) TO service_role;
