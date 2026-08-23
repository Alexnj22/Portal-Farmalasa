SET lock_timeout = '5s';

-- ── Las cabeceras con las que un cron llama a una función con JWT ──────────
--
-- `push_function_headers()` no sirve acá: manda sólo el secreto de cron, y eso
-- alcanza para `send-push-notification`, que está desplegada con
-- `verify_jwt=false`. `enviar-producto-erp` la llama el NAVEGADOR con la sesión
-- de la persona, así que está en `verify_jwt=true` —y así se queda: el flag
-- depende de quién llama, no del circuito— y el gateway rechaza la petición
-- ANTES de ejecutar una línea si no viene un token que sepa leer.
--
-- La clave publicable pasa ese control (probado contra la función desplegada) y
-- no es un secreto: viaja al navegador en cada carga. Vive en Vault igual, para
-- no dejarla escrita en `cron.job.command` ni en el repo.
CREATE OR REPLACE FUNCTION public.cron_auth_headers()
 RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT jsonb_build_object(
    'Content-Type', 'application/json',
    'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'anon_key'),
    'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_invoke_secret')
  );
$function$;
REVOKE EXECUTE ON FUNCTION public.cron_auth_headers() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cron_auth_headers() TO service_role;

-- ── El disparador de la continuación ───────────────────────────────────────
-- Una llamada POR ENVÍO y no una que los recorra: cada despacho abre su propia
-- sesión contra el sistema de origen y ahí la sucursal es estado de la SESIÓN;
-- dos envíos de salas distintas en la misma invocación se pisarían.
--
-- Devuelve cuántos disparó para que la corrida quede medida.
CREATE OR REPLACE FUNCTION public.continuar_envios_pendientes(p_minutos integer DEFAULT 10)
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    e record;
    v_n integer := 0;
BEGIN
    FOR e IN SELECT * FROM public.envios_por_continuar(p_minutos) LOOP
        PERFORM net.http_post(
            url     := 'https://sacecdkdmsdvgqnrsett.supabase.co/functions/v1/enviar-producto-erp',
            headers := public.cron_auth_headers(),
            body    := jsonb_build_object('request_id', e.request_id, 'accion', 'despachar'),
            timeout_milliseconds := 150000);
        v_n := v_n + 1;
    END LOOP;
    RETURN v_n;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.continuar_envios_pendientes(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.continuar_envios_pendientes(integer) TO service_role;

-- ── Los dos crons ──────────────────────────────────────────────────────────
-- Cada 10 minutos y no cada minuto: lo normal es que no haya NADA que retomar
-- —el despacho entero cabe en una corrida— y un cron que pregunta 1.440 veces
-- al día por algo que pasa una vez por semana es justo lo que el gate de
-- eficiencia vino a frenar. Cuando hay algo, diez minutos de demora sobre una
-- caja que va a salir mañana no cambian nada.
SELECT cron.schedule('continuar-envios', '*/10 * * * *', $cron$
  SELECT public.continuar_envios_pendientes(10);
$cron$);

-- Y el recordatorio, una vez al día a media mañana: a esa hora la sala ya abrió
-- y todavía le queda el día para contestar. No cuesta ni una petición al
-- sistema de origen — es una consulta y un aviso.
SELECT cron.schedule('avisar-envios-sin-decidir', '0 15 * * *', $cron$
  SELECT public.avisar_envios_sin_decidir(2);
$cron$);
