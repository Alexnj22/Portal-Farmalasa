-- F7 (parte 3) · Las ventas anuladas con puntos dejan de recorrer el índice
-- entero de facturas.
--
-- `puntos_ventas_anuladas` corre cada minuto desde `sync-puntos` y busca las
-- facturas que se mandaron a puntos y después se anularon. Para hallar las
-- 1,066 no finalizadas recorría entero `idx_si_fecha_estado_branch` —373,856
-- entradas— filtrando por `estado <> 'FINALIZADA'`: medido el 2026-09-22,
-- **13,113 bloques y 67 ms por corrida**, o sea 0.6 TB por semana para no
-- encontrar, casi siempre, nada.
--
-- El índice parcial contiene sólo esas 1,066 filas. No cambia ningún resultado:
-- es el mismo predicado.
--
-- Mismo razonamiento de lock que `pendiente_mh_indice_sin_sello_valido`, que se
-- aplicó minutos antes: SHARE no frena lecturas, `lock_timeout` cubre el choque
-- con un sync, y van en migraciones separadas para no sostener el lock el doble.
--
-- Medido después: **13,113 → 5,249 bloques, 67 → 11 ms**. Lo que queda son los
-- 1,067 sondeos a `puntos_enviados` por clave primaria, que es el trabajo real.
SET lock_timeout = '5s';

CREATE INDEX IF NOT EXISTS idx_si_no_finalizada
    ON public.sales_invoices (id)
 WHERE estado <> 'FINALIZADA';
