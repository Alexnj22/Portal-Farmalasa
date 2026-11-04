-- Índice por tipo de documento en `sales_invoices` (2026-11-04).
--
-- El cron `reenviar-ccf-10min` (regularizar-dte con `tipo: 'CCF'`) pide los CCF
-- sin sello válido, y lo hace DOS veces por corrida (la lista y el conteo
-- exacto). Sin índice por `tipo_documento`, cada una era un Parallel Seq Scan
-- de 402,000 facturas para encontrar entre 757 CCF en total: 17,604 bloques
-- (10,506 de disco) y 812 ms. pg_stat_statements la daba en 1.5 s de promedio
-- y 10–16 s de máximo, 108 corridas al día.
--
-- Con el índice: Index Scan, 635 bloques y 1 ms. Columna simple y no parcial a
-- propósito: PostgREST manda `tipo_documento = $7` como parámetro, y un índice
-- parcial `WHERE tipo_documento = 'CCF'` no lo podría usar el plan genérico.
--
-- El índice se creó con CONCURRENTLY por fuera de la transacción (tabla
-- caliente, CLAUDE.md): acá queda como no-op.
SET lock_timeout = '5s';

CREATE INDEX IF NOT EXISTS idx_si_tipo_documento_fecha ON public.sales_invoices (tipo_documento, fecha);
