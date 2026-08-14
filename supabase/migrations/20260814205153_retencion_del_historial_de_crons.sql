SET lock_timeout = '5s';

-- Retención para el historial de los crons.
--
-- `cron.job_run_details` no la tenía y nadie la purga: 24,194 filas y **67 MB**
-- al 2026-08-14, con el ritmo subiendo de ~1,700 corridas diarias el 7-ago a
-- ~3,980 el 14-ago. Cada fila guarda el comando entero, por eso pesa tanto para
-- tan pocas filas.
--
-- Se agrega ahora porque la captura de cortes pasó a cada 30 segundos y sola
-- suma ~1,440 corridas más por día. Es además la regla 7 de la estructura de la
-- base —toda tabla de log define su retención desde el día 1— aplicada a una
-- tabla que vino con la extensión y por eso se saltó la regla.
--
-- Siete días: el historial de crons se mira para diagnosticar algo que pasó
-- hoy o ayer. Lo que importa a 30 días vive en `sync_log`, que tiene su propia
-- purga a 90.
SELECT cron.schedule('purge-cron-history-daily', '15 6 * * *', $job$
  DELETE FROM cron.job_run_details WHERE start_time < now() - interval '7 days';
$job$);
