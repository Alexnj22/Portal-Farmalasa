SET lock_timeout = '5s';

-- El ensayo del cobro se hace AL ENVIAR la preventa, no revisando la caja cada
-- minuto (usuario, 2026-11-18: «la guardan, van a caja en el mismo momento y
-- luego la finalizan de un solo»). La preventa vive segundos en la caja: el
-- barrido de cada minuto casi nunca la veía. Ahora `preventa-caja` la ensaya
-- justo después de mandarla, cuando seguro existe, y este cron sólo COMPARA:
-- es SQL puro y no le pide nada a la caja.
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ensayo-cobro-caja') THEN
    PERFORM cron.unschedule('ensayo-cobro-caja');
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ensayo-cobro-comparar') THEN
    PERFORM cron.unschedule('ensayo-cobro-comparar');
  END IF;
  PERFORM cron.schedule('ensayo-cobro-comparar', '*/10 * * * *', 'SELECT public.cobro_caja_ensayo_comparar()');
END
$do$;
