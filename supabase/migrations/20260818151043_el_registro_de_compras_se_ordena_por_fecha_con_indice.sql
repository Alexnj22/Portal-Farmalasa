SET lock_timeout = '5s';

-- La pantalla de Estado de sincronización barría 24,617 filas cada 30 segundos.
--
-- `v_sync_health` une siete registros de sincronización. La pantalla pide los
-- cuatro que no tienen monitoreo propio, ordenados por fecha y con tope de 200,
-- y **repregunta cada 30 segundos** mientras alguien la tenga abierta.
--
-- Tres de esos cuatro resuelven por índice (`idx_products_sync_log_checked_at`,
-- `idx_minmax_sync_log_checked_at`, `idx_backup_sync_log_checked_at`).
-- `purchase_sync_log` era el único sin índice por fecha —sólo tenía su llave
-- primaria— así que hacía Seq Scan de 24,617 filas más una ordenación top-N
-- para devolver 175. Medido: **171.7 ms**, cada media MINUTO, por cada persona
-- con la pantalla abierta.
--
-- Su columna se llama `synced_at` y no `checked_at`, que es probablemente por
-- qué se pasó por alto cuando se indexaron las otras tres.
--
-- La tabla son 21,537 filas y 2.6 MB, así que el índice entra en milisegundos y
-- no hace falta CONCURRENTLY.
--
-- Medido después: **171.7 ms → 1.536 ms**, bloques 261 → 12, y los cuatro
-- registros entrando por índice.
CREATE INDEX IF NOT EXISTS idx_purchase_sync_log_synced_at
  ON public.purchase_sync_log (synced_at DESC);

ANALYZE public.purchase_sync_log;
