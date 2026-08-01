SET lock_timeout = '5s';

-- El número de control se completa solo, todos los días.
--
-- Son ~16 documentos diarios contra 726 ventas: al libro solo le hacen falta
-- los CCF, los anulados y la primera y última venta de cada sucursal-día. A
-- ~1.3s por documento con 8 en paralelo, eso son unos 4 segundos de trabajo.
--
-- El `limit` de 400 no es para el día normal sino para recuperarse: si el
-- origen estuvo caído una semana, la corrida siguiente se pone al día sola en
-- vez de quedar 16 documentos por detrás para siempre.
--
-- 07:00 UTC = 01:00 en El Salvador. El día ya cerró —así que la primera y la
-- última venta de cada sucursal ya son definitivas— y todavía no arrancan los
-- syncs de las 12:00. Es el mismo hueco donde ya corre la reconciliación de
-- compras (07:20).
SELECT cron.schedule(
  'sync-numero-control-daily',
  '0 7 * * *',
  $cron$
  SELECT net.http_post(
    url     := 'https://sacecdkdmsdvgqnrsett.supabase.co/functions/v1/sync-numero-control',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='admin_invoke_secret')),
    body    := jsonb_build_object('limit', 400, 'maxMs', 105000, 'concurrencia', 8),
    timeout_milliseconds := 115000
  );
  $cron$
);
