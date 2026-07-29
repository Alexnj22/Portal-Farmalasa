-- Retención asimétrica de cron.job_run_details (auditoría 2026-07-29, P4)
--
-- CORRECCIÓN a la auditoría: el informe decía que esta tabla "no se purga".
-- Es falso — `purge-sync-logs-daily` ya la borraba a 14 días, y por eso el
-- historial arrancaba exactamente el 2026-07-15. Los 197 MB no eran crecimiento
-- sin control: eran el estado estable de esa retención.
--
-- Lo que sí está mal es el reparto. Medido hoy:
--
--   status      filas     texto (command + return_message)
--   succeeded   217,341   99 MB
--   failed          345   163 kB
--
-- O sea el 99.8% del espacio son corridas exitosas — ruido operativo — y los
-- fallos, que son exactamente lo que hace falta para diagnosticar los 275
-- errores de cron del hallazgo P2, ocupan 163 kB. Retenerlos 14 días borra la
-- evidencia justo cuando se necesita, y retener los éxitos 14 días cuesta
-- 197 MB sobre una base de 1,463 MB en una instancia de ~1 GB de RAM.
--
-- Retención nueva: éxitos 7 días, fallos 90 días. Cuesta ~1 MB y conserva tres
-- meses de diagnóstico en vez de dos semanas.
--
-- OJO: el DELETE marca las tuplas muertas pero NO devuelve los bytes al SO —
-- el espacio queda reutilizable para la propia tabla. Para recuperarlo de
-- verdad hace falta VACUUM FULL, que toma ACCESS EXCLUSIVE y va en la ventana
-- de 06:00-11:59 UTC (crons de sync inactivos: corren 12-23,0-5).

SET lock_timeout = '5s';

SELECT cron.schedule(
  'purge-sync-logs-daily',
  '10 6 * * *',
  $cron$
  DELETE FROM public.sync_log           WHERE ran_at     < now() - interval '90 days';
  DELETE FROM public.inventory_sync_log WHERE synced_at  < now() - interval '90 days';
  DELETE FROM public.email_sync_log     WHERE checked_at < now() - interval '90 days';
  DELETE FROM public.login_rate_limit   WHERE created_at < now() - interval '7 days';
  -- Corridas de cron: los éxitos son ruido, los fallos son el diagnóstico.
  DELETE FROM cron.job_run_details
   WHERE start_time < now() - interval '7 days' AND status = 'succeeded';
  DELETE FROM cron.job_run_details
   WHERE start_time < now() - interval '90 days';
  $cron$
);
