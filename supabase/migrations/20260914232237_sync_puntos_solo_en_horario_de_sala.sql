SET lock_timeout = '5s';
-- sync-puntos-1min corría `* * * * *`, también de 00:00 a 05:59 SV, cuando no
-- hay ventas (medido 2026-09-14 sobre 30 días: la primera factura es de las
-- 06:xx y la última de las 22:xx). Cada corrida lee ~700 MB aunque no encuentre
-- nada. Se alinea con los demás syncs de ventas (`12-23,0-5` UTC = 06:00–23:59
-- SV): sigue siendo CADA MINUTO en horario de sala, que es la decisión del
-- usuario; la ventana de 7 días recoge cualquier venta tardía. Ver
-- docs/INCIDENTE-CAIDA-2026-09-14.md.
SELECT cron.alter_job(
  (SELECT jobid FROM cron.job WHERE jobname = 'sync-puntos-1min'),
  schedule := '* 12-23,0-5 * * *'
) WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sync-puntos-1min');  -- idempotente: en un entorno nuevo la tarea no existe (2026-09-23)
