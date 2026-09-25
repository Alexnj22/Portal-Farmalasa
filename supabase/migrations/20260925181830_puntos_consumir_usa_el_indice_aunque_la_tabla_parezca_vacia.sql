SET lock_timeout = '5s';

-- Medido el 2026-09-25 en el ensayo real de la migración (transacción que se
-- deshizo): cada tanda de 1,000 cuentas pasó de 3.6 s a 22 s entre un ensayo y
-- el siguiente, sin cambiar el SQL de las consultas. `track_functions` lo
-- ubicó: `puntos_consumir` — 15 ms por canje.
--
-- La causa es de ESTADÍSTICA, no de SQL: después de los ensayos deshechos,
-- `puntos_lote` quedó con `reltuples = 0, relpages = 0`. Durante la migración
-- la tabla crece de 0 a ~120,000 filas DENTRO de la transacción, y el
-- planificador, creyéndola vacía, recorre la tabla entera por cada cliente en
-- vez de usar `puntos_lote_fifo`, que es exactamente su índice. El 1-oct la
-- tabla va a estar en ese mismo estado: vacía en las estadísticas y llenándose
-- en la corrida.
--
-- Estas dos funciones buscan SIEMPRE los lotes de UN cliente: el índice es la
-- respuesta correcta a cualquier tamaño, así que se fija. Medido con el cambio:
-- 3.6 s y 2.2 s por tanda.
ALTER FUNCTION public.puntos_consumir(bigint, integer, bigint) SET enable_seqscan = off;
ALTER FUNCTION public.puntos_migrar_cuenta_anterior(bigint, bigint, bigint, text, uuid, text) SET enable_seqscan = off;
