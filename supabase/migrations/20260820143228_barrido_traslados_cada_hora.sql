SET lock_timeout = '5s';

-- El barrido pasa a CADA HORA, no cada media.
--
-- Nació cada 30 min y el mismo día se midió lo que cuesta: entrar al sistema
-- son 488 ms y cambiar de sala 263 (más 157 de leer la cola), o sea que una
-- corrida son ~14 viajes desde que reusa una sola sesión. A la media hora eran
-- ~600 pedidos por día; a la hora son ~220.
--
-- Y sobre todo cambió QUÉ le queda por cubrir. El caso «el portal recibió, el
-- sistema cargó y contestó un fallo» ahora se resuelve donde ocurre: las tres
-- funciones que despachan y reciben le vuelven a preguntar al sistema antes de
-- dar el fallo por bueno. Lo que sólo puede ver un barrido es el otro caso —que
-- alguien reciba el traslado a mano en el sistema—, y ahí el producto YA está
-- en la sala: no hay nada trabado, sólo una tarjeta que confunde. Para eso, una
-- hora de atraso máximo sobra.
SELECT cron.schedule(
    'barrer-traslados-recibidos',
    '0 12-23,0-3 * * *',
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
