SET lock_timeout = '5s';

-- Vuelve la revisión de la caja cada minuto en las horas pico (usuario,
-- 2026-11-18: Salud 4 no usa el kiosco todavía; el ensayo tenía que seguir
-- como en Salud 1, leyendo las preventas que se hacen en la caja). De 8:00 a
-- 10:59 y de 18:00 a 20:59 SV (14–16 y 0–2 UTC). Convive con el ensayo al
-- enviar de `preventa-caja` y con `ensayo-cobro-comparar`.
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ensayo-cobro-caja') THEN
    PERFORM cron.unschedule('ensayo-cobro-caja');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'sync_invoke_secret') THEN
    RAISE NOTICE 'Sin sync_invoke_secret: no se programa el ensayo (entorno de pruebas).';
    RETURN;
  END IF;
  PERFORM cron.schedule(
    'ensayo-cobro-caja',
    '* 0-2,14-16 * * *',
    $cron$
    SELECT net.http_post(
      url     := 'https://sacecdkdmsdvgqnrsett.supabase.co/functions/v1/ensayo-cobro-caja',
      body    := '{}'::jsonb,
      headers := jsonb_build_object(
                   'Content-Type','application/json',
                   'Authorization','Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='sync_invoke_secret')),
      timeout_milliseconds := 120000);
    $cron$);
END
$do$;
