SET lock_timeout = '5s';

-- Se da de baja `contar_facturas_sala`. Su cuerpo era, literalmente:
--
--     SELECT count(*) FROM public.get_facturas_sala(p_branch_id, p_dias, false) f
--      WHERE f.estado IN ('disponible', 'mia_linea');
--
-- O sea que para devolver UN entero corría la consulta pesada completa y
-- materializaba las 17 columnas de cada fila, `items_text` incluido —
-- `get_facturas_sala` es plpgsql y devuelve SETOF, así que no se puede inlinear
-- y el planificador no tiene forma de podar las columnas que el count no mira.
--
-- El widget la llamaba dos veces por apertura (al montar el tablero y otra vez
-- al final de cada carga de la lista), o sea dos ejecuciones enteras de más por
-- cada vuelta. Desde 2026-08-07 la baldosa trae la lista una sola vez y cuenta
-- esas filas en el navegador: el mismo número, sin el segundo viaje.
--
-- Verificado antes de borrar: ninguna otra función del esquema la menciona,
-- ningún job de cron la invoca y en el repo no queda un solo llamador.
--
-- Si alguna vez hace falta un conteo del lado del servidor, NO se recrea así:
-- se escribe su propia consulta sin las columnas de payload. Contar reusando
-- una función que devuelve filas anchas es el defecto, no el atajo.
DROP FUNCTION IF EXISTS public.contar_facturas_sala(bigint, integer);
