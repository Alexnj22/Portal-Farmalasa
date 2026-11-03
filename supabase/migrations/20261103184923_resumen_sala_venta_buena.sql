SET lock_timeout = '5s';
-- La venta que SUBE contra su historia es una buena noticia, y Saly (la IA
-- del portal) la tiene que poder celebrar: la novedad de ventas lleva
-- `buena` para que la cara de Saly salga contenta y no «atenta» (2026-11-03).
-- Se parte de la definición VIVA y se le agrega sólo el campo.
DO $$
DECLARE d text; viejo text; nuevo text;
BEGIN
    d := pg_get_functiondef('public.resumen_sala_novedades(bigint,jsonb)'::regprocedure);
    IF position('''buena''' IN d) > 0 THEN RETURN; END IF;
    viejo := $v$'clave', 'ventas', 'nivel', CASE WHEN v_cambio <= -35 THEN 'alta' ELSE 'media' END,$v$;
    nuevo := $v$'clave', 'ventas', 'nivel', CASE WHEN v_cambio <= -35 THEN 'alta' ELSE 'media' END, 'buena', v_cambio > 0,$v$;
    IF position(viejo IN d) = 0 THEN RAISE EXCEPTION 'resumen_sala_novedades cambió: no encuentro la novedad de ventas'; END IF;
    EXECUTE replace(d, viejo, nuevo);
END $$;
