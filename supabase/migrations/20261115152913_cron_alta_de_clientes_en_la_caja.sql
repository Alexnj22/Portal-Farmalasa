SET lock_timeout = '5s';

-- La red bajo el alta inmediata de clientes nacidos en el portal (plan
-- PLAN-CLIENTES-SOLO-DESDE-EL-PORTAL-2026-11-15). La pantalla llama a
-- `alta-cliente-erp` apenas crea la ficha; si la caja estaba caída, esto la
-- reintenta con espera creciente (10 min, 20, 40… hasta 6 h). Sin nada
-- pendiente, la función contesta sin iniciar sesión en la caja.
-- Minuto 7: lejos de las en punto y del drenaje del espejo (minuto 3).
SELECT cron.unschedule('alta-cliente-erp-10min')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'alta-cliente-erp-10min');

SELECT cron.schedule(
  'alta-cliente-erp-10min',
  '7,17,27,37,47,57 * * * *',
  $cron$
  SELECT net.http_post(
    url     := 'https://sacecdkdmsdvgqnrsett.supabase.co/functions/v1/alta-cliente-erp',
    headers := jsonb_build_object(
                 'Content-Type','application/json',
                 'Authorization','Bearer ' || (SELECT decrypted_secret
                                               FROM vault.decrypted_secrets
                                               WHERE name='fiscal_invoke_secret')),
    body    := '{}'::jsonb,
    timeout_milliseconds := 150000
  );
  $cron$
);
