-- C4 hallazgo 1 — Consolidar los 13 crons de sync por minuto en UNO solo.
--
-- Problema medido: los 13 jobs compartian el horario EXACTO '* 12-23,0-5 * * *',
-- sin desfase, y cron.max_running_jobs=32, asi que pg_cron lanzaba los 13 a la
-- vez. Cada job de pg_cron es un background worker con su propia conexion, o sea
-- 13 slots consumidos en el mismo instante. Con max_connections=60 y 52 ya en uso
-- (42 de ellas IDLE: Storage API retiene 15, PostgREST 13), los ~8 libres se
-- agotaban y el que llegaba tarde recibia:
--   FATAL: remaining connection slots are reserved for roles with the SUPERUSER attribute
-- Esa es la causa medida de los 375 fallos de cron ("connection failed" /
-- "job startup timeout") sobre 108,895 corridas.
--
-- Por que consolidar funciona: net.http_post es ASINCRONO — encola en
-- net.http_request_queue y retorna al instante; el worker de pg_net hace el HTTP
-- despues. Trece llamadas en una sesion son trece inserts (microsegundos), con
-- UNA conexion en vez de 13. La frecuencia no cambia: los 13 syncs siguen
-- corriendo cada minuto, con su timeout de 55s por request.
--
-- Costo aceptado: se pierde granularidad en cron.job_run_details (13 filas → 1).
-- El detalle por sucursal sigue en los logs de la edge function y en sync_log.
--
-- Nota: estos crons desaparecen cuando el portal reemplace al ERP. Esto es un
-- arreglo interino para el techo de conexiones, no arquitectura definitiva.
--
-- ── ROLLBACK ────────────────────────────────────────────────────────────────
-- Para volver atras: SELECT cron.unschedule('sync-dte-inv-all-1min'); y despues
-- re-crear los 13 con su schedule original '* 12-23,0-5 * * *':
--   dte-popular-min      branchId 2     | sync-inv-suc1-1min  onlyInvErpId 1
--   dte-salud1-min       branchId 4     | sync-inv-suc2-1min  onlyInvErpId 2
--   dte-salud2-min       branchId 25    | sync-inv-suc3-1min  onlyInvErpId 3
--   dte-salud3-min       branchId 27    | sync-inv-suc4-1min  onlyInvErpId 4
--   dte-salud4-min       branchId 28    | sync-inv-suc5-1min  onlyInvErpId 5
--   dte-salud5-min       branchId 29    | sync-inv-suc6-1min  onlyInvErpId 6
--                                       | sync-inv-suc7-1min  onlyInvErpId 7
-- Los de DTE usan body jsonb_build_object('branchId',N,'fini',<hoy>,'ffin',<hoy>);
-- los de inventario '{"syncInventory":true,"skipDte":true,"onlyInvErpId":N}'.
-- Todos: url .../functions/v1/sync-dte-sales, Authorization Bearer con el secreto
-- 'admin_invoke_secret' de Vault, timeout_milliseconds 55000.
-- ────────────────────────────────────────────────────────────────────────────

SET lock_timeout = '5s';

SELECT cron.unschedule('dte-popular-min');
SELECT cron.unschedule('dte-salud1-min');
SELECT cron.unschedule('dte-salud2-min');
SELECT cron.unschedule('dte-salud3-min');
SELECT cron.unschedule('dte-salud4-min');
SELECT cron.unschedule('dte-salud5-min');
SELECT cron.unschedule('sync-inv-suc1-1min');
SELECT cron.unschedule('sync-inv-suc2-1min');
SELECT cron.unschedule('sync-inv-suc3-1min');
SELECT cron.unschedule('sync-inv-suc4-1min');
SELECT cron.unschedule('sync-inv-suc5-1min');
SELECT cron.unschedule('sync-inv-suc6-1min');
SELECT cron.unschedule('sync-inv-suc7-1min');

SELECT cron.schedule(
  'sync-dte-inv-all-1min',
  '* 12-23,0-5 * * *',
  $cmd$
WITH secreto AS (
  SELECT decrypted_secret AS s FROM vault.decrypted_secrets
  WHERE name = 'admin_invoke_secret'
),
hoy AS (
  SELECT to_char((current_timestamp AT TIME ZONE 'America/El_Salvador')::date,
                 'YYYY-MM-DD') AS d
),
payloads AS (
  SELECT jsonb_build_object('branchId', b,
                            'fini', (SELECT d FROM hoy),
                            'ffin', (SELECT d FROM hoy)) AS body
    FROM unnest(ARRAY[2,4,25,27,28,29]) AS b
  UNION ALL
  SELECT jsonb_build_object('syncInventory', true, 'skipDte', true,
                            'onlyInvErpId', i)
    FROM unnest(ARRAY[1,2,3,4,5,6,7]) AS i
)
SELECT net.http_post(
  url     := 'https://sacecdkdmsdvgqnrsett.supabase.co/functions/v1/sync-dte-sales',
  body    := p.body,
  params  := '{}'::jsonb,
  headers := jsonb_build_object('Content-Type','application/json',
             'Authorization','Bearer ' || (SELECT s FROM secreto)),
  timeout_milliseconds := 55000)
FROM payloads p;
  $cmd$
);
