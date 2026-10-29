-- PENDIENTES 30: el espejo de las campañas de descuento se pone al día tres
-- veces al día (7:00, 13:00 y 19:00 SV). Una campaña dura días; lo que importa
-- es no perder una que se borre o se edite allá.
SELECT cron.schedule('espejo-descuentos', '0 13,19,1 * * *', $cron$
    select net.http_post(
      url := 'https://sacecdkdmsdvgqnrsett.supabase.co/functions/v1/espejo-descuentos',
      headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='cron_invoke_secret')),
      body := '{}'::jsonb,
      timeout_milliseconds := 60000
    );
  $cron$)
 WHERE NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'espejo-descuentos');
