-- Facturas de compra — cron diario (Fase 4). Mismo patrón que dte-resync-month-*
-- (x-cron-secret desde Vault, nunca hardcodeado). Con body:'{}' procesa TODAS las
-- cuentas activas — incluye la cuenta 2 (compraslasalud.sv), que aún no tiene
-- last_synced_date: el cron va a ir avanzando su backfill en lotes automáticamente
-- (gracias al presupuesto de tiempo + hasMore de la edge function) sin necesitar
-- una corrida manual aparte.
SET lock_timeout = '5s';

SELECT cron.schedule(
  'sync-purchase-emails-daily',
  '0 9 * * *', -- 3:00 AM El Salvador (UTC-6)
  $$
  SELECT net.http_post(
    url     := 'https://sacecdkdmsdvgqnrsett.supabase.co/functions/v1/sync-purchase-emails',
    body    := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='cron_invoke_secret')),
    timeout_milliseconds := 300000
  );
  $$
);

-- Registrado pero INACTIVO a propósito (decisión del usuario 2026-07-17): el
-- módulo aún no está terminado (falta Fase 5, UI). Reactivar con:
--   SELECT cron.alter_job((SELECT jobid FROM cron.job WHERE jobname = 'sync-purchase-emails-daily'), active := true);
SELECT cron.alter_job((SELECT jobid FROM cron.job WHERE jobname = 'sync-purchase-emails-daily'), active := false);
