-- Las funciones de trigger del planificador no son para el navegador. Supabase
-- le concede EXECUTE a `authenticated` por defecto, y el REVOKE de la
-- migración anterior sólo alcanzaba a PUBLIC y anon (gate:migrations). Un
-- trigger no necesita EXECUTE de quien dispara la escritura: se verifica al
-- crearlo, no al dispararse.
SET lock_timeout = '5s';
REVOKE EXECUTE ON FUNCTION public.marketing_pieza_en_su_mes()      FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.marketing_candado_de_estado()    FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.marketing_archivo_reabre_pieza() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.marketing_avisar_solicitud()     FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.marketing_avisar_comentario()    FROM PUBLIC, anon, authenticated;
