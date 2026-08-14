SET lock_timeout = '5s';

-- La captura pasa de cada minuto a cada 30 segundos.
--
-- Medido sobre los 12 cortes del 2026-08-14 (el primer día con la captura
-- corriendo desde temprano): la corrida entera dura entre 1 y 7 segundos —los
-- `capturado_at` caen todos a los pocos segundos del tope de minuto—, así que
-- el retraso NO lo pone el trabajo: lo pone la espera hasta el próximo tic.
-- Desfase medido: mínimo 20s, mediana 57s, máximo 87s. Con el tic cada 30
-- segundos esa espera se parte al medio.
--
-- El horario ya no puede ir en la expresión: pg_cron acepta segundos sólo con
-- la forma «N seconds», que no tiene campos de hora. Va como guarda en el
-- cuerpo — un SELECT sin FROM cuya WHERE no pasa no evalúa la lista de
-- selección, o sea que `net.http_post` ni se llama. La ventana es la misma que
-- tenía el cron viejo (`* 12-23,0-5 * * *` UTC = 06:00–23:59 de El Salvador).
--
-- Dos corridas encimadas no hacen daño y eso ya estaba resuelto en la función:
-- cada una hace su propio login (sesión propia, sin cruce de sucursal) y el
-- INSERT va con `ignoreDuplicates`.
SELECT cron.unschedule('cortes-caja-1min');

SELECT cron.schedule('cortes-caja-30s', '30 seconds', $job$
  SELECT net.http_post(
    url     := 'https://sacecdkdmsdvgqnrsett.supabase.co/functions/v1/sync-cortes-caja',
    body    := '{}'::jsonb,
    headers := jsonb_build_object(
                 'Content-Type','application/json',
                 'Authorization','Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='admin_invoke_secret')),
    timeout_milliseconds := 150000)
  WHERE extract(hour FROM (current_timestamp AT TIME ZONE 'America/El_Salvador')) BETWEEN 6 AND 23;
$job$);
