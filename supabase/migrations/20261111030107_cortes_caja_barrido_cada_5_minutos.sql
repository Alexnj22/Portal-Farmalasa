-- Cortes de caja: el barrido pasa de cada 30 segundos a cada 5 minutos
-- (2026-11-10, pedido del usuario: bajar las consultas al sistema de origen en
-- vez de subir el tope).
--
-- Por qué ya no hace falta cada 30 s: el corte se hace DESDE EL PORTAL.
-- Medido el 2026-11-10 sobre 6 semanas: 1,361 de 1,363 cortes están en
-- `caja_cortes_del_portal`, y los otros 2 son Z del cierre automático, que
-- también pasa por `hacer-corte-caja`. Esa función ya le pide a
-- `sync-cortes-caja` que traiga la sala apenas se hace el corte (branchId +
-- desde), así que quien corta ve su corte en segundos sin depender del reloj.
-- El barrido queda como red para el corte hecho directo en el sistema de la
-- caja, que aparecería en 5 minutos como mucho.
--
-- Costo: 192 corridas × 6 listados + movimientos cada 5 min ≈ 2,300 peticiones
-- al día, contra 12,672 (6.6 × 1,920). La ventana es la de siempre, 7:00–22:55
-- SV (13–04 UTC); la función además la vuelve a mirar.
SET lock_timeout = '5s';

SELECT cron.unschedule('cortes-caja-30s')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cortes-caja-30s');

SELECT cron.schedule(
  'cortes-caja-5min',
  '*/5 13-23,0-4 * * *',
  $cron$
  SELECT net.http_post(
    url     := 'https://sacecdkdmsdvgqnrsett.supabase.co/functions/v1/sync-cortes-caja',
    body    := '{}'::jsonb,
    headers := jsonb_build_object(
                 'Content-Type','application/json',
                 'Authorization','Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='sync_invoke_secret')),
    timeout_milliseconds := 150000);
  $cron$
);
