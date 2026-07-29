-- Covering indexes to eliminate heap fetches in the pres CTE of get_product_sales_agg
--
-- Before these indexes, each of the 12,516 per-invoice lookups on sales_invoice_items
-- read from heap (51,343 buffer hits) to get erp_product_id, descripcion, etc.
-- Similarly, sales_invoices heap was read for estado/branch_id/tipo_documento.
-- Result: ~1,300ms in the pres CTE alone.
--
-- After: Index Only Scans — no heap access, ~258ms total (all branches) / 52ms (one branch).

-- Eliminates 51,343 buffer hits in the Nested Loop inner scan on sales_invoice_items
CREATE INDEX IF NOT EXISTS idx_sii_invoice_covering
    ON public.sales_invoice_items (invoice_id)
    INCLUDE (erp_product_id, descripcion, presentacion, cantidad, total_linea);

-- Eliminates heap fetch for estado/tipo_documento when filtering by fecha (all-branches path)
CREATE INDEX IF NOT EXISTS idx_si_fecha_covering
    ON public.sales_invoices (fecha)
    INCLUDE (estado, branch_id, tipo_documento);

-- Eliminates heap fetch for estado/tipo_documento when filtering by branch_id+fecha
CREATE INDEX IF NOT EXISTS idx_si_branch_fecha_covering
    ON public.sales_invoices (branch_id, fecha)
    INCLUDE (estado, tipo_documento);
