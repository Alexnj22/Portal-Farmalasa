-- Las dos funciones de la foto diaria quedaban ejecutables por `authenticated`.
--
-- La misma trampa que con las particiones, en su otra forma: el ACL por defecto
-- de este proyecto otorga EXECUTE a `anon`, `authenticated` y `service_role`
-- sobre TODA funcion nueva de `public`, de forma EXPLICITA. `REVOKE ... FROM
-- PUBLIC, anon` —que es la formula de la regla 4 de CLAUDE.md— no toca esa
-- concesion nominal a `authenticated`: revoca del pseudo-rol PUBLIC, no del rol
-- que la tiene con nombre propio. El advisor lo levanto como dos WARN de
-- `authenticated_security_definer_function_executable`.
--
-- Aca no aplica el «GRANT a authenticated» de esa regla, y ese es el punto:
-- ninguna de las dos es una funcion de pantalla.
--
--   inventory_daily_snapshot            escribe la foto del dia; que la pueda
--                                       disparar cualquiera con sesion permite
--                                       reescribir un dia del historial.
--   inventory_daily_mantener_particiones hace DDL — crea y SUELTA tablas. Una
--                                       particion soltada se lleva un mes de
--                                       historial y no se deshace.
--
-- Las dos las llama el cron y nadie mas. Se les revoca a `authenticated`.

SET lock_timeout = '5s';

REVOKE EXECUTE ON FUNCTION public.inventory_daily_snapshot(date)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.inventory_daily_mantener_particiones()
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.inventory_daily_snapshot(date)             TO service_role;
GRANT EXECUTE ON FUNCTION public.inventory_daily_mantener_particiones()     TO service_role;
