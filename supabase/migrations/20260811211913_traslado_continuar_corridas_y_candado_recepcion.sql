SET lock_timeout = '5s';

-- `recibiendo` es el candado de la recepción, igual que `enviando` lo es del
-- despacho: dos personas de la sala confirmando la misma hoja a la vez pasan
-- las dos la lectura, y recibir dos veces DUPLICA la existencia.
ALTER TABLE public.pedido_traslado_linea DROP CONSTRAINT IF EXISTS pedido_traslado_linea_estado_check;
ALTER TABLE public.pedido_traslado_linea ADD CONSTRAINT pedido_traslado_linea_estado_check
    CHECK (estado IN ('planificada', 'enviando', 'enviada', 'recibiendo', 'recibida', 'error', 'omitida'));

-- ── Quién retoma una corrida cortada ────────────────────────────────────────
-- Hasta acá la maquinaria de reanudación existía y NADIE la llamaba: el portal
-- invoca el despacho una sola vez, al finalizar. Si el presupuesto se agotaba
-- con productos pendientes, la corrida quedaba 'en_curso' para siempre y el
-- pedido a medio despachar **en silencio** — que es exactamente el escenario
-- peligroso cuando se mueve inventario.
--
-- El umbral de 5 minutos no es decorativo: una corrida vive como mucho 240 s, y
-- el `updated_at` se refresca al empezar (al adoptarla) y al terminar. Con 5
-- minutos es seguro que la anterior ya murió, así que **nunca hay dos workers
-- despachando el mismo pedido a la vez** — y eso importa porque el id del
-- traslado nuevo se deduce comparando la lista de pendientes antes y después:
-- con dos escribiendo, esa deducción le pone a una línea el id de la otra.
--
-- El tope de 3 por corrida evita que un atasco dispare decenas de invocaciones.
SELECT cron.schedule(
    'continuar-traslados-pedido',
    '* * * * *',
    $cron$
    SELECT net.http_post(
        url     := 'https://sacecdkdmsdvgqnrsett.supabase.co/functions/v1/trasladar-pedido-erp',
        headers := jsonb_build_object(
                     'Content-Type', 'application/json',
                     'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets
                                                     WHERE name = 'admin_invoke_secret')),
        body    := jsonb_build_object('run_id', t.id),
        timeout_milliseconds := 5000
    )
    FROM (
        SELECT id FROM public.pedido_traslado_erp
        WHERE modo = 'real' AND paso = 'enviar' AND estado = 'en_curso'
          AND updated_at < now() - interval '5 minutes'
        ORDER BY updated_at
        LIMIT 3
    ) t;
    $cron$
);
