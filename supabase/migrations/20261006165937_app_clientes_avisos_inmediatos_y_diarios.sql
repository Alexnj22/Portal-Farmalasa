-- Avisos de la app de clientes (2026-10-06, decisión del usuario): lo que
-- acaba de pasar (puntos ganados, oferta nueva) CADA MINUTO de 8:00 a 20:00 SV;
-- los recordatorios (puntos por vencer, inyección pendiente) una vez al día a
-- las 9:00 SV. Reemplaza al cron único de cada 15 minutos.
SET lock_timeout = '5s';

SELECT cron.unschedule('avisos-clientes-15min')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'avisos-clientes-15min');

SELECT cron.schedule('avisos-clientes-minuto', '* 14-23,0-1 * * *', $cron$
  SELECT net.http_post(
    url := 'https://sacecdkdmsdvgqnrsett.supabase.co/functions/v1/avisos-clientes',
    body := '{"modo":"inmediato"}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_invoke_secret')),
    timeout_milliseconds := 50000)
$cron$);

SELECT cron.schedule('avisos-clientes-diario', '0 15 * * *', $cron$
  SELECT net.http_post(
    url := 'https://sacecdkdmsdvgqnrsett.supabase.co/functions/v1/avisos-clientes',
    body := '{"modo":"diario"}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_invoke_secret')),
    timeout_milliseconds := 60000)
$cron$);
