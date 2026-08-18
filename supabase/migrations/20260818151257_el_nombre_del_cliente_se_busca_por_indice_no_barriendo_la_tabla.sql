SET lock_timeout = '5s';

-- El sync de facturas barría las 26,266 fichas de cliente, cada minuto.
--
-- `sync-dte-sales` corre cada minuto por sucursal y necesita saber qué nombres
-- de cliente ya conoce el portal, así que pregunta
-- `SELECT name FROM customers WHERE name = ANY (<lista>)`.
--
-- `customers` tiene cinco índices y NINGUNO sirve para eso: el único sobre el
-- nombre es `customers_name_norm_idx`, que indexa `upper(trim(name))` —una
-- EXPRESIÓN— y no puede resolver una comparación contra `name` a secas. Así que
-- el plan real es Seq Scan con **27,860 filas descartadas por consulta**.
--
-- Medido el 2026-08-18: 1,063 llamadas, **89.1 ms de media y pico de 3,102 ms**,
-- 94.8 s acumulados. Es de los pocos consumos que crecen solos: cuantas más
-- fichas de cliente, más caro cada minuto de cada sucursal.
--
-- Se arregla con un índice y no tocando la función: redesplegar una edge
-- function tiene su propia trampa (`--no-verify-jwt`, que ya rompió el cron
-- tres veces), y acá no hace falta correr ese riesgo para ganar lo mismo.
--
-- La tabla son 26,266 filas y 15 MB, así que el índice entra en milisegundos.
--
-- Medido después: el plan pasa a Index Only Scan y la consulta de **89.1 ms a
-- 0.78 ms** de promedio (mejor 0.48, peor 1.72 sobre 5 corridas).
CREATE INDEX IF NOT EXISTS idx_customers_name
  ON public.customers (name);

ANALYZE public.customers;
