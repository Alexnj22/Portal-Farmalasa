-- Upgrade covering indexes on sales_invoices to include total, hora, has_puntos
-- so get_ventas_stats and get_puntos_canjeados can also Index Only Scan.
-- Drops the narrower _covering variants created earlier in this session.

DROP INDEX IF EXISTS public.idx_si_fecha_covering;
DROP INDEX IF EXISTS public.idx_si_branch_fecha_covering;

-- All-branch path: filter by fecha, return everything get_ventas_stats + get_puntos_canjeados need
CREATE INDEX IF NOT EXISTS idx_si_fecha_full
    ON public.sales_invoices (fecha)
    INCLUDE (estado, branch_id, tipo_documento, total, hora, has_puntos);

-- Single-branch path: filter by branch_id + fecha
CREATE INDEX IF NOT EXISTS idx_si_branch_fecha_full
    ON public.sales_invoices (branch_id, fecha)
    INCLUDE (estado, tipo_documento, total, hora, has_puntos);
