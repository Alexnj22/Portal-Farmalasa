SET lock_timeout = '5s';

-- El REVOKE de las migraciones anteriores le quito el EXECUTE a PUBLIC y a
-- `anon`, y ahi se quedo: **Supabase se lo concede a `authenticated` por
-- defecto**, asi que la funcion quedaba al alcance de cualquiera con sesion.
--
-- No es teorico: escribe en `announcements`. Quien la llamara desde el navegador
-- podia publicarle avisos a Talento Humano y a cualquier persona, tantas veces
-- como quisiera si de paso movia las fechas.
--
-- Lo levanto `npm run gate:migrations`, que existe exactamente para esto.
REVOKE EXECUTE ON FUNCTION public.avisar_dui_por_vencer(int) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.avisar_dui_por_vencer(int) TO service_role;
