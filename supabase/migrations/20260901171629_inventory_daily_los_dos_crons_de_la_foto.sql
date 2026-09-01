-- Los dos crons de la foto diaria de existencias.
--
-- HORARIO. 07:45 UTC son las 01:45 de El Salvador: la sala cerro hace horas y
-- todavia no abrio, asi que la foto describe un dia terminado y no uno a medias.
-- Cae ademas en la ventana tranquila (06:00-11:59 UTC), donde los syncs de
-- ventas e inventario no corren — la regla de CLAUDE.md sobre tablas calientes.
-- El minuto 45 estaba libre: a las :00, :20 y :30 de esa hora ya hay crons.
--
-- El mantenedor de particiones corre el dia 1 a las 06:05 UTC, ANTES que
-- cualquier foto del mes nuevo, para que nunca falte donde escribir. Adelanta
-- tres meses, asi que aunque falle dos veces seguidas la escritura sigue
-- teniendo destino.
--
-- Los dos llaman SQL directo, no una edge function: no hay JWT que se pueda
-- resetear en un redeploy ni peticion saliente que pueda dar 401.

SET lock_timeout = '5s';

SELECT cron.unschedule('inventory-daily-snapshot')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'inventory-daily-snapshot');

SELECT cron.unschedule('inventory-daily-particiones')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'inventory-daily-particiones');

SELECT cron.schedule(
  'inventory-daily-snapshot',
  '45 7 * * *',
  $cron$SELECT public.inventory_daily_snapshot()$cron$
);

SELECT cron.schedule(
  'inventory-daily-particiones',
  '5 6 1 * *',
  $cron$SELECT public.inventory_daily_mantener_particiones()$cron$
);
