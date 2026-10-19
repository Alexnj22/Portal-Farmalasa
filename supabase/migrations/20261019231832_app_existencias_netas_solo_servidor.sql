SET lock_timeout = '5s';

-- (2026-10-19) `app_existencias_netas` la llama sólo `app-clientes` con la
-- llave del servidor (y las dos funciones de existencias de la app, que
-- también son sólo del servidor). Supabase le concede EXECUTE a
-- `authenticated` por defecto: revocarle sólo a PUBLIC y anon lo dejaba
-- adentro (lo marcó `gate:migrations`).
REVOKE EXECUTE ON FUNCTION public.app_existencias_netas(integer[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_existencias_netas(integer[]) TO service_role;
