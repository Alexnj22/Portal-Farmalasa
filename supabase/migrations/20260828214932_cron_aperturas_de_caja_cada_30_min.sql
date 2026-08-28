-- La captura del turno de caja, cada 30 minutos dentro de la ventana de sala.
--
-- POR QUÉ 30 MINUTOS Y NO MÁS SEGUIDO
-- La hora de APERTURA que se guarda es exacta: la da el propio panel del
-- sistema, no el reloj de la corrida. Mirar cada minuto no la mejoraría en
-- nada. Lo único que gana precisión con una cadencia más alta es el CIERRE
-- —cuándo se dejó de ver la caja abierta— y para eso media hora alcanza,
-- porque el turno se cierra una vez al día. Son 19 peticiones por corrida
-- (un ingreso + tres por sala: cambiar de sala, la pantalla y el panel) × 34
-- corridas = 646 al día.
--
-- LA VENTANA VA EN LOS DOS LADOS, y no es redundancia inútil: acá acota el
-- disparo —fuera de estas horas no hay ninguna caja abierta que mirar— y la
-- función la vuelve a comprobar porque un `body.forzar` la saltea a propósito
-- para un repaso a mano. Las horas son UTC: 12-23 y 0-4 UTC son las 6:00 a las
-- 22:59 de El Salvador, el mismo rango que usan los otros syncs de caja.

SET lock_timeout = '5s';

SELECT cron.unschedule('aperturas-caja-30min')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'aperturas-caja-30min');

SELECT cron.schedule(
  'aperturas-caja-30min',
  '*/30 12-23,0-4 * * *',
  $$
  SELECT net.http_post(
    url     := 'https://sacecdkdmsdvgqnrsett.supabase.co/functions/v1/sync-aperturas-caja',
    body    := '{}'::jsonb,
    headers := jsonb_build_object(
                 'Content-Type','application/json',
                 'Authorization','Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='admin_invoke_secret')),
    timeout_milliseconds := 150000);
  $$
);
