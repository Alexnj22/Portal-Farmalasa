-- El número de control de las ventas con inyección, a los pocos minutos de la
-- venta (2026-11-10). La caja busca la venta de otra sala por el número de
-- control del ticket, y ese dato no viene con la venta: lo trae
-- `sync-numero-control` de a un documento. El cron diario de los libros corre
-- a la 1:00 SV, así que una venta de hoy no se encontraba hasta mañana.
--
-- Cada 10 min en horario de sala (12-23,0-5 UTC, como los demás syncs). Sin
-- pendientes, la corrida no sale a ningún lado: ~73 ventas con inyección por
-- día reparten menos de una petición por corrida. `alertar: false`: si el
-- endpoint se cae, lo avisa el cron de los libros, que mira lo mismo.
SET lock_timeout = '5s';

SELECT cron.schedule(
  'sync-numero-control-inyecciones',
  '4-59/10 12-23,0-5 * * *',
  $cron$
  SELECT net.http_post(
    url     := 'https://sacecdkdmsdvgqnrsett.supabase.co/functions/v1/sync-numero-control',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='sync_invoke_secret')),
    body    := jsonb_build_object('alcance','inyecciones','limit', 100, 'maxMs', 50000, 'concurrencia', 4, 'alertar', false),
    timeout_milliseconds := 60000
  );
  $cron$
);
