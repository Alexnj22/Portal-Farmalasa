-- C4 (continuación) — Consolidar los 6 crons horarios de DTE en UNO.
--
-- Mismo patrón y misma razón que 20260729_c4_consolidar_crons_sync_1min.sql:
-- los 6 comparten el horario EXACTO '0 12-23,0-5 * * *', asi que pg_cron los
-- lanza a la vez y cada uno consume una conexion. Peor: caen en el minuto :00,
-- el mismo en que dispara el consolidado de cada minuto, asi que el pico real
-- al tope de cada hora era ~10 conexiones simultaneas.
--
-- Los 6 llaman a la MISMA edge function (sync-dte-sales) con el mismo rango
-- —del 1 del mes hasta AYER, que es el resync de arrastre— y solo cambia
-- branchId: 2, 4, 25, 27, 28, 29. Se consolidan igual: net.http_post es
-- asincrono (encola en net.http_request_queue y retorna), asi que los 6
-- encolados salen en una sesion con UNA conexion.
--
-- Nota: el rango NO se toca. Sigue siendo
--   fini = primer dia del mes en curso (hora El Salvador)
--   ffin = ayer
-- que es distinto del cron de cada minuto (ese sincroniza HOY).
--
-- ── ROLLBACK ────────────────────────────────────────────────────────────────
-- SELECT cron.unschedule('dte-resync-mes-hora'); y re-crear los 6 con schedule
-- '0 12-23,0-5 * * *', mismo body cambiando branchId:
--   dte-popular-hora 2 | dte-salud1-hora 4  | dte-salud2-hora 25
--   dte-salud3-hora 27 | dte-salud4-hora 28 | dte-salud5-hora 29
-- url .../functions/v1/sync-dte-sales, Authorization Bearer con el secreto
-- 'admin_invoke_secret' de Vault, timeout_milliseconds 60000.
-- ────────────────────────────────────────────────────────────────────────────

SET lock_timeout = '5s';

SELECT cron.unschedule('dte-popular-hora');
SELECT cron.unschedule('dte-salud1-hora');
SELECT cron.unschedule('dte-salud2-hora');
SELECT cron.unschedule('dte-salud3-hora');
SELECT cron.unschedule('dte-salud4-hora');
SELECT cron.unschedule('dte-salud5-hora');

SELECT cron.schedule(
  'dte-resync-mes-hora',
  '0 12-23,0-5 * * *',
  $cmd$
WITH secreto AS (
  SELECT decrypted_secret AS s FROM vault.decrypted_secrets
  WHERE name = 'admin_invoke_secret'
),
rango AS (
  SELECT to_char(DATE_TRUNC('month', (current_timestamp AT TIME ZONE 'America/El_Salvador')::date), 'YYYY-MM-DD') AS fini,
         to_char((current_timestamp AT TIME ZONE 'America/El_Salvador')::date - 1, 'YYYY-MM-DD') AS ffin
)
SELECT net.http_post(
  url     := 'https://sacecdkdmsdvgqnrsett.supabase.co/functions/v1/sync-dte-sales',
  body    := jsonb_build_object('branchId', b,
                                'fini', (SELECT fini FROM rango),
                                'ffin', (SELECT ffin FROM rango)),
  params  := '{}'::jsonb,
  headers := jsonb_build_object('Content-Type','application/json',
             'Authorization','Bearer ' || (SELECT s FROM secreto)),
  timeout_milliseconds := 60000)
FROM unnest(ARRAY[2,4,25,27,28,29]) AS b;
  $cmd$
);
