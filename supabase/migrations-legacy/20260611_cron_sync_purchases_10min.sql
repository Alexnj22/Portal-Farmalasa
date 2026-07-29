-- Cambia sync de compras de diario a cada 10 minutos.
-- Rango: ayer + hoy para capturar ingresos tardíos sin sobrecargar el ERP.
SELECT cron.unschedule('sync-purchases-daily');

SELECT cron.schedule(
  'sync-purchases-10min',
  '*/10 * * * *',
  $$
  SELECT net.http_post(
    url     := 'https://sacecdkdmsdvgqnrsett.supabase.co/functions/v1/sync-erp-purchases',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer 4bc494d9478b36be66d41a59cd937ecc3ec7321eee3cd6695664cbc98e8e4e56"}'::jsonb,
    body    := jsonb_build_object(
      'fini', to_char((current_timestamp AT TIME ZONE 'America/El_Salvador')::date - 1, 'YYYY-MM-DD'),
      'ffin', to_char((current_timestamp AT TIME ZONE 'America/El_Salvador')::date,     'YYYY-MM-DD')
    ),
    timeout_milliseconds := 85000
  );
  $$
);
