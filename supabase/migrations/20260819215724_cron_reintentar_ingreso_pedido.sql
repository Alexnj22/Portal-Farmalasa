SET lock_timeout = '5s';

-- La recepción del pedido se retoma sola, como ya lo hacía el despacho.
--
-- Cada 10 minutos busca recepciones que quedaron a medias —la sala contó el
-- renglón y el traslado nunca entró al inventario— y le pide a la función que
-- las termine. El cron dice QUÉ (pedido, sucursal) mirar; QUÉ recibir lo
-- decide la función leyendo `items_sin_ingresar`, así que un renglón que nadie
-- contó no puede entrar por acá.
--
-- Cada 10 y no cada minuto porque `recepciones_por_reintentar(10)` ya exige que
-- la sala haya confirmado hace 10 minutos: apurarlo sólo serviría para empujar
-- desde atrás una recepción que está corriendo bien. El tope de 3 llamadas es
-- el mismo del cron del despacho — un barrido no puede convertirse en una
-- avalancha contra el sistema de origen.
SELECT cron.schedule(
  'reintentar-ingreso-pedido',
  '*/10 * * * *',
  $cron$
    SELECT net.http_post(
        url     := 'https://sacecdkdmsdvgqnrsett.supabase.co/functions/v1/trasladar-pedido-erp',
        headers := jsonb_build_object(
                     'Content-Type', 'application/json',
                     'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets
                                                     WHERE name = 'admin_invoke_secret')),
        body    := jsonb_build_object(
                     'accion', 'recibir',
                     'pedido_id', r.pedido_id,
                     'erp_sucursal_id', r.erp_sucursal_id),
        timeout_milliseconds := 5000
    )
    FROM (
        SELECT pedido_id, erp_sucursal_id
        FROM public.recepciones_por_reintentar(10)
        ORDER BY pedido_id
        LIMIT 3
    ) r;
  $cron$
);
