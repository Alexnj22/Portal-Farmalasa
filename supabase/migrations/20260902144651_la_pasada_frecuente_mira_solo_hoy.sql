SET lock_timeout = '5s';

/* ── La pasada de cada diez minutos mira SÓLO HOY ──────────────────────────
 *
 * Idea del usuario (2-sep): «no necesitás toda la fecha; si ya guardaste la
 * primera vez las anteriores, después sólo necesitás pasar y obtener las del
 * día». Medido antes de cambiarlo, y la diferencia es de diez veces:
 *
 *   completo   2024-01-01 → hoy    **17.3 s · 1.4 MB · 2,387 filas**
 *   hoy        sólo el día         **1.8 s · 2 kB · 1 fila**
 *
 * ── Y por eso hace falta un barrido COMPLETO diario ───────────────────────
 * Es la parte que se olvida y la que deja el defecto silencioso: un abono
 * hecho EN EL ORIGEN sobre un crédito de hace ocho meses **no aparece en la
 * ventana de hoy** —lo que cambió es su saldo, no su fecha—, así que sin este
 * barrido el espejo se quedaría mostrando una deuda ya pagada para siempre, y
 * el aviso del plazo cobraría lo que nadie debe.
 *
 * A las 08:00 UTC (2am SV): el origen está quieto, nadie está cobrando, y
 * entre esa hora y el aviso de las 14:00 UTC no cambia nada.
 *
 * La tercera pieza vive en `creditos-erp`: después de un abono se relee esa
 * sala en esa fecha para confirmar que entró y refrescar el espejo al
 * instante. Sin eso, quien acaba de cobrar vería la deuda vieja durante diez
 * minutos — y el segundo intento es cobrarle dos veces al cliente.
 */
SELECT cron.unschedule('creditos-cada-10min')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'creditos-cada-10min');

SELECT cron.schedule(
  'creditos-cada-10min',
  '*/10 13-23,0-3 * * *',
  $cron$
  SELECT net.http_post(
    url     := 'https://sacecdkdmsdvgqnrsett.supabase.co/functions/v1/sync-creditos',
    body    := '{"modo":"hoy"}'::jsonb,
    headers := jsonb_build_object(
                 'Content-Type','application/json',
                 'Authorization','Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='admin_invoke_secret'),
                 'x-invoke-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='admin_invoke_secret')),
    timeout_milliseconds := 60000
  );
  $cron$
);

SELECT cron.schedule(
  'creditos-barrido-completo',
  '0 8 * * *',
  $cron$
  SELECT net.http_post(
    url     := 'https://sacecdkdmsdvgqnrsett.supabase.co/functions/v1/sync-creditos',
    body    := '{"modo":"completo"}'::jsonb,
    headers := jsonb_build_object(
                 'Content-Type','application/json',
                 'Authorization','Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='admin_invoke_secret'),
                 'x-invoke-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='admin_invoke_secret')),
    timeout_milliseconds := 150000
  );
  $cron$
);
