-- Barrido nocturno de lo que quedó a medias entre el ERP y Hacienda:
-- facturas anuladas sin invalidar ante el MH, y emitidas sin sello.
--
-- 22:30 hora de El Salvador = 04:30 UTC. El Salvador no tiene horario de
-- verano, así que el offset es fijo todo el año (-6) y no hay que corregirlo
-- dos veces por año como pasaría con otras zonas. El cron `ccf-repaso-22h-sv`
-- ya usa `0 4` para las 22:00, misma cuenta.
--
-- A esa hora las sucursales ya cerraron: lo del día está completo y no se pisa
-- con una factura que se está emitiendo en ese momento.
SET lock_timeout = '5s';

SELECT cron.unschedule('regularizar-dte-2230-sv')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'regularizar-dte-2230-sv');

SELECT cron.schedule(
  'regularizar-dte-2230-sv',
  '30 4 * * *',
  $cron$
  SELECT net.http_post(
    url     := 'https://sacecdkdmsdvgqnrsett.supabase.co/functions/v1/regularizar-dte',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'Authorization', 'Bearer ' || (SELECT decrypted_secret
                                                  FROM vault.decrypted_secrets
                                                 WHERE name = 'admin_invoke_secret')),
    body    := jsonb_build_object('alcance', 'todas'),
    -- Cada documento son cinco viajes al ERP y uno al MH. Con decenas de
    -- facturas la corrida puede pasar los dos minutos; el techo del lado de la
    -- función es MAX_POR_CORRIDA.
    timeout_milliseconds := 240000
  );
  $cron$
);
