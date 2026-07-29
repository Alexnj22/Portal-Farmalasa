-- Fix: erp_minmax upserts were silently failing because ON CONFLICT requires a real
-- unique constraint, not a partial unique index. The partial index
-- (WHERE erp_presentacion_id IS NOT NULL) is not usable by ON CONFLICT DO UPDATE.
-- The sync function already skips rows with null erp_presentacion_id, so a full
-- unique constraint is safe. This unblocks sync-erp-minmax and populates the table.
DROP INDEX IF EXISTS public.erp_minmax_natural_key_idx;

ALTER TABLE public.erp_minmax
  ADD CONSTRAINT erp_minmax_natural_key
  UNIQUE (erp_sucursal_id, erp_product_id, erp_presentacion_id);
