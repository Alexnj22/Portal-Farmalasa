-- Índice por fecha en `inventory_sync_log` (2026-11-04).
--
-- `v_sync_health` (pantalla Estado de sincronización) pide los últimos N de
-- cada dominio con `ORDER BY checked_at DESC LIMIT n`. Para «inventory» eso es
-- `inventory_sync_log` (781,000 filas, 90 días de retención), y la tabla sólo
-- tenía índices que EMPIEZAN por `is_vencidos` o por sucursal: ninguno sirve
-- para ordenar todo por fecha, así que barría la tabla entera. 2,388 ms;
-- pg_stat_statements daba máximos de 17 s.
--
-- Con el índice: 1 ms. Se creó con CONCURRENTLY por fuera de la transacción
-- (la tabla se escribe cada minuto): acá queda como no-op.
SET lock_timeout = '5s';

CREATE INDEX IF NOT EXISTS idx_inventory_sync_log_synced_at ON public.inventory_sync_log (synced_at DESC);
