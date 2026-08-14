SET lock_timeout = '5s';

-- La ventana de captura pasa a 07:00–23:00 de El Salvador (decisión del
-- usuario, 2026-08-14). Antes era 06:00–23:59, heredada del cron original.
--
-- Con los cortes capturados hasta hoy —36, de dos días— el más temprano fue a
-- las 12:27 y el más tarde a las 22:00, así que la hora de las 6 y la última
-- del día no cubrían nada y costaban 240 corridas diarias contra el sistema de
-- origen.
--
-- «Termina a las 11» se toma literal: la última llamada sale 22:59:30. Un corte
-- posterior no se pierde — el repaso de las 23:40 barre el día entero, y el
-- aviso a la sala sigue saliendo porque su guarda acepta hasta 12 horas de
-- desfase.
--
-- Va por `alter_job` y no por unschedule+schedule para no cambiar el jobid, y
-- el jobid sale del nombre: hardcodearlo ataría la migración a este proyecto.
SELECT cron.alter_job(
  (SELECT jobid FROM cron.job WHERE jobname = 'cortes-caja-30s'),
  command := $job$
  SELECT net.http_post(
    url     := 'https://sacecdkdmsdvgqnrsett.supabase.co/functions/v1/sync-cortes-caja',
    body    := '{}'::jsonb,
    headers := jsonb_build_object(
                 'Content-Type','application/json',
                 'Authorization','Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='admin_invoke_secret')),
    timeout_milliseconds := 150000)
  WHERE extract(hour FROM (current_timestamp AT TIME ZONE 'America/El_Salvador')) BETWEEN 7 AND 22;
$job$);
