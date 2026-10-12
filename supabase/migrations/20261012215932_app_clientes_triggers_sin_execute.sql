-- Funciones de TRIGGER de la receta y el chat (2026-10-12): Supabase le da
-- EXECUTE a `authenticated` por defecto y el REVOKE de la migración anterior
-- sólo se lo quitó a PUBLIC y anon. No son para el navegador.
SET lock_timeout = '5s';
REVOKE EXECUTE ON FUNCTION public.app_reservas_avisar_receta() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.app_chat_mensaje_nuevo() FROM PUBLIC, anon, authenticated;
