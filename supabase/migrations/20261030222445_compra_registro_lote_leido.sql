SET lock_timeout = '5s';
-- El lote: el que viajó al sistema (sólo regulados) o, si no, el que Bodega leyó/escribió en la carga.
DO $$
DECLARE d text := pg_get_functiondef('public.compra_registro_anotar_carga(bigint)'::regprocedure);
BEGIN
  IF position($x$nullif(l->>'numero_lote', ''),$x$ IN d) = 0 THEN RAISE EXCEPTION 'no encontré el lote'; END IF;
  EXECUTE replace(d, $x$nullif(l->>'numero_lote', ''),$x$,
                     $x$coalesce(nullif(l->>'numero_lote', ''), nullif(r->>'lote_leido', '')),$x$);
END $$;
