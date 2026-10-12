-- Horario de atención (2026-10-12, decisión del usuario): de 7:00 a 22:00 de
-- El Salvador, de la primera sucursal que abre a la última que cierra. Los
-- avisos inmediatos de la app (respuestas del chat, recetas, puntos) salían
-- sólo de 8:00 a 20:00: una respuesta de las 20:30 llegaba al día siguiente.
-- 13–03 UTC = 7:00–21:59 SV. Sólo si el cron existe (guarda de branch).
SET lock_timeout = '5s';
SELECT cron.alter_job(j.jobid, schedule := '* 13-23,0-3 * * *')
  FROM cron.job j WHERE j.jobname = 'avisos-clientes-minuto';
