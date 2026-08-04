-- La retención de IVA que el cliente nos practicó sobre la venta (Art. 162 CT).
-- El origen la manda desde el 2026-08-03 en `totales.retencion`, y junto con
-- ella corrigió `subtotal`/`iva`: antes repartía el total NETO entre base y
-- débito, ahora manda la base y el débito reales.  El `total` no cambió.
--
-- 0 y no NULL: "sin retención" es un hecho, no un dato que falte.
SET lock_timeout = '5s';

ALTER TABLE public.sales_invoices
    ADD COLUMN IF NOT EXISTS retencion numeric NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.sales_invoices.retencion IS
    'Retención de IVA practicada por el cliente (Art. 162 CT). subtotal + iva - retencion = total.';
