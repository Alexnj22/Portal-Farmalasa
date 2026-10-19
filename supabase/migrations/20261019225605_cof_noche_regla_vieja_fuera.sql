-- La regla de tres argumentos ya no la llama nadie (2026-10-19): las cinco
-- funciones de la base pasaron a la de cuatro en
-- `cof_noche_clientes_que_siempre_se_envian`, y `aplicar-solicitud-facturacion`
-- v36 ya manda el cliente. Si queda viva, alguien la vuelve a usar y se salta
-- a Mapfre y la Diócesis sin enterarse.

SET lock_timeout = '5s';

DO $do$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname <> 'cof_no_se_envia_mh'
       AND p.prosrc ~ 'cof_no_se_envia_mh\([^,()]*,[^,()]*,[^,()]*\)'
  ) THEN
    RAISE EXCEPTION 'Todavía hay una función que llama a la regla de tres argumentos';
  END IF;
END
$do$;

DROP FUNCTION IF EXISTS public.cof_no_se_envia_mh(text, date, time);
