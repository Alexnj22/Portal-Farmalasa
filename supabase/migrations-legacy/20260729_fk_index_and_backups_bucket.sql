-- FK sin índice + bucket sin límites (plan F4.6 y F4.3, 2026-07-29)
--
-- F4.6 — sales_invoices.customer_id era la única FK sin índice que NO es columna
-- de auditoría, sobre 336,592 filas. Las otras dos que quedan sin índice
-- (pedido_items.confirmado_suc_por y .rechazado_por) son `*_por` de auditoría en
-- tabla chica, exentas por la regla #2 del proyecto.
--
-- Se creó con CREATE INDEX CONCURRENTLY vía execute_sql, NO por apply_migration:
-- CONCURRENTLY no puede correr dentro de un bloque de transacción, y la variante
-- normal toma un lock SHARE que bloquea escrituras — inaceptable en una tabla que
-- recibe inserts cada minuto desde 6 sucursales. Acá queda la forma reproducible
-- para reconstruir desde cero; en prod es no-op porque el índice ya existe.
--
-- Es parcial (WHERE customer_id IS NOT NULL) porque la mayoría de las facturas
-- son consumidor final sin cliente identificado: 2.8 MB en vez de indexar nulls.
--
-- F4.3 — El bucket `backups` no tenía file_size_limit ni allowed_mime_types,
-- contra la regla #10. Los otros seis sí los tienen.

SET lock_timeout = '5s';

CREATE INDEX IF NOT EXISTS idx_sales_invoices_customer_id
  ON public.sales_invoices (customer_id) WHERE customer_id IS NOT NULL;

UPDATE storage.buckets
   SET file_size_limit    = 104857600,   -- 100 MB
       allowed_mime_types = ARRAY['application/json','application/gzip',
                                  'application/zip','text/csv',
                                  'application/octet-stream']
 WHERE id = 'backups'
   AND (file_size_limit IS NULL OR allowed_mime_types IS NULL);
