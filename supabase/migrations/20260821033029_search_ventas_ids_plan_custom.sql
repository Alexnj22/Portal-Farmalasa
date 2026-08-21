SET lock_timeout = '5s';

-- La búsqueda de Ventas deja de degradarse en la sexta llamada.
--
-- Medido el 2026-08-21, misma llamada siete veces seguidas sobre un rango de un
-- año, con los MISMOS argumentos:
--   #1 655 ms · #2 647 · #3 645 · #4 665 · #5 649 · #6 1,684 · #7 1,659
--
-- Es la trampa escrita en CLAUDE.md: plpgsql cambia al plan GENÉRICO en la
-- sexta ejecución de cada conexión. Sin los valores el planificador no sabe que
-- el rango de fechas filtra y elige el plan al revés. Cuando el plan bueno
-- depende de los ARGUMENTOS —y acá depende: el mismo texto sobre un día y sobre
-- un año son dos consultas distintas— no hay genérico que sirva.
--
-- La corrección se aplicó a get_ventas_receta_stats el 2026-08-17 (migración
-- 20260817175740)... que es una de las que LLAMA a ésta. La función caliente
-- quedó sin ella, y es el segundo mayor consumidor de la base: 77 llamadas,
-- 2,367 ms de promedio, 182 s en 6 horas = 10.5% del tiempo total.
--
-- Cuesta ~3 ms de planificación por llamada, contra ~1,000 ms de diferencia.
-- Probado antes en el branch staging (cbnjplmnfmfsambavjce).

ALTER FUNCTION public.search_ventas_ids(text, date, date)
  SET plan_cache_mode = 'force_custom_plan';
