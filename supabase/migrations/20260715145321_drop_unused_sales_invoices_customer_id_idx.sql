SET lock_timeout = '5s';
-- Índice ya eliminado vía DROP INDEX CONCURRENTLY (no puede correr dentro de
-- una transacción de migración) — esta entrada es solo de seguimiento en el
-- historial. 0 scans registrados, 7.6MB, Bloque 4.5.
DROP INDEX IF EXISTS sales_invoices_customer_id_idx;
