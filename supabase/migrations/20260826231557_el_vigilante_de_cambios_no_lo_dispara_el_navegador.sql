-- La vigilancia no se dispara desde el navegador.
--
-- `avisar_cambios_que_no_se_quedaron` escribe avisos y marca solicitudes, así
-- que sólo la corre el cron. La revocación original decía «FROM PUBLIC, anon»
-- y eso NO alcanza: Supabase le concede EXECUTE a `authenticated` por defecto,
-- o sea que quedaba al alcance de cualquiera con sesión abierta. Lo levantó
-- `npm run gate:migrations`, que existe justamente para esto.
SET lock_timeout = '5s';

REVOKE EXECUTE ON FUNCTION public.avisar_cambios_que_no_se_quedaron(integer)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.avisar_cambios_que_no_se_quedaron(integer)
  TO service_role;
