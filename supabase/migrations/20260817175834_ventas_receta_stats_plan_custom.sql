SET lock_timeout = '5s';

-- `get_ventas_receta_stats` estaba bien las primeras CINCO veces y mal desde la
-- sexta. Medido, ocho llamadas seguidas con los mismos argumentos:
--
--   1: 45 ms   2: 25 ms   3: 23 ms   4: 23 ms   5: 24 ms
--   6: 1,089 ms   7: 1,095 ms   8: 1,105 ms
--
-- Es plpgsql cambiando al PLAN GENÉRICO, que es lo que hace a partir de la
-- sexta ejecución del mismo statement. Sin los valores de p_fini/p_ffin el
-- planificador supone que el rango de fechas no filtra casi nada, y vuelve a
-- entrar por las ~180,000 facturas del año en vez de por los 4,013 renglones
-- con receta. El plan bueno depende de los ARGUMENTOS, así que acá no hay plan
-- genérico que sirva.
--
-- `force_custom_plan` lo obliga a replanificar cada vez. Cuesta ~3 ms de
-- planificación contra el segundo que ahorra.
--
-- Su gemela `get_ventas_con_receta` no lo necesita: arma el SQL a mano y lo
-- corre con EXECUTE, que replanifica siempre (medido: 53 ms parejos en las
-- ocho llamadas). Dos caminos distintos al mismo requisito.
--
-- Lo que esto deja como enseñanza: medir UNA vez no dice nada de una función
-- con parámetros. La primera medición y la sexta contestan cosas distintas.

ALTER FUNCTION public.get_ventas_receta_stats(date, date, bigint, text, text)
    SET plan_cache_mode = 'force_custom_plan';
