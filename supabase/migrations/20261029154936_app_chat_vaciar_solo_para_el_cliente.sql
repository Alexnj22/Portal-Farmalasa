-- «El cliente puede limpiar el chat, pero para él» (PENDIENTES 29, usuario
-- 2026-10-29). Vaciar NO borra: guarda hasta qué mensaje vació, y la app sólo
-- le muestra lo posterior. La farmacia sigue viendo la conversación entera, y
-- el plazo de 12 meses (`app_chat_purgar`) es el que la borra de verdad.
SET lock_timeout = '5s';
ALTER TABLE public.app_chat_conversaciones ADD COLUMN IF NOT EXISTS cliente_vacio_hasta_id bigint;
COMMENT ON COLUMN public.app_chat_conversaciones.cliente_vacio_hasta_id IS
  'Último mensaje que el cliente vació de su app: ve sólo los de id mayor. El equipo ve todo.';
