-- `apartado_crear_reserva` con `p_sin_pagar = true` escribía `pago_metodo =
-- NULL`, y la columna es NOT NULL (default 'al_retirar'): la rama sin pagar
-- nunca pudo insertar. Nadie la había llamado hasta la reserva sin anticipo
-- (2026-11-05), que la usa. Sin pagar = se paga al retirar.
-- Se parte de la definición VIVA; si el texto no está, falla.
SET lock_timeout = '5s';
DO $do$
DECLARE
  d text := pg_get_functiondef('public.apartado_crear_reserva(bigint,bigint,jsonb,numeric,text,uuid,text,boolean)'::regprocedure);
  a text := 'CASE WHEN p_sin_pagar THEN NULL ELSE p_metodo END';
BEGIN
  IF position(a IN d) = 0 THEN
    IF position($x$CASE WHEN p_sin_pagar THEN 'al_retirar' ELSE p_metodo END$x$ IN d) > 0 THEN RETURN; END IF;
    RAISE EXCEPTION 'apartado_crear_reserva cambió: no se encontró el pago_metodo sin pagar.';
  END IF;
  EXECUTE replace(d, a, $x$CASE WHEN p_sin_pagar THEN 'al_retirar' ELSE p_metodo END$x$);
END $do$;
