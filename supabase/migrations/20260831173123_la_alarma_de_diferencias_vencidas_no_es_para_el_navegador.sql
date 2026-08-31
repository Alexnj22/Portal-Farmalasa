SET lock_timeout = '5s';

-- `avisar_diferencias_vencidas()` la llama un cron y nadie más: revisa plazos y
-- escribe avisos. No tiene por qué poder dispararla alguien desde el navegador.
--
-- El REVOKE de la migración anterior le quitaba el EXECUTE a PUBLIC y a `anon`,
-- que es lo que uno escribe por costumbre — y **no alcanza**: Supabase se lo
-- concede a `authenticated` por su cuenta, así que la función quedaba al alcance
-- de cualquiera con sesión. Lo levantó `npm run gate:migrations`, que es
-- exactamente para lo que existe.
--
-- Lo que se podía hacer con ella no es grave —adelantar avisos— pero es una
-- función que escribe en `notifications` en nombre del sistema, y la campana
-- deja de significar algo si cualquiera la puede tocar.
REVOKE EXECUTE ON FUNCTION public.avisar_diferencias_vencidas() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.avisar_diferencias_vencidas() TO service_role;
