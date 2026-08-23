SET lock_timeout = '5s';

-- El cron llamaba a `continuar_envios_pendientes()`, que adentro hacía el
-- `net.http_post`. Funcionaba, y dejaba al cron INVISIBLE para el gate de
-- eficiencia: su barrido de producción lista los crons con
-- `command ILIKE '%functions/v1/%'`, así que un disparo escondido dentro de una
-- función no aparece ni en «crons sin declarar» ni en el cruce de cadencia.
--
-- Un cron que dispara peticiones al sistema y que el vigilante no puede
-- descubrir es exactamente el que no debe existir. El `http_post` vuelve al
-- comando, donde se ve.
SELECT cron.unschedule('continuar-envios');

SELECT cron.schedule('continuar-envios', '*/10 * * * *', $cron$
  -- Una llamada POR ENVÍO: cada despacho abre su propia sesión contra el
  -- sistema de origen, y ahí la sucursal es estado de la SESIÓN — dos envíos de
  -- salas distintas en la misma invocación se pisarían.
  SELECT net.http_post(
           url     := 'https://sacecdkdmsdvgqnrsett.supabase.co/functions/v1/enviar-producto-erp',
           headers := public.cron_auth_headers(),
           body    := jsonb_build_object('request_id', e.request_id, 'accion', 'despachar'),
           timeout_milliseconds := 150000)
    FROM public.envios_por_continuar(10) e;
$cron$);

-- Y la función intermedia se va: dos caminos para el mismo disparo terminan
-- divergiendo, y el que quedaría escondido es justo el que no se puede vigilar.
DROP FUNCTION IF EXISTS public.continuar_envios_pendientes(integer);
