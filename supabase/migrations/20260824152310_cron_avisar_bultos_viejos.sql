SET lock_timeout = '5s';

-- El aviso diario de las bolsas que llevan días encima de alguien.
--
-- Una vez al día y no más seguido: lo que vigila se mueve en días, no en
-- minutos, y un aviso que se repite cada hora es ruido que se aprende a
-- ignorar. El antiduplicado de la función lleva los días adentro de su
-- `check_key`, así que el aviso vuelve UNA vez por día que pasa — que es lo que
-- hace que el número suba a la vista de todos en vez de sonar una sola vez.
--
-- 15:00 UTC son las 9 de la mañana en El Salvador: temprano, con las salas ya
-- abiertas, y fuera del minuto de los avisos que ya existen.
--
-- `cron.unschedule` CON GUARDA: sin el `WHERE EXISTS` la migración no se puede
-- reproducir sobre una base que no tiene el job, y el replay del historial se
-- corta ahí (incidente 2026-08-23).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'avisar-bultos-viejos-daily') THEN
    PERFORM cron.unschedule('avisar-bultos-viejos-daily');
  END IF;
END $$;

SELECT cron.schedule(
  'avisar-bultos-viejos-daily',
  '0 15 * * *',
  $cron$
  SELECT net.http_post(
    url     := 'https://sacecdkdmsdvgqnrsett.supabase.co/functions/v1/avisar-bultos-viejos',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'admin_invoke_secret')),
    body    := '{}'::jsonb
  );
  $cron$
);
