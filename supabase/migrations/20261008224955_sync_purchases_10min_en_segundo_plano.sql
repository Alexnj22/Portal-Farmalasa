-- El cron de compras pasa a modo background (2026-10-08).
-- El ERP tarda ~0.18 s por renglón; un día grande de Bodega (638 renglones en
-- la ventana ayer+hoy) llevó la corrida a más de 150 s, el límite de la
-- respuesta de una Edge Function, y las 7 sucursales quedaron sin log.
-- Con background la función contesta 202 y sigue con EdgeRuntime.waitUntil;
-- el rastro es purchase_sync_log, que ahora se escribe por sucursal.
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
      'background', true
    ),
    timeout_milliseconds := 85000
  );
  $cmd$
)
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sync-purchases-10min');
