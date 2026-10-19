-- Un CCF que no entró a Hacienda se reenvía solo (2026-10-19).
--
-- Pedido del usuario: «si no se envía un CCF, reenvíalo automáticamente».
-- Hasta hoy el único reintento era la corrida de las 22:30: un CCF que fallaba
-- a las 8 am pasaba el día entero avisando sin que nadie lo mandara.
--
-- Cada 10 minutos de 7:00 a 21:59 SV (13–23 y 0–3 UTC). Se detiene antes de la
-- corrida de las 22:30, que cubre lo que quede: dos envíos a la vez usarían la
-- misma sesión del sistema de la caja. `regularizar-dte` con `tipo: 'CCF'` sólo
-- mira CCF sin sello con más de 5 minutos en el portal, respeta las salas en
-- pausa y la lista de excluidas, y sin nada pendiente no inicia sesión ni
-- escribe bitácora.

SET lock_timeout = '5s';

SELECT cron.unschedule('reenviar-ccf-10min')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'reenviar-ccf-10min');

SELECT cron.schedule('reenviar-ccf-10min', '*/10 13-23,0-3 * * *', $cmd$
  SELECT net.http_post(
    url     := 'https://sacecdkdmsdvgqnrsett.supabase.co/functions/v1/regularizar-dte',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'Authorization', 'Bearer ' || (SELECT decrypted_secret
                                                  FROM vault.decrypted_secrets
                                                 WHERE name = 'admin_invoke_secret')),
    body    := jsonb_build_object('alcance', 'todas', 'tipo', 'CCF'),
    timeout_milliseconds := 240000
  );
$cmd$);
