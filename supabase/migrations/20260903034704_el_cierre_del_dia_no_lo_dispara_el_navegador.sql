SET lock_timeout = '5s';

-- El aviso del cierre del día lo mandan el trigger del último Z y el cron de
-- las 23:50 — nunca una pantalla. `REVOKE … FROM PUBLIC, anon` no alcanza:
-- Supabase le concede EXECUTE a `authenticated` por defecto, así que la función
-- quedaba al alcance de cualquiera con sesión.
--
-- No es cosmético: es SECURITY DEFINER y escribe en `notifications` y en
-- `avisos_emitidos`. Quien la llamara le mandaría el cierre del día al Gerente
-- General con la fecha que quisiera, y —peor— con `p_forzado` quemaría la marca
-- del día, dejando el aviso de esa noche sin salir.
--
-- Lo levantó `npm run gate:migrations`.
REVOKE EXECUTE ON FUNCTION public.avisar_cierre_del_dia(date, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.avisar_cierre_del_dia(date, boolean) TO service_role;
