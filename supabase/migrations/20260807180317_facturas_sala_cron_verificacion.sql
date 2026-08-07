-- Facturas de mi Sala — el cron que cierra el circuito.
--
-- Tomar la factura no es el objetivo: registrar la compra lo es. `sync-purchases-10min`
-- trae las compras del sistema cada 10 minutos, así que cada dos horas hay dato
-- nuevo que cruzar. Se corre desfasado (:40) para no coincidir con el sync.
--
-- Dos horas y no cada 10 minutos: esto es una conciliación de fondo, no un
-- acuse de recibo. Y no es un cron diario porque la sala ve el resultado en su
-- propia lista («Tuya · ya cargada») y esperar hasta mañana para eso es tarde.

SET lock_timeout = '5s';

SELECT cron.schedule(
    'verificar-facturas-reclamadas-2h',
    '40 */2 * * *',
    $$ SELECT public.verificar_facturas_reclamadas(); $$
);
