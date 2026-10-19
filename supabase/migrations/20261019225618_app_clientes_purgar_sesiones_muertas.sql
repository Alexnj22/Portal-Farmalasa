-- Purga de las sesiones muertas de la app de clientes (2026-10-19, auditoría).
--
-- Una sesión revocada («Cerrar sesión», «Borrar mi cuenta», un pre-registro
-- descartado) o vencida (180 días sin uso, `DIAS_SESION` de app-clientes) ya
-- no abre nada, pero seguía guardada para siempre con el modelo del teléfono
-- y la referencia de avisos. Se borran 30 días después de morir: ese margen
-- deja ver en el registro qué pasó con una sesión reciente.
--
-- Con GUARDA: un tope por corrida, para que un día raro (una revocación
-- masiva) no se convierta en un DELETE enorme a la hora del cron; lo que
-- sobre lo toma la corrida siguiente.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.app_cliente_sesiones_purgar()
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, extensions
AS $function$
DECLARE
  n integer;
BEGIN
  DELETE FROM public.app_cliente_sesiones
   WHERE id IN (
     SELECT id FROM public.app_cliente_sesiones
      WHERE revocada_at < now() - interval '30 days'
         OR ultimo_uso_at < now() - interval '210 days'
      LIMIT 5000);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$function$;

REVOKE ALL ON FUNCTION public.app_cliente_sesiones_purgar() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_cliente_sesiones_purgar() TO service_role;

-- 3:45 SV, junto a las otras purgas de la app (9:35 y 9:40 UTC).
SELECT cron.schedule('purge-app-cliente-sesiones', '45 9 * * *', $$SELECT public.app_cliente_sesiones_purgar()$$);
