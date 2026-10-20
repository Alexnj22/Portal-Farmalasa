-- Chat de Puntos Salud, etapa 2 (2026-10-20, «que sea como las apps de
-- mensajería»): mensajes AL INSTANTE, editar y borrar lo propio, y documentos
-- (PDF) y notas de voz.
--
-- 1. En vivo, como TIMBRE. Los clientes no entran con Supabase Auth (su sesión
--    es un token propio de `app-clientes`), así que no pueden leer las tablas
--    del chat por Realtime. En vez de eso, cada conversación tiene un CANAL
--    secreto (`canal`, 32 hex al azar) y un trigger toca el timbre —un
--    broadcast SIN contenido— en `chat:<canal>` cuando algo cambia. La app,
--    al oírlo, pide lo nuevo a `app-clientes` como siempre. Así el mensaje
--    llega al instante y por el canal no viaja ni una letra: quien adivinara
--    el canal sólo sabría que algo cambió. El timbre nunca frena un mensaje:
--    si Realtime falla, el sondeo de la app sigue.
-- 2. Editar y borrar: `editado_at`, `borrado_at` y `cambiado_at` (cuándo
--    cambió por última vez, para que la app pida «lo que cambió desde…»). El
--    contenido borrado se conserva en la fila —el equipo y la bitácora lo
--    siguen viendo—; al cliente le llega «Eliminaste este mensaje».
-- 3. El bucket del chat acepta PDF y audio (nota de voz en m4a/AAC).
SET lock_timeout = '5s';

ALTER TABLE public.app_chat_conversaciones
  ADD COLUMN IF NOT EXISTS canal text NOT NULL DEFAULT encode(extensions.gen_random_bytes(16), 'hex');

ALTER TABLE public.app_chat_mensajes
  ADD COLUMN IF NOT EXISTS editado_at timestamptz,
  ADD COLUMN IF NOT EXISTS borrado_at timestamptz,
  ADD COLUMN IF NOT EXISTS cambiado_at timestamptz;
CREATE INDEX IF NOT EXISTS app_chat_mensajes_cambiado_idx
  ON public.app_chat_mensajes (conversacion_id, cambiado_at) WHERE cambiado_at IS NOT NULL;

CREATE OR REPLACE FUNCTION public.app_chat_timbre()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, extensions
AS $$
DECLARE
  v_conv bigint;
  v_canal text;
BEGIN
  IF TG_TABLE_NAME = 'app_chat_conversaciones' THEN
    v_conv := NEW.id;
  ELSIF TG_TABLE_NAME = 'app_chat_mensajes' THEN
    v_conv := NEW.conversacion_id;
  ELSE
    SELECT m.conversacion_id INTO v_conv FROM public.app_chat_mensajes m
     WHERE m.id = CASE WHEN TG_OP = 'DELETE' THEN OLD.mensaje_id ELSE NEW.mensaje_id END;
  END IF;
  SELECT c.canal INTO v_canal FROM public.app_chat_conversaciones c WHERE c.id = v_conv;
  IF v_canal IS NOT NULL THEN
    BEGIN
      PERFORM realtime.send(jsonb_build_object('t', extract(epoch FROM clock_timestamp())), 'cambio', 'chat:' || v_canal, false);
    EXCEPTION WHEN others THEN
      NULL; -- el timbre nunca frena un mensaje: la app igual pregunta sola
    END;
  END IF;
  RETURN NULL;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.app_chat_timbre() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS app_chat_timbre_mensaje ON public.app_chat_mensajes;
CREATE TRIGGER app_chat_timbre_mensaje AFTER INSERT OR UPDATE ON public.app_chat_mensajes
  FOR EACH ROW EXECUTE FUNCTION public.app_chat_timbre();
-- De la conversación, sólo lo que el CLIENTE ve cambiar: quién escribe, quién
-- atiende, si el equipo ya vio, y si se resolvió. Lo que escribe el propio
-- cliente (`cliente_escribiendo_at`) no toca su timbre.
DROP TRIGGER IF EXISTS app_chat_timbre_conversacion ON public.app_chat_conversaciones;
CREATE TRIGGER app_chat_timbre_conversacion
  AFTER UPDATE OF escribiendo_por, escribiendo_at, visto_equipo_at, tomada_por, estado ON public.app_chat_conversaciones
  FOR EACH ROW EXECUTE FUNCTION public.app_chat_timbre();
DROP TRIGGER IF EXISTS app_chat_timbre_reaccion ON public.app_chat_reacciones;
CREATE TRIGGER app_chat_timbre_reaccion AFTER INSERT OR UPDATE OR DELETE ON public.app_chat_reacciones
  FOR EACH ROW EXECUTE FUNCTION public.app_chat_timbre();

UPDATE storage.buckets
   SET allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic',
                                  'application/pdf', 'audio/mp4', 'audio/x-m4a', 'audio/m4a', 'audio/aac', 'audio/mpeg']
 WHERE id = 'app-clientes-archivos';
