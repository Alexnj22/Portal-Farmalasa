-- Add unique constraint on erp_minmax natural key to enable UPSERT
ALTER TABLE erp_minmax
  ADD COLUMN IF NOT EXISTS synced_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS erp_minmax_natural_key_idx
  ON erp_minmax (erp_sucursal_id, erp_product_id, erp_presentacion_id)
  WHERE erp_presentacion_id IS NOT NULL;
