SET lock_timeout = '5s';

-- El programa vive en el portal desde el 2026-10-01 (puntos_arranque id 8).
-- Los dos crones viejos quedaron apagados por puntos_encender y apuntan a
-- edge functions que hablan con MySQL y se retiran hoy.
SELECT cron.unschedule('sync-puntos-1min')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sync-puntos-1min');
SELECT cron.unschedule('puntos-vencer-mensual')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'puntos-vencer-mensual');

-- La migración de saldos de la era MySQL (recibía el JSON de puntos-traer-saldos).
-- Reemplazada por puntos_migrar_historial; nadie la llama.
DROP FUNCTION IF EXISTS public.puntos_migrar(json, date, boolean);
