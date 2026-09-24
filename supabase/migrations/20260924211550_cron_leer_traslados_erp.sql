SET lock_timeout = '5s';

-- Cada hora, 6 am a 9 pm SV: anota los traslados nuevos del sistema de la
-- caja en `traslados_erp_linea` (ver `leer-traslados-erp`). Es lo que le dice
-- al aviso de productos sin venta cuándo ENTRÓ cada producto a cada sala.
--
-- Costo: un ingreso, dos cambios de sala y dos páginas para la tabla de
-- direcciones, más una lectura por traslado nuevo y 25 de cierre (números que
-- todavía no existen). Con ~350 traslados al día son ~50 lecturas por corrida.
-- Cada hora alcanza de sobra: el reloj que alimenta es de seis meses.
SELECT cron.schedule(
    'leer-traslados-erp',
    '20 12-23,0-3 * * *',
    $$
    SELECT net.http_post(
        url     := 'https://sacecdkdmsdvgqnrsett.supabase.co/functions/v1/leer-traslados-erp',
        headers := jsonb_build_object(
                     'Content-Type', 'application/json',
                     'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets
                                                     WHERE name = 'admin_invoke_secret')),
        body    := '{}'::jsonb,
        timeout_milliseconds := 10000
    );
    $$
);
