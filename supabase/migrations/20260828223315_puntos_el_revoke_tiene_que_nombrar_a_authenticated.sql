SET lock_timeout = '5s';

-- Lo levantó `npm run gate:migrations`, y es un agujero de verdad, no un
-- formalismo: `REVOKE … FROM PUBLIC, anon` NO le quita el EXECUTE a
-- `authenticated`, porque Supabase se lo concede aparte y explícitamente. Las
-- cuatro funciones quedaban al alcance de cualquiera con sesión abierta.
--
-- Ninguna de las cuatro es para el navegador: las llama `sync-puntos` con
-- service_role. `puntos_marcar_enviadas` y `puntos_marcar_anuladas` ESCRIBEN —
-- hoy el RLS de `puntos_enviados` las habría frenado igual (no hay policy de
-- INSERT ni de UPDATE), pero apoyarse en eso es dejar que el permiso dependa de
-- una segunda cosa que también se puede cambiar por accidente.
REVOKE EXECUTE ON FUNCTION public.ventas_para_puntos(date, date, numeric, integer)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.puntos_ventas_anuladas(integer)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.puntos_marcar_enviadas(bigint[])
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.puntos_marcar_anuladas(bigint[])
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.ventas_para_puntos(date, date, numeric, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.puntos_ventas_anuladas(integer)                  TO service_role;
GRANT EXECUTE ON FUNCTION public.puntos_marcar_enviadas(bigint[])                 TO service_role;
GRANT EXECUTE ON FUNCTION public.puntos_marcar_anuladas(bigint[])                 TO service_role;
