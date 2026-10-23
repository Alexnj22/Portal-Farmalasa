-- Pendiente MH (`get_pending_mh_invoices`) leía 46,523 bloques (363 MB) por
-- llamada y tardaba 300–4,000 ms en las primeras cinco de cada sesión. El SQL
-- estaba bien y el índice parcial `idx_si_sin_sello_valido` ya existía: lo que
-- fallaba era la ESTIMACIÓN. Sin estadística de `length(recibido_mh)`, el
-- planificador creía que 153,719 facturas no tenían sello cuando son ~500, y
-- elegía recorrer `idx_si_branch_fecha_full` en el orden del ORDER BY
-- descartando 197,004 filas. (Desde la sexta llamada el plan genérico acertaba
-- de casualidad: 20 ms.) Es el caso de `acumula_puntos` del 01-sep: un valor
-- casi siempre igual donde el default miente.
--
-- CREATE STATISTICS toma ShareUpdateExclusiveLock: no bloquea lecturas ni
-- escrituras de los syncs. ANALYZE tampoco.
SET lock_timeout = '5s';
CREATE STATISTICS IF NOT EXISTS public.st_sales_invoices_largo_del_sello
  ON (length(recibido_mh)) FROM public.sales_invoices;
ANALYZE public.sales_invoices;
