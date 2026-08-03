SET lock_timeout = '5s';

-- El día 1 de cada mes se trae el Corte Z del mes ANTERIOR, que es el único que
-- ya está cerrado y no va a cambiar. Sin `periodo` en el body, la función
-- resuelve sola el mes anterior en hora de El Salvador — así el cron no lleva
-- fechas escritas que haya que mantener.
--
-- 09:00 UTC = 03:00 en El Salvador: dentro de la ventana 06:00-11:59 UTC en que
-- los crons de sync están quietos, y con el mes recién cerrado.
--
-- 145s de timeout: son 6 sucursales en secuencia (el origen sirve estos
-- reportes desde archivos temporales de ruta fija y dos peticiones a la vez
-- chocan), y cada una tarda pocos segundos.
SELECT cron.schedule(
  'corte-z-mensual',
  '0 9 1 * *',
  $cron$
  SELECT net.http_post(
    url     := 'https://sacecdkdmsdvgqnrsett.supabase.co/functions/v1/sync-corte-z',
    headers := jsonb_build_object(
                 'Content-Type','application/json',
                 'Authorization','Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='admin_invoke_secret')),
    body    := '{}'::jsonb,
    timeout_milliseconds := 145000
  );
  $cron$
);
