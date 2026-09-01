SET lock_timeout = '5s';

-- ── El barrido de «no acumula» tumbó el portal ───────────────────────────────
-- `puntos_tickets_de_ficha_que_no_acumula` corre cada minuto (cron
-- `sync-puntos-1min`). Medido el 2026-09-01: **1,528,584 buffers y hasta
-- 12,963 ms por llamada** — para devolver `[]`.
--
-- El motivo no estaba en la consulta sino en una ESTIMACIÓN. `customers` no
-- tenía estadística útil para `acumula_puntos`, así que el planificador le
-- daba la selectividad por defecto de un booleano —la mitad, 14,042 de
-- 28,120— cuando la respuesta real es **UNA fila**. Creyendo que las
-- coincidencias abundaban, elegía recorrer `puntos_enviados` en el orden del
-- `ORDER BY` esperando llenar el `LIMIT 500` enseguida: 358,964 filas
-- recorridas, cada una con su búsqueda en `sales_invoices`, para terminar en
-- cero.
--
-- Un `ANALYZE` lo corrige (13.5 ms), pero dejarlo ahí sería apoyar el portal
-- en una estadística: `customers` son 28,120 filas y el autovacuum recién
-- analiza al 20% de cambio, o sea casi nunca. El índice parcial hace que el
-- plan bueno no dependa de que alguien haya medido a tiempo — y de paso quita
-- el Seq Scan de 967 buffers que quedaba como entrada.
--
-- Medido, misma llamada: 1,528,584 buffers / 2,868 ms → 2,445 / 13.5 ms.
CREATE INDEX IF NOT EXISTS idx_customers_no_acumulan
  ON public.customers (id)
  WHERE acumula_puntos = false;

ANALYZE public.customers;
