-- La guarda del cron `wallet-pases-minuto`, escrita directa (2026-11-24).
--
-- La anterior (20261124211019) preguntaba a `wallet_registros_por_avisar()` y
-- `wallet_google_por_avisar()`. Son `LANGUAGE sql` con `SET search_path`: no se
-- inlinean y la de Apple barre `puntos_cuenta` entera — medido, 593 bloques por
-- minuto para contestar «no». El mismo predicado escrito acá entra por la
-- llave de `puntos_cuenta` desde las tablas chicas: 11 bloques, 0.3 ms.
-- Si cambia el predicado de una de esas funciones, cambia también acá.
SET lock_timeout = '5s';

DO $$
DECLARE v_job bigint;
BEGIN
  SELECT jobid INTO v_job FROM cron.job WHERE jobname = 'wallet-pases-minuto';
  IF v_job IS NULL THEN
    RAISE NOTICE 'wallet-pases-minuto no existe: nada que cambiar';
    RETURN;
  END IF;
  PERFORM cron.alter_job(v_job, command := $cron$
  SELECT net.http_post(
    url := 'https://sacecdkdmsdvgqnrsett.supabase.co/functions/v1/wallet-pases/avisar',
    body := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_invoke_secret')),
    timeout_milliseconds := 50000)
  WHERE EXISTS (SELECT 1 FROM public.wallet_registros w
                  JOIN public.puntos_cuenta c ON c.customer_id = w.customer_id
                 WHERE c.updated_at > w.notificado_at)
     OR EXISTS (SELECT 1 FROM public.wallet_google_tarjetas g
                  JOIN public.puntos_cuenta c ON c.customer_id = g.customer_id
                 WHERE c.updated_at > g.notificado_at)
$cron$);
END $$;

ANALYZE public.wallet_google_tarjetas;
