-- `puntos_archivo_cerrar` leía 7 GB por llamada (`gate:perf` sección F,
-- 2026-09-26) y corre cada noche a las 22:30 SV (`puntos-archivar-noche`)
-- hasta el arranque del 1-oct.
--
-- El costo estaba en heredar las asignaciones de la carga anterior:
--   … FROM puntos_archivo_cliente o
--    WHERE o.carga_id <> p_carga AND o.id_cliente = n.id_cliente
--      AND o.asignada_a IS NOT NULL
-- Los dos índices de la tabla empiezan por `carga_id`, y con `<>` no hay por
-- dónde entrar: el planificador usaba la llave (carga_id, id_cliente) sólo
-- por su SEGUNDA columna, o sea recorriéndola entera por cada uno de los
-- 14,687 clientes. Reproducido con BEGIN…ROLLBACK: 3,386,846 bloques y 15 s.
-- Con este índice, 163,982 bloques y 0.28 s (−95%), mismo plan en todo lo
-- demás. Parcial: sólo las filas ya asignadas, que son las únicas que la
-- consulta busca. No cambia ninguna función.

SET lock_timeout = '5s';

CREATE INDEX IF NOT EXISTS puntos_archivo_cliente_por_cliente_asignado
    ON public.puntos_archivo_cliente (id_cliente)
 WHERE asignada_a IS NOT NULL;