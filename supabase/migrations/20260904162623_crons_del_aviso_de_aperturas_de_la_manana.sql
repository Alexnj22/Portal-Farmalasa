SET lock_timeout = '5s';

-- ═══════════════════════════════════════════════════════════════════════════
-- Los disparos del aviso de la mañana.
--
-- Cada 5 minutos entre las 6:50 y las 7:20 de El Salvador (12:50–13:20 UTC),
-- más un repaso a las 7:35. Son DOS jobs y no uno porque la ventana cruza la
-- hora en punto y `pg_cron` no admite dos horas en una sola expresión sin
-- barrerlas enteras.
--
-- ── Por qué cada 5 minutos y no cada 30 ────────────────────────────────────
-- La captura normal (`aperturas-caja-30min`) sigue como estaba y alcanza para
-- el historial: la hora de apertura que guarda es EXACTA, la da el panel. Lo
-- que no alcanza es para DECIDIR a las 7:20 quién no abrió. Medido el
-- 2026-09-04: Salud 2 abrió 7:05 y Salud 3 a las 7:10, y sus filas nacieron a
-- las 7:30 — el aviso habría acusado a dos salas que ya estaban abiertas.
--
-- ── Por qué el costo NO se multiplica por seis ─────────────────────────────
-- En modo `manana` la función sólo le pregunta al origen por las salas que
-- todavía no abrieron, y si ya salió el aviso no gasta ni el login. Con las
-- aperturas reales de los últimos 8 días, una mañana sale en ~50 peticiones;
-- barrer las seis salas en cada uno de los 8 disparos costaría ~150.
--
-- ── Por qué hay un disparo a las 7:35 ──────────────────────────────────────
-- Es el repaso, no un segundo aviso: la marca de `avisos_emitidos` hace que
-- sólo haga algo si el de las 7:20 no llegó a mandar nada. Una corrida que
-- habla con el origen puede fallar, y un aviso que depende de que un disparo
-- puntual salga bien es un aviso que un día no sale y nadie se entera.
-- ═══════════════════════════════════════════════════════════════════════════

SELECT cron.schedule(
  'aperturas-manana-antes-de-las-7',
  '50,55 12 * * *',
  $cron$
  SELECT net.http_post(
    url     := 'https://sacecdkdmsdvgqnrsett.supabase.co/functions/v1/sync-aperturas-caja',
    body    := '{"manana": true}'::jsonb,
    headers := jsonb_build_object(
                 'Content-Type','application/json',
                 'Authorization','Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='admin_invoke_secret')),
    timeout_milliseconds := 150000);
  $cron$);

SELECT cron.schedule(
  'aperturas-manana-hasta-la-hora-tope',
  '0,5,10,15,20,35 13 * * *',
  $cron$
  SELECT net.http_post(
    url     := 'https://sacecdkdmsdvgqnrsett.supabase.co/functions/v1/sync-aperturas-caja',
    body    := '{"manana": true}'::jsonb,
    headers := jsonb_build_object(
                 'Content-Type','application/json',
                 'Authorization','Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='admin_invoke_secret')),
    timeout_milliseconds := 150000);
  $cron$);
