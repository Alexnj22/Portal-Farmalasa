-- Cron mensual: recalcula MIN/MAX para todas las sucursales el día 1 de cada mes
-- a las 9:00 AM (El Salvador, UTC-6) = 15:00 UTC.
-- Al terminar, la edge function notifica al Supervisor de Ventas disponible
-- (o su jefe inmediato si está de vacaciones/incapacidad/permiso ese día).
SELECT cron.schedule(
  'auto-calculate-minmax-monthly',
  '0 15 1 * *',
  $$
  SELECT net.http_post(
    url     := 'https://sacecdkdmsdvgqnrsett.supabase.co/functions/v1/auto-calculate-minmax',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer 4bc494d9478b36be66d41a59cd937ecc3ec7321eee3cd6695664cbc98e8e4e56"}'::jsonb,
    body    := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);
