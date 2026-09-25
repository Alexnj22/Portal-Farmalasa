SET lock_timeout = '5s';

-- ═══ El arranque de los puntos: 1-oct-2026, 02:00 y 02:10 hora de El Salvador ═══
-- Decisión del usuario (2026-09-25): esa madrugada se copia la base de puntos
-- anterior y se migra su historial al libro del portal; desde ahí MySQL no se
-- usa más. Ensayado el mismo día contra los datos reales (ver
-- docs/PLAN-PUNTOS-EN-SUPABASE-2026-09-01.md §12).
--
--   08:00 UTC  puntos-archivar-arranque  copia la base anterior (< 1 min medido)
--   08:10 UTC  puntos-arranque-1oct      migra, cuadra y SÓLO si cuadra enciende
--
-- Diez minutos de separación y no una cadena: si la copia falla, el arranque
-- encuentra la copia vieja (la del ensayo), la rechaza por no ser de la última
-- hora y avisa sin encender nada.
--
-- `puntos_encender` borra los dos al terminar. Si el arranque falla no se
-- borran, y por eso cada uno lleva además la guarda `current_date = 2026-10-01`:
-- el cron es anual por construcción (`* * 1 10 *`) y sin la guarda volvería a
-- disparar el 1-oct-2027.
--
-- Se crean «sólo si no existen» y se quitan «sólo si existen» (regla de
-- CLAUDE.md): un branch nuevo que replaya esto no puede romperse.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'puntos-archivar-arranque') THEN
    PERFORM cron.unschedule('puntos-archivar-arranque');
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'puntos-arranque-1oct') THEN
    PERFORM cron.unschedule('puntos-arranque-1oct');
  END IF;
END $$;

SELECT cron.schedule('puntos-archivar-arranque', '0 8 1 10 *', $c$
  SELECT net.http_post(
    url     := 'https://sacecdkdmsdvgqnrsett.supabase.co/functions/v1/puntos-archivar',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='admin_invoke_secret')),
    body    := '{}'::jsonb,
    timeout_milliseconds := 300000
  ) WHERE current_date = DATE '2026-10-01';
$c$);

SELECT cron.schedule('puntos-arranque-1oct', '10 8 1 10 *', $c$
  SELECT net.http_post(
    url     := 'https://sacecdkdmsdvgqnrsett.supabase.co/functions/v1/puntos-arranque',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='admin_invoke_secret')),
    body    := '{"simular": false}'::jsonb,
    timeout_milliseconds := 300000
  ) WHERE current_date = DATE '2026-10-01';
$c$);
