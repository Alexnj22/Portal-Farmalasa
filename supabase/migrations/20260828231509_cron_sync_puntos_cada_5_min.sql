-- Cada 5 minutos, la misma cadencia que tenía el disparador de la hoja de
-- cálculo. No es una elección estética: el cliente puede presentar el ticket en
-- el mostrador poco después de comprar, y si la venta todavía no llegó, no se
-- le pueden dar sus puntos. Bajarla a 10 o 15 minutos ahorraría poco y crearía
-- una ventana en la que un ticket recién emitido «no existe».
--
-- Cuesta 1 llamada por corrida (288/día) más una conexión a la base de puntos.
-- El secreto sale de Vault y no se escribe en `cron.job.command`.
--
-- ⚠️ Este cron vivió MINUTOS: lo reemplaza `20260828231830_cron_sync_puntos_cada_minuto`
-- porque el usuario pidió la cadencia de un minuto y la medición la habilitó
-- (34 ms por corrida en régimen). Queda archivado igual: una migración aplicada
-- en producción se archiva aunque la siguiente la deshaga — si no, la historia
-- del repo deja de ser un prefijo de la del servidor.
SELECT cron.schedule(
  'sync-puntos-5min',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url     := 'https://sacecdkdmsdvgqnrsett.supabase.co/functions/v1/sync-puntos',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='admin_invoke_secret')),
    body    := '{}'::jsonb,
    timeout_milliseconds := 170000
  );
  $$
);
