-- `dist-vencer-reservas` corría cada minuto sobre una tabla casi siempre
-- vacía. Quien lee `dist_reservas` ya filtra `vence_at > now()`, así que la
-- existencia libre no depende del cron: él sólo borra lo vencido y avisa al
-- vendedor, y eso tolera hasta 15 minutos (auditoría 2026-10-21, punto 8).
-- Guarda: sólo si el cron existe (un branch nuevo puede no tenerlo).
SET lock_timeout = '5s';
SELECT cron.alter_job(j.jobid, schedule := '*/15 * * * *')
  FROM cron.job j
 WHERE j.jobname = 'dist-vencer-reservas'
   AND EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'dist-vencer-reservas');
