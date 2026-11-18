SET lock_timeout = '5s';

-- El ensayo del cobro corre sólo en las dos franjas de más venta (usuario,
-- 2026-11-18: «cada minuto, pero sólo un tiempo, no todo el día»). Medido en
-- Salud 4 + Salud 1 sobre 14 días: el pico de la mañana es de 8 a 10 SV
-- (~290 ventas por hora) y el de la tarde de 18 a 20 SV (~340). De 8:00 a
-- 10:59 y de 18:00 a 20:59 SV = 14–16 y 0–2 UTC: 360 corridas en vez de 960.
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ensayo-cobro-caja') THEN
    PERFORM cron.alter_job(
      (SELECT jobid FROM cron.job WHERE jobname = 'ensayo-cobro-caja'),
      schedule := '* 0-2,14-16 * * *');
  ELSE
    RAISE NOTICE 'No existe el cron ensayo-cobro-caja: nada que cambiar.';
  END IF;
END
$do$;
