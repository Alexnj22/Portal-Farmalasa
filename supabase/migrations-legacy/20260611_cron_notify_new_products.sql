-- Notificación diaria de productos nuevos al Jefe/a de Compras y Logistica.
-- 8am El Salvador (UTC-6 = 14:00 UTC), lunes a sábado. Domingos no dispara.
SELECT cron.schedule(
  'notify-new-products-daily',
  '0 14 * * 1-6',
  $$
  SELECT net.http_post(
    url     := 'https://sacecdkdmsdvgqnrsett.supabase.co/functions/v1/notify-new-products-daily',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer 4bc494d9478b36be66d41a59cd937ecc3ec7321eee3cd6695664cbc98e8e4e56"}'::jsonb,
    body    := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $$
);
