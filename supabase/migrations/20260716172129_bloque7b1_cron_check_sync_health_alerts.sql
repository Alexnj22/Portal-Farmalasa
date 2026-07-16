SET lock_timeout = '5s';

SELECT cron.schedule(
  'check-sync-health-alerts-20min',
  '*/20 12-23,0-5 * * *',
  $$
  SELECT net.http_post(
    url     := 'https://sacecdkdmsdvgqnrsett.supabase.co/functions/v1/check-sync-health-alerts',
    body    := '{}'::jsonb,
    params  := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='admin_invoke_secret'),'x-cron-secret',(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='cron_invoke_secret')),
    timeout_milliseconds := 30000
  );
  $$
);
