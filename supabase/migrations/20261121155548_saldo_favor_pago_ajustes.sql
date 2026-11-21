-- Saldo a favor como pago: dos ajustes (2026-11-21).
--   · Preventa sólo ofrece el saldo de la ficha elegida: el vale y el abono
--     exigen que la factura esté a nombre del dueño del saldo (una cuenta unida
--     es otra ficha y la factura no le serviría).
--   · El camino viejo (convertir el saldo en puntos que la factura RESTA) se
--     cierra: dejaba el anticipo fuera de toda factura. Una pantalla vieja que
--     todavía lo llame recibe el aviso.
SET lock_timeout = '5s';
DO $migra$
DECLARE v_def text; v_n integer;
  v_ancla text := $a$WHERE (r.customer_id = c.id OR public.puntos_titular(r.customer_id) = public.puntos_titular(c.id))$a$;
BEGIN
  v_def := pg_get_functiondef('public.preventa_cliente(bigint,bigint)'::regprocedure);
  v_n := (length(v_def) - length(replace(v_def, v_ancla, ''))) / length(v_ancla);
  IF v_n <> 1 THEN RAISE EXCEPTION 'preventa_cliente: el fragmento aparece % veces.', v_n; END IF;
  EXECUTE replace(v_def, v_ancla, $b$WHERE r.customer_id = c.id$b$);

  v_def := pg_get_functiondef('public.reserva_usar_saldo_favor(bigint,numeric,text)'::regprocedure);
  v_ancla := $a$BEGIN
  SELECT * INTO r FROM public.app_reservas WHERE id = p_id FOR UPDATE;$a$;
  v_n := (length(v_def) - length(replace(v_def, v_ancla, ''))) / length(v_ancla);
  IF v_n <> 1 THEN RAISE EXCEPTION 'reserva_usar_saldo_favor: el fragmento aparece % veces.', v_n; END IF;
  EXECUTE replace(v_def, v_ancla, $b$BEGIN
  -- Cerrado el 2026-11-21: el saldo se usa como PAGO (`saldo_favor_apartar`).
  RAISE EXCEPTION 'El saldo a favor ahora se aplica como pago. Actualiza la pantalla e inténtalo de nuevo.' USING ERRCODE = 'P0001';
  SELECT * INTO r FROM public.app_reservas WHERE id = p_id FOR UPDATE;$b$);
END $migra$;
