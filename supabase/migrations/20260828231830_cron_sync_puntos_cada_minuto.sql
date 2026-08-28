-- CADA MINUTO, decisión del usuario. La cadencia importa por una razón concreta
-- del mostrador: el cliente puede presentar el ticket poco después de comprar, y
-- si la venta todavía no llegó a la base de puntos, no se le pueden dar. Cada
-- cinco minutos deja una ventana de hasta cinco en la que un ticket recién
-- emitido «no existe»; cada minuto la cierra casi del todo.
--
-- Se puede porque se midió, no porque suene bien: en régimen
-- `ventas_para_puntos` sobre la ventana de siete días tarda **34 ms** — la
-- bitácora `puntos_enviados` descarta lo ya enviado, así que la ventana ancha no
-- cuesta lo que parece. Son 49 segundos de base por día. Si algún día ese número
-- crece, ACÁ es donde hay que mirar antes de dejar la cadencia: una lectura
-- lenta cada minuto llena el pool de PostgREST y tira el portal entero, que es
-- exactamente lo que documenta
-- [[feedback_una_consulta_lenta_de_lectura_tumba_el_portal_entero]].
-- Con guarda, y no por prolijidad: `cron.unschedule` LANZA si el trabajo no
-- existe. En producción existía —lo creó la migración anterior— así que corrió
-- igual, pero en un replay desde una base vacía abortaría acá y ninguna
-- migración posterior se aplicaría. Lo levantó `npm run gate:migrations`.
SELECT cron.unschedule('sync-puntos-5min')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sync-puntos-5min');

SELECT cron.schedule(
  'sync-puntos-1min',
  '* * * * *',
  $$
  SELECT net.http_post(
    url     := 'https://sacecdkdmsdvgqnrsett.supabase.co/functions/v1/sync-puntos',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='admin_invoke_secret')),
    body    := '{}'::jsonb,
    timeout_milliseconds := 170000
  );
  $$
);
