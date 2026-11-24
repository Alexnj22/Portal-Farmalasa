-- `wallet-pases /avisar` sólo cuando HAY algo que avisar (2026-11-24).
--
-- El cron (`wallet-pases-minuto`, despachado por `tick-minuto`) llamaba a la
-- función cada minuto con que hubiera UN teléfono de Apple registrado: 1,436
-- llamadas al día para casi nunca tener nada. Ahora la base decide antes de
-- llamar: hay una tarjeta de Apple o de Google cuyo saldo cambió después de su
-- último aviso. Las dos consultas recorren las tablas chicas
-- (`wallet_registros`, `wallet_google_tarjetas`) y entran a `puntos_cuenta` por
-- su llave. Un aviso que falla no se anota, así que el minuto siguiente vuelve
-- a cumplir la condición y se reintenta.
--
-- Y el barrido diario de Google (`wallet-google-reconciliar-diario`, 03:40 SV):
-- anota quién tiene la tarjeta según la lista de objetos de Google.
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
  WHERE EXISTS (SELECT 1 FROM public.wallet_registros_por_avisar())
     OR EXISTS (SELECT 1 FROM public.wallet_google_por_avisar())
$cron$);
END $$;

DO $$
BEGIN
  -- En el entorno de pruebas no hay secreto para llamar a producción: no se agenda.
  IF NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'cron_invoke_secret') THEN
    RAISE NOTICE 'sin cron_invoke_secret: no se agenda wallet-google-reconciliar-diario';
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'wallet-google-reconciliar-diario') THEN
    RETURN;
  END IF;
  PERFORM cron.schedule('wallet-google-reconciliar-diario', '40 9 * * *', $cron$
  SELECT net.http_post(
    url := 'https://sacecdkdmsdvgqnrsett.supabase.co/functions/v1/wallet-pases/reconciliar-google',
    body := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_invoke_secret')),
    timeout_milliseconds := 120000)
$cron$);
END $$;
