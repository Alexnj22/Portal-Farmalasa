SET lock_timeout = '5s';

-- El repaso de CCF de las 22:00 de El Salvador = 04:00 UTC.
--
-- UN SOLO CRON para las dos cosas. El aviso del ultimo dia del mes no tiene su
-- propio cron porque cron no sabe decir "el ultimo dia del mes": habria que
-- programarlo del 28 al 31 y filtrar igual dentro. La pregunta la responde
-- `es_ultimo_dia_del_mes_sv()` en la base, que ademas se puede probar.
--
-- Manda `x-cron-secret` como el resto de las alertas: `check-sales-alerts`
-- valida con `checkCronSecret`, no con un JWT.
SELECT cron.schedule(
  'ccf-repaso-22h-sv',
  '0 4 * * *',
  $cron$
  SELECT net.http_post(
    url     := 'https://sacecdkdmsdvgqnrsett.supabase.co/functions/v1/check-sales-alerts',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets
                                    WHERE name = 'cron_invoke_secret')),
    body    := '{"modo":"cierre_dia"}'::jsonb,
    timeout_milliseconds := 120000
  );
  $cron$
);
