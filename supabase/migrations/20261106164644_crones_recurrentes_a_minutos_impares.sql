-- Los crons recurrentes dejan de arrancar en el mismo minuto (2026-11-06).
--
-- `gate:eficiencia` marcaba tres crons con «job startup timeout». No era un
-- error suyo: la base se congela por momentos (la instancia es chica; ver
-- docs/INCIDENTE-CAIDA-2026-09-14.md) y TODO lo que arranca en ese momento
-- falla junto. Los episodios de la última semana cayeron casi siempre en
-- minutos redondos (21:00, 21:15, 21:40, 22:00, 22:05 UTC): en el minuto :00
-- arrancaban 63 tareas distintas, en el :30 47, en el :20 37. Cada una abre su
-- conexión y hace su trabajo a la vez, sobre una instancia que ya va justa.
--
-- Se mueven a minutos impares los crons RECURRENTES (cada 2, 5, 10, 15, 20, 30
-- minutos y cada hora). La frecuencia no cambia: sólo el minuto. No se tocan los
-- avisos diarios que salen a una hora pactada con la gente (8:00 SV, etc.) ni
-- los de caja (cierre automático, aperturas), cuyo minuto es parte de la regla.
--
-- Sólo si existe y sólo si sigue con la cadencia vieja: un cron que alguien ya
-- movió a mano no se pisa, y en el branch de pruebas (sin crons) no hace nada.
SET lock_timeout = '5s';

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT j.jobid, v.nueva
             FROM (VALUES
    ('sync-purchases-10min', '*/10 * * * *', '1-59/10 * * * *'),
    ('sync-purchase-emails-daily', '*/10 * * * *', '2-59/10 * * * *'),
    ('continuar-envios', '*/10 * * * *', '3-59/10 * * * *'),
    ('reintentar-ingreso-pedido', '*/10 * * * *', '4-59/10 * * * *'),
    ('sync-products-10min', '*/10 * * * *', '6-59/10 * * * *'),
    ('compra-soltar-trabados', '*/10 * * * *', '7-59/10 * * * *'),
    ('reenviar-ccf-10min', '*/10 13-23,0-3 * * *', '8-59/10 13-23,0-3 * * *'),
    ('creditos-cada-10min', '*/10 13-23,0-4 * * *', '9-59/10 13-23,0-4 * * *'),
    ('puntos-vigilar-motor', '*/15 * * * *', '1-59/15 * * * *'),
    ('recetas-escalar-15min', '*/15 * * * *', '2-59/15 * * * *'),
    ('dist-vencer-reservas', '*/15 * * * *', '3-59/15 * * * *'),
    ('reservas-vencer-15min', '*/15 * * * *', '4-59/15 * * * *'),
    ('refresh-sales-daily-stats', '*/15 12-23,0-5 * * *', '6-59/15 12-23,0-5 * * *'),
    ('reservas-vigilar-15min', '*/15 13-23,0-3 * * *', '7-59/15 13-23,0-3 * * *'),
    ('traslados-propuestas-al-dia', '*/5 * * * *', '1-59/5 * * * *'),
    ('vigilar-reinicio-de-la-base', '*/5 * * * *', '2-59/5 * * * *'),
    ('vigilar-servicios', '*/5 * * * *', '3-59/5 * * * *'),
    ('avisos-diferidos-5min', '*/5 * * * *', '4-59/5 * * * *'),
    ('puntos-vigilar-irregularidades', '*/5 12-23,0-5 * * *', '1-59/5 12-23,0-5 * * *'),
    ('check-sales-alerts-5min', '*/5 12-23,0-5 * * *', '2-59/5 12-23,0-5 * * *'),
    ('check-sync-health-alerts-20min', '*/20 12-23,0-5 * * *', '3-59/20 12-23,0-5 * * *'),
    ('avisar-pedidos-sin-recibir', '*/30 12-23,0-5 * * *', '8-59/30 12-23,0-5 * * *'),
    ('avisar-bitacora-por-vencer-30min', '*/30 13-23,0-1 * * *', '9-59/30 13-23,0-1 * * *'),
    ('heal-dte-sync', '0 */2 * * *', '13 */2 * * *'),
    ('dte-resync-mes-hora', '0 12-23,0-5 * * *', '7 12-23,0-5 * * *'),
    ('barrer-traslados-recibidos', '0 12-23,0-3 * * *', '11 12-23,0-3 * * *'),
    ('impresion-vencer-2min', '*/2 * * * *', '1-59/2 * * * *')
           ) AS v(nombre, vieja, nueva)
             JOIN cron.job j ON j.jobname = v.nombre AND j.schedule = v.vieja
  LOOP
    PERFORM cron.alter_job(job_id := r.jobid, schedule := r.nueva);
  END LOOP;
END $$;
