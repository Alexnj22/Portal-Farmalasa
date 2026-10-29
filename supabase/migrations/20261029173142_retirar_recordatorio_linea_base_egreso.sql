-- PENDIENTES 35. El recordatorio cumplió: `techo_exportacion` se decidió el
-- 2026-10-01 (no va techo; avisa el trigger export_log_avisar_descarga_grande),
-- así que la función devolvía 0 en cada corrida y ya no iba a avisar nunca.
SET lock_timeout = '5s';
SELECT cron.unschedule('recordar-linea-base-egreso-mensual')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'recordar-linea-base-egreso-mensual');
DROP FUNCTION IF EXISTS public.recordar_linea_base_de_egreso();
