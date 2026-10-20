SET lock_timeout = '5s';

-- Retirar lo apartado, parte 3 de 3: los atajos viejos pasan por el retiro (2026-10-20).

-- ── El atajo viejo ya no salta la aplicación ───────────────────────────────
-- `reserva_cambiar_estado('retirada')` marcaba pagado lo que tenía saldo sin
-- cobrar nada, y `encargo_responder('entregado')` no miraba el pago. Con un
-- anticipo de por medio, ahora piden pasar por el retiro.
DO $do$
DECLARE v text; v2 text;
BEGIN
  v := pg_get_functiondef('public.reserva_cambiar_estado(bigint, text, text)'::regprocedure);
  v2 := replace(v, $a$  ELSIF p_estado = 'retirada' AND r.estado = 'lista' THEN
$a$, $b$  ELSIF p_estado = 'retirada' AND r.estado = 'lista' THEN
    -- Con anticipo, el retiro lo hace `apartado_entregar` / «Retirar» (2026-10-20).
    IF NOT coalesce(r.pago_prueba, false)
       AND greatest(coalesce(r.anticipo, 0), CASE WHEN r.pago_estado = 'pagado' THEN 1 ELSE 0 END) > 0
       AND NOT EXISTS (SELECT 1 FROM public.apartado_aplicaciones a WHERE a.reserva_id = r.id) THEN
      RAISE EXCEPTION 'Esta reserva tiene un pago: usa «Retirar» para aplicarlo a la factura.' USING ERRCODE = 'P0001';
    END IF;
$b$);
  IF v2 = v THEN RAISE EXCEPTION 'reserva_cambiar_estado: no se encontró la rama de retirada'; END IF;
  EXECUTE v2;

  v := pg_get_functiondef('public.encargo_responder(bigint, text, numeric, date, text)'::regprocedure);
  v2 := replace(v, $a$  ELSIF p_accion = 'entregado' AND e.estado = 'listo' THEN
$a$, $b$  ELSIF p_accion = 'entregado' AND e.estado = 'listo' THEN
    IF e.pago_estado = 'pagado' AND NOT EXISTS (SELECT 1 FROM public.apartado_aplicaciones a WHERE a.encargo_id = e.id) THEN
      RAISE EXCEPTION 'Este encargo está pagado: usa «Retirar» para aplicar el pago a la factura.' USING ERRCODE = 'P0001';
    END IF;
$b$);
  IF v2 = v THEN RAISE EXCEPTION 'encargo_responder: no se encontró la rama de entregado'; END IF;
  EXECUTE v2;
END $do$;

-- ── Deshacer y corregir miran SÓLO el anticipo ─────────────────────────────
-- El vale del retiro también lleva `reserva_id`, y anularlo no es devolver un
-- anticipo: sin esta guarda, `apartado_deshacer` le restaría el vale a la
-- reserva (o la borraría).
DO $do$
DECLARE v text; v2 text;
BEGIN
  v := pg_get_functiondef('public.apartado_deshacer(bigint, boolean)'::regprocedure);
  v2 := replace(replace(v,
    $a$  IF NOT FOUND THEN RETURN; END IF;
  IF m.reserva_id IS NOT NULL THEN$a$,
    $b$  IF NOT FOUND THEN RETURN; END IF;
  IF m.tipo_codigo IS DISTINCT FROM 'APARTADO' THEN RETURN; END IF;
  IF m.reserva_id IS NOT NULL THEN$b$),
    $a$x.id <> m.id AND x.anulado_at IS NULL$a$, $b$x.id <> m.id AND x.anulado_at IS NULL AND x.tipo_codigo = 'APARTADO'$b$);
  IF v2 = v OR position('IS DISTINCT FROM ''APARTADO''' in v2) = 0 OR position('x.tipo_codigo = ''APARTADO''' in v2) = 0 THEN
    RAISE EXCEPTION 'apartado_deshacer: no se encontró dónde poner la guarda';
  END IF;
  EXECUTE v2;
  v := pg_get_functiondef('public.apartado_cambiar_monto(bigint, numeric, numeric)'::regprocedure);
  v2 := replace(v, $a$IF NOT FOUND OR m.reserva_id IS NULL THEN RETURN; END IF;$a$,
                   $b$IF NOT FOUND OR m.reserva_id IS NULL OR m.tipo_codigo IS DISTINCT FROM 'APARTADO' THEN RETURN; END IF;$b$);
  IF v2 = v THEN RAISE EXCEPTION 'apartado_cambiar_monto: no se encontró la guarda'; END IF;
  EXECUTE v2;
END $do$;
