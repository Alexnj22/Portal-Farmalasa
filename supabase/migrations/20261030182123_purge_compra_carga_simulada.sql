SET lock_timeout = '5s';

-- Cada «Revisar carga» deja una fila `simulada` para que «Cargar en Bodega»
-- mande exactamente lo revisado. Las que nunca se mandaron no son historia:
-- se borran a los 30 días. Lo enviado, lo fallido y lo «por comprobar» se queda,
-- igual que cualquier fila a la que apunte un reparto o un erróneo.
CREATE OR REPLACE FUNCTION public.purge_compra_carga_simulada()
RETURNS integer LANGUAGE plpgsql
SET search_path = public, extensions AS $$
DECLARE v_n integer;
BEGIN
  DELETE FROM public.compra_carga c
   WHERE c.estado = 'simulada'
     AND c.created_at < now() - interval '30 days'
     AND NOT EXISTS (SELECT 1 FROM public.compra_reparto r WHERE r.compra_carga_id = c.id)
     AND NOT EXISTS (SELECT 1 FROM public.compra_renglon_erroneo e WHERE e.compra_carga_id = c.id);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.purge_compra_carga_simulada() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_compra_carga_simulada() TO service_role;

SELECT cron.schedule('purge-compra-carga-simulada', '5 10 * * *', $$SELECT public.purge_compra_carga_simulada();$$);
