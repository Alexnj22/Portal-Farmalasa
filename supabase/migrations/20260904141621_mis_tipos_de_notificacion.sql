SET lock_timeout = '5s';

-- Los tipos de aviso que TIENE quien pregunta, para llenar el filtro de
-- `/notificaciones` sin escribir la lista a mano.
--
-- INVOKER a propósito: así el RLS de `notifications_select` sigue decidiendo y
-- la función no puede contar tipos de avisos ajenos. Una DEFINER acá haría que
-- el desplegable de una persona nombrara categorías que nunca recibió.
--
-- Por función y no `select('type')` desde el navegador: eso son tantas filas
-- como avisos tenga —hoy hasta 608 por persona— y PostgREST corta en 1000 sin
-- avisar. El día que alguien cruce ese techo el filtro perdería tipos y no
-- habría ningún error que lo delate. Esto devuelve ~20 filas siempre.
--
-- `LANGUAGE sql` con `SET search_path` es la combinación que la regla 4 de
-- CLAUDE.md marca como peligrosa —nace con plan genérico y nunca ve un valor—,
-- pero eso exige ADEMÁS que el plan bueno dependa de los ARGUMENTOS. Esta no
-- tiene argumentos, así que no hay plan personalizado que pedir y forzarlo sólo
-- costaría replanificar.
CREATE OR REPLACE FUNCTION public.mis_tipos_de_notificacion()
RETURNS TABLE (type text)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, extensions
AS $$
    SELECT DISTINCT n.type
    FROM public.notifications n
    ORDER BY 1;
$$;

REVOKE EXECUTE ON FUNCTION public.mis_tipos_de_notificacion() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.mis_tipos_de_notificacion() TO authenticated, service_role;
