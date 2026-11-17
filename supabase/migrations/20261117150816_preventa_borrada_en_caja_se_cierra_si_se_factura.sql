-- Preventa borrada en caja (2026-11-17): quien anula confirma que la borraron
-- allá y queda 'descartada' con error 'La borraron en caja.'. Si resulta que sí
-- se facturó, el cierre automático la pasa a facturada igual: se agrega ese
-- caso al WHERE de la definición VIVA (md5 37dbc20f…), sin tocar el resto.
SET lock_timeout = '5s';
DO $$
DECLARE d text := pg_get_functiondef('public.preventas_cerrar_facturadas()'::regprocedure);
BEGIN
  IF position($w$WHERE pv.estado = 'viva' AND pv.sistema = 'caja'$w$ IN d) = 0 THEN
    RAISE NOTICE 'preventas_cerrar_facturadas ya cambió: no se toca';
    RETURN;
  END IF;
  d := replace(d, $w$WHERE pv.estado = 'viva' AND pv.sistema = 'caja'$w$,
    $w$WHERE (pv.estado = 'viva' OR (pv.estado = 'descartada' AND pv.error = 'La borraron en caja.')) AND pv.sistema = 'caja'$w$);
  EXECUTE d;
END $$;
