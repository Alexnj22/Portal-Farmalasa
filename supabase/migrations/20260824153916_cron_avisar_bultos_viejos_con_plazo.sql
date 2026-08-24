SET lock_timeout = '5s';

-- El cron salió sin `timeout_milliseconds`, o sea con el defecto de pg_net: 5
-- segundos. La función recorre las bolsas de a una —una lectura de antiduplicado
-- y un aviso por cada— así que con una docena de bolsas atrasadas la llamada se
-- pasa de 5s, pg_net anota un timeout en vez del 200, y `gate:eficiencia`
-- —cuyo trabajo es justamente comprobar que las llamadas salientes contesten
-- 200— empieza a reportar un cron caído sobre trabajo que sí se hizo.
--
-- 120 s es lo que usan los demás crons de este repo para funciones de este
-- tamaño. Los otros dos arreglos —no abortar la corrida por una fila y buscar
-- los antiduplicados de una sola vez— van en la función.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'avisar-bultos-viejos-daily') THEN
    PERFORM cron.unschedule('avisar-bultos-viejos-daily');
  END IF;
END $$;

SELECT cron.schedule(
  'avisar-bultos-viejos-daily',
  '0 15 * * *',
  $cron$
  SELECT net.http_post(
    url     := 'https://sacecdkdmsdvgqnrsett.supabase.co/functions/v1/avisar-bultos-viejos',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'admin_invoke_secret')),
    body    := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $cron$
);

-- Y el índice que le faltaba a la consulta de «qué está esperando salir de esta
-- sala»: filtra por una clave DENTRO del jsonb, que ningún índice de
-- `approval_requests` cubre. Sin él es un barrido de la tabla entera cada vez
-- que alguien abre el recorrido —desde un teléfono, con datos móviles— y es la
-- misma forma de defecto que hizo nacer `gate:perf`.
CREATE INDEX IF NOT EXISTS approval_requests_origen_traslado_idx
  ON public.approval_requests ((nullif(metadata->>'origen_branch_id', '')::bigint))
  WHERE type IN ('INVENTORY_TRANSFER_REQUEST', 'INVENTORY_TRANSFER_PUSH');

-- El antiduplicado del aviso busca `metadata->>'check_key'` en `notifications`,
-- que tampoco tiene índice para eso y sólo crece.
CREATE INDEX IF NOT EXISTS notifications_check_key_idx
  ON public.notifications ((metadata->>'check_key'))
  WHERE metadata ? 'check_key';
