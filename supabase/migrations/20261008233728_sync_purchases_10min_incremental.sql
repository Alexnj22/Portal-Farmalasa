-- El cron de compras pasa a modo incremental (2026-10-08).
-- Cada 10 min se pide la LISTA barata de compras (sin renglones) y sólo los
-- días con una compra nueva bajan el reporte pesado: medido, 1.8 s las 7
-- sucursales contra ~112 s de la pasada completa. En el minuto 0 de cada hora
-- va la pasada completa, que recoge lo que la lista no ve (un renglón
-- corregido en una compra que ya existía).
SET lock_timeout = '5s';

SELECT cron.alter_job(
  job_id  := (SELECT jobid FROM cron.job WHERE jobname = 'sync-purchases-10min'),
  command := $cmd$
  SELECT net.http_post(
    url     := 'https://sacecdkdmsdvgqnrsett.supabase.co/functions/v1/sync-erp-purchases',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='admin_invoke_secret')),
    body    := jsonb_build_object(
      'fini', to_char((current_timestamp AT TIME ZONE 'America/El_Salvador')::date - 1, 'YYYY-MM-DD'),
      'ffin', to_char((current_timestamp AT TIME ZONE 'America/El_Salvador')::date,     'YYYY-MM-DD'),
      'background', true,
      'incremental', extract(minute FROM current_timestamp) >= 10
    ),
    timeout_milliseconds := 85000
  );
  $cmd$
)
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sync-purchases-10min');
