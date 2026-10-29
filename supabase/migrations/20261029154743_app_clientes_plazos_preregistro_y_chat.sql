-- Plazos de la app de clientes (PENDIENTES 29, usuario 2026-10-29).
--
-- · Pre-registro que nadie vinculó: se borra a los 60 días (pendiente desde
--   su alta, descartado desde que se resolvió). El VINCULADO no se toca: sus
--   aceptaciones (`app_cliente_aceptaciones`, ON DELETE CASCADE) son la prueba
--   del consentimiento del cliente.
-- · Chat: la conversación con 12 meses sin un mensaje se borra entera, con sus
--   fotos y audios. Los archivos los borra la edge function
--   `purgar-chat-clientes` (un DELETE en storage.objects deja el archivo), que
--   llama a estas dos funciones: primero la lista, después el borrado.
--   `app_chat_purgar` vuelve a mirar la condición: si entró un mensaje entre
--   las dos llamadas, esa conversación no se borra.
--
-- Sesiones y Wallet ya tenían su limpieza: `app_cliente_sesiones_purgar`
-- (30 días después de cerrarse o vencer) y `wallet-pases`, que borra el
-- registro cuando el teléfono quita la tarjeta.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.app_cliente_preregistros_purgar()
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, extensions
AS $function$
DECLARE
  n integer;
BEGIN
  DELETE FROM public.app_cliente_preregistros
   WHERE id IN (
     SELECT id FROM public.app_cliente_preregistros
      WHERE (estado = 'pendiente'  AND created_at < now() - interval '60 days')
         OR (estado = 'descartado' AND coalesce(resuelto_at, created_at) < now() - interval '60 days')
      LIMIT 2000);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$function$;

CREATE OR REPLACE FUNCTION public.app_chat_por_purgar(p_limite integer DEFAULT 200)
RETURNS json
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, extensions
AS $function$
  SELECT coalesce(json_agg(json_build_object('id', c.id, 'archivos', (
           SELECT coalesce(array_agg(DISTINCT r) FILTER (WHERE r IS NOT NULL), '{}')
             FROM public.app_chat_mensajes m,
                  LATERAL (VALUES (m.foto_ruta), (m.adjunto->>'ruta')) v(r)
            WHERE m.conversacion_id = c.id))), '[]'::json)
    FROM (SELECT id FROM public.app_chat_conversaciones
           WHERE coalesce(ultimo_mensaje_at, created_at) < now() - interval '12 months'
           ORDER BY id
           LIMIT least(greatest(coalesce(p_limite, 200), 1), 500)) c;
$function$;

CREATE OR REPLACE FUNCTION public.app_chat_purgar(p_ids bigint[])
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, extensions
AS $function$
DECLARE
  n integer;
BEGIN
  DELETE FROM public.app_chat_conversaciones
   WHERE id = ANY (p_ids)
     AND coalesce(ultimo_mensaje_at, created_at) < now() - interval '12 months';
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.app_cliente_preregistros_purgar() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.app_chat_por_purgar(integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.app_chat_purgar(bigint[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_cliente_preregistros_purgar() TO service_role;
GRANT EXECUTE ON FUNCTION public.app_chat_por_purgar(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.app_chat_purgar(bigint[]) TO service_role;

SELECT cron.schedule('purge-app-cliente-preregistros', '55 9 * * *',
  'SELECT public.app_cliente_preregistros_purgar()')
 WHERE NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'purge-app-cliente-preregistros');

SELECT cron.schedule('purgar-chat-clientes-diario', '5 10 * * *', $cron$
    select net.http_post(
      url := 'https://sacecdkdmsdvgqnrsett.supabase.co/functions/v1/purgar-chat-clientes',
      headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='cron_invoke_secret')),
      body := '{}'::jsonb
    );
  $cron$)
 WHERE NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'purgar-chat-clientes-diario');
