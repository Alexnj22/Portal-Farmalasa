SET lock_timeout = '5s';

/* Un cron que se llama `creditos-cada-hora` y corre cada 10 minutos es una
 * mentira que alguien va a creer: el nombre es lo primero que se lee en
 * `cron.job`, en el panel y en el manifiesto del gate. Se rebautiza. */
/* Con guarda: `cron.unschedule` LANZA si el trabajo no existe, y en una base
 * vacía eso aborta la migración y todas las que vienen detrás. En producción el
 * trabajo existía, así que el efecto es idéntico — la guarda es para que el
 * historial se pueda reproducir desde cero. */
SELECT cron.unschedule('creditos-cada-hora')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'creditos-cada-hora');

SELECT cron.schedule(
  'creditos-cada-10min',
  '*/10 13-23,0-3 * * *',
  $cron$
  SELECT net.http_post(
    url     := 'https://sacecdkdmsdvgqnrsett.supabase.co/functions/v1/sync-creditos',
    body    := '{}'::jsonb,
    headers := jsonb_build_object(
                 'Content-Type','application/json',
                 'Authorization','Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='admin_invoke_secret'),
                 'x-invoke-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='admin_invoke_secret')),
    timeout_milliseconds := 150000
  );
  $cron$
);
