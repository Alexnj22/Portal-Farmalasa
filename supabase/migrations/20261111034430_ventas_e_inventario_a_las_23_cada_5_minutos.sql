-- Ventas e inventario: a las 23 SV cada 5 minutos en vez de cada minuto
-- (2026-11-10, pedido del usuario: bajar las consultas al sistema de origen).
--
-- Medido ese día: en 60 días entraron 0 ventas en la hora 23 SV (31 en la 22),
-- y en 7 días de `inventory_sync_log` la hora 23 tuvo 0 lecturas con cambios
-- de 3.360. Cada corrida son 13 llamadas y ~27 peticiones (13 logins), así que
-- la hora cuesta 60 × 27 = 1.620 peticiones para no traer nada.
--
-- No se quita la hora entera, a propósito:
--   · el sync pide sólo «hoy»: una venta de las 23:30 que esta corrida no
--     viera quedaría esperando al repaso del mes (y el día 1 ni ése la ve);
--   · `check-sync-health-alerts` avisa con 15 minutos activos sin corridas y
--     su ventana nocturna arranca a las 00:00 SV: sin corridas a las 23,
--     mandaría «sin correr» todas las noches.
-- Cada 5 minutos más la de las 23:59 (la última del día, como antes) deja las
-- dos cosas como estaban: 13 corridas, ~1.270 peticiones menos por día.
--
-- La fila la despacha `cron_tick_minuto()` (está apagada a propósito y su
-- horario lo lee el tick), así que el freno va en el comando: `current_timestamp`
-- es el arranque de la transacción del tick, el mismo minuto que juzga el horario.
SET lock_timeout = '5s';

SELECT cron.alter_job(
  job_id  := (SELECT jobid FROM cron.job WHERE jobname = 'sync-dte-inv-all-1min'),
  command := $cmd$
WITH secreto AS (
  SELECT decrypted_secret AS s FROM vault.decrypted_secrets
  WHERE name = 'sync_invoke_secret'
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
FROM payloads p
-- A las 23 SV, sólo en los minutos múltiplos de 5 y el 59 (ver la migración
-- 2026-11-10 «ventas e inventario a las 23 cada 5 minutos»).
WHERE extract(hour FROM current_timestamp AT TIME ZONE 'America/El_Salvador') <> 23
   OR extract(minute FROM current_timestamp)::int % 5 = 0
   -- y en el último minuto del día, como antes: el sync pide sólo «hoy».
   OR extract(minute FROM current_timestamp)::int = 59;
  $cmd$
)
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sync-dte-inv-all-1min');
