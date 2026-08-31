SET lock_timeout = '5s';

-- ── El vencimiento mira todos los meses, y todavía no quita ──────────────────
-- `{"aplicar": false}` está escrito en el cuerpo del cron a propósito, aunque
-- también sea el default de la función. Que el modo seguro esté DICHO acá
-- significa que encenderlo de verdad exige editar esta línea: nadie lo va a
-- activar por cambiar un default en el código sin darse cuenta de que además
-- hay un cron llamándola cada mes.
--
-- El día 1 a las 09:00 UTC: dentro de la ventana en que los syncs no corren
-- (12-23,0-5), así que no compite por conexiones con nada.
--
-- Lo que deja cada corrida en `puntos_vencimiento_log` no es contabilidad: es
-- la serie que hay que mirar antes de encenderla. La primera medición ya dijo
-- lo importante — con la regla de gracia hoy vencen CERO puntos, y sin ella
-- vencerían 1,431,997 de 10,508 personas. Ese segundo número es el escalón que
-- llega entero el 1-oct-2027, y verlo moverse mes a mes es la única forma de
-- llegar a esa fecha con una decisión tomada en vez de con una sorpresa.
SELECT cron.schedule(
  'puntos-vencer-mensual',
  '0 9 1 * *',
  $cron$
  SELECT net.http_post(
    url     := 'https://sacecdkdmsdvgqnrsett.supabase.co/functions/v1/puntos-vencer',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='admin_invoke_secret')),
    body    := '{"aplicar": false}'::jsonb,
    timeout_milliseconds := 150000
  );
  $cron$
);
