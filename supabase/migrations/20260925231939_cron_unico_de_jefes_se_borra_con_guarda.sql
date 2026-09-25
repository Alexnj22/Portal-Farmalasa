-- El cron de una sola vez se borra a sí mismo al terminar; `cron.unschedule`
-- lanza si el trabajo no existe, así que va con la guarda de siempre.
SET lock_timeout = '5s';
SELECT cron.alter_job(
  (SELECT jobid FROM cron.job WHERE jobname = 'diferencias-pendientes-jefes-2026-09-26'),
  command := $cron$SELECT public.avisar_diferencias_pendientes_a_jefes(); SELECT cron.unschedule('diferencias-pendientes-jefes-2026-09-26') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'diferencias-pendientes-jefes-2026-09-26');$cron$
)
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'diferencias-pendientes-jefes-2026-09-26');
