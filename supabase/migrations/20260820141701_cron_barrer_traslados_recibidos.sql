SET lock_timeout = '5s';

-- Cada media hora, en horario de sala, el portal se pregunta si alguna de sus
-- tarjetas «Ya llegó, recibir» ya no tiene nada que esperar.
--
-- Media hora y no cada minuto a propósito: el producto de una tarjeta fantasma
-- YA está en la sala —no hay nada trabado—, así que lo único que se gana yendo
-- más rápido es limpiar antes una tarjeta que confunde. Y cada corrida abre una
-- sesión del sistema por sala con tarjetas abiertas; medido el 2026-08-20:
-- 1,3 a 1,8 s las 18 tarjetas de las 6 salas.
--
-- `simulacro: false` es explícito porque la función sale en simulacro por
-- omisión: cerrar solicitudes de otras salas no puede ser el valor por defecto.
SELECT cron.schedule(
    'barrer-traslados-recibidos',
    '*/30 12-23,0-3 * * *',
    $$
    SELECT net.http_post(
        url     := 'https://sacecdkdmsdvgqnrsett.supabase.co/functions/v1/barrer-traslados-recibidos',
        headers := jsonb_build_object(
                     'Content-Type', 'application/json',
                     'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets
                                                     WHERE name = 'admin_invoke_secret')),
        body    := jsonb_build_object('simulacro', false, 'minutos', 15),
        timeout_milliseconds := 10000
    );
    $$
);
