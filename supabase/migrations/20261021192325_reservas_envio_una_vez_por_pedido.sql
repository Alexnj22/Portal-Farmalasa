-- El envío es por TODO el pedido, no por renglón (decisión del dueño,
-- 2026-10-21: «el envío es por todo»).
--
-- `app_reservas.costo_envio` se guarda en CADA renglón del pedido (el insert de
-- `reservar_carrito` copia el mismo monto en todos). La app y la sala ya lo
-- leían bien (`max` por pedido), pero `reserva_cuenta` lo sumaba en cada
-- renglón: un pedido de 3 renglones a domicilio cobraba el envío 3 veces en la
-- caja (`apartado_cotizar`/`apartado_aplicar`), en la preventa
-- (`preventa_preparar` suma las cuentas) y al retirar.
--
-- Regla: el envío lo lleva UN renglón del pedido — el de menor id entre los que
-- siguen en pie (ni cancelado ni vencido); si ya no queda ninguno, el de menor
-- id. Así la suma de las cuentas de un pedido da el envío una sola vez, y si se
-- cancela el renglón que lo llevaba, pasa al siguiente que todavía se entrega.
-- La columna no cambia: sigue siendo «cuánto cuesta el envío de este pedido».
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.reserva_envio(p_id bigint)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  r record;
  v_portadora bigint;
BEGIN
  SELECT id, pedido, costo_envio INTO r FROM public.app_reservas WHERE id = p_id;
  IF NOT FOUND OR coalesce(r.costo_envio, 0) <= 0 THEN RETURN 0; END IF;
  IF r.pedido IS NULL THEN RETURN round(r.costo_envio, 2); END IF;
  SELECT x.id INTO v_portadora
    FROM public.app_reservas x
   WHERE x.pedido = r.pedido
   ORDER BY (x.estado IN ('cancelada', 'vencida')), x.id
   LIMIT 1;
  RETURN CASE WHEN v_portadora = p_id THEN round(r.costo_envio, 2) ELSE 0 END;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.reserva_envio(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reserva_envio(bigint) TO authenticated, service_role;

-- Misma firma y mismo resultado salvo el envío. Pasa de `LANGUAGE sql` + SET a
-- plpgsql (la combinación que se planifica sin ver el argumento).
CREATE OR REPLACE FUNCTION public.reserva_cuenta(p_id bigint)
 RETURNS TABLE(total numeric, pagado numeric, falta_pagar numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  r record;
  v_total numeric;
  v_pagado numeric;
BEGIN
  SELECT a.precio_unitario, a.cantidad, a.anticipo, a.pago_estado, a.pago_prueba
    INTO r FROM public.app_reservas a WHERE a.id = p_id;
  IF NOT FOUND THEN RETURN; END IF;
  v_total := round(coalesce(r.precio_unitario, 0) * r.cantidad + public.reserva_envio(p_id), 2);
  v_pagado := round(greatest(greatest(coalesce(r.anticipo, 0), 0),
                             CASE WHEN r.pago_estado = 'pagado' AND NOT coalesce(r.pago_prueba, false)
                                  THEN v_total ELSE 0 END), 2);
  RETURN QUERY SELECT v_total, v_pagado, round(greatest(v_total - v_pagado, 0), 2);
END;
$function$;

-- El cobro en línea separaba el envío de cada renglón restando `costo_envio`
-- (que está en todos): con la cuenta nueva sólo un renglón lo trae, así que se
-- resta lo que la cuenta de ESE renglón incluye. Se edita la definición viva.
DO $mig$
DECLARE
  d text := pg_get_functiondef('public.app_reserva_pago_confirmar(text,text,numeric,boolean,text,text,jsonb)'::regprocedure);
  v_old text := 'greatest(round(k.falta_pagar - coalesce(r.costo_envio, 0), 2), 0)';
  v_new text := 'greatest(round(k.falta_pagar - public.reserva_envio(r.id), 2), 0)';
BEGIN
  IF (length(d) - length(replace(d, v_old, ''))) / length(v_old) <> 1 THEN
    RAISE EXCEPTION 'app_reserva_pago_confirmar: la línea a cambiar no aparece una sola vez';
  END IF;
  EXECUTE replace(d, v_old, v_new);
END
$mig$;
