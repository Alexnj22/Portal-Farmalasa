-- Compras: el sync de cada 10 minutos duerme de 00:00 a 06:00 SV, como los
-- demás syncs (2026-11-10, pedido del usuario: bajar consultas al origen).
--
-- Medido ese día sobre 30 días de `purchase_sync_log`: 0 compras nuevas entre
-- las 22:00 y las 07:00 SV (la primera del día, a las 7). Son 36 corridas ×
-- ~15 peticiones = ~540 al día que no traen nada. La primera corrida de la
-- mañana pide ayer+hoy, así que lo que se haya cargado de noche entra igual.
--
-- Antes de esto se desplegó `check-sync-health-alerts` con compras dentro de
-- la ventana nocturna (DUERMEN_DE_NOCHE): sin eso, a las 06:01 SV avisaría
-- «sin correr» todas las mañanas.
SET lock_timeout = '5s';

SELECT cron.alter_job(
  job_id   := (SELECT jobid FROM cron.job WHERE jobname = 'sync-purchases-10min'),
  schedule := '1-59/10 12-23,0-5 * * *'
)
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sync-purchases-10min');
