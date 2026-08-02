SET lock_timeout = '5s';

-- Cuadre diario de VENTAS contra el origen. Es el que faltaba: compras ya tenía
-- el suyo (check-purchases-reconciliation, 07:20) desde v2.326.0 y ventas no.
--
-- Existe por un caso real: al portal le faltaba una venta de $45.98 en la
-- sucursal 4 del 2026-06-20 y el libro cuadraba CONSIGO MISMO — sin error, sin
-- hueco visible, simplemente un documento menos. Sólo apareció comparando
-- contra afuera.
--
-- 07:30 UTC, después del número de control (07:00) y del cuadre de compras
-- (07:20). Cubre mes en curso + anterior excluyendo hoy, que aún se sincroniza.
SELECT cron.schedule(
  'check-sales-reconciliation-daily',
  '30 7 * * *',
  $cron$
  SELECT net.http_post(
    url     := 'https://sacecdkdmsdvgqnrsett.supabase.co/functions/v1/check-sales-reconciliation',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='admin_invoke_secret')),
    body    := '{}'::jsonb,
    timeout_milliseconds := 200000
  );
  $cron$
);
