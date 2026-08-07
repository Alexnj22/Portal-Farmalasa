-- La corrida diaria de fichas, a las 21:30 de El Salvador (03:30 UTC).
--
-- UNA HORA ANTES del barrido de facturas (`regularizar-dte-2230-sv`, 04:30 UTC)
-- para que el barrido encuentre las fichas ya corregidas y no reciba rechazos
-- por un distrito que faltaba.
--
-- Reemplaza al launchd que corría en la Mac de un usuario: una laptop apagada a
-- esa hora era un día sin corrida, y macOS además bloquea que una tarea
-- programada lea ~/Documents (TCC) — el agente moría con "Operation not
-- permitted" antes de la primera línea. Acá no depende de ninguna máquina.
--
-- El secreto sale de Vault, igual que el del barrido: la función va con
-- `--no-verify-jwt` y valida adentro.

SET lock_timeout = '5s';

SELECT cron.schedule(
  'sincronizar-fichas-clientes-2130-sv',
  '30 3 * * *',
  $cron$
  SELECT net.http_post(
    url     := 'https://sacecdkdmsdvgqnrsett.supabase.co/functions/v1/sincronizar-fichas-clientes',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'Authorization', 'Bearer ' || (SELECT decrypted_secret
                                                  FROM vault.decrypted_secrets
                                                 WHERE name = 'admin_invoke_secret')),
    body    := '{}'::jsonb,
    -- Cada ficha son 1-3 viajes al ERP; la función se corta sola a los 110 s,
    -- así que este techo solo cubre el cierre.
    timeout_milliseconds := 180000
  );
  $cron$
);
