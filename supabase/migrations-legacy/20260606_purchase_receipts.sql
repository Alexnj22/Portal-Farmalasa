-- Tablas para sincronizar compras/recepciones del ERP.
-- Alimentan el cálculo de denominador dinámico en MinMax
-- (días con existencias, detección de stockouts, fecha primer ingreso).

-- ── Cabecera de compra ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS purchase_receipts (
  id               serial        PRIMARY KEY,
  erp_purchase_id  integer       NOT NULL,
  branch_id        integer       NOT NULL REFERENCES branches(id),
  erp_sucursal_id  integer       NOT NULL,
  fecha            date          NOT NULL,
  proveedor        text,
  estado           text,
  subtotal         numeric(12,2) DEFAULT 0,
  iva              numeric(12,2) DEFAULT 0,
  total            numeric(12,2) DEFAULT 0,
  updated_at       timestamptz   DEFAULT now(),
  UNIQUE (erp_purchase_id, erp_sucursal_id)
);

CREATE INDEX IF NOT EXISTS idx_purchase_receipts_fecha           ON purchase_receipts (fecha);
CREATE INDEX IF NOT EXISTS idx_purchase_receipts_erp_sucursal    ON purchase_receipts (erp_sucursal_id);

-- ── Líneas de compra ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS purchase_receipt_items (
  id                 serial      PRIMARY KEY,
  receipt_id         integer     NOT NULL REFERENCES purchase_receipts(id) ON DELETE CASCADE,
  linea_num          integer     NOT NULL,
  erp_product_id     integer     REFERENCES products(id),
  descripcion        text,
  cantidad           numeric(10,3) DEFAULT 0,
  precio_unitario    numeric(12,4) DEFAULT 0,
  total_linea        numeric(12,2) DEFAULT 0,
  lote               text,
  fecha_vencimiento  date,
  UNIQUE (receipt_id, linea_num)
);

CREATE INDEX IF NOT EXISTS idx_purchase_items_product  ON purchase_receipt_items (erp_product_id);
CREATE INDEX IF NOT EXISTS idx_purchase_items_receipt  ON purchase_receipt_items (receipt_id);
CREATE INDEX IF NOT EXISTS idx_purchase_items_lote     ON purchase_receipt_items (lote) WHERE lote IS NOT NULL;

-- ── Log de sincronización ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS purchase_sync_log (
  id               serial      PRIMARY KEY,
  synced_at        timestamptz DEFAULT now(),
  branch_id        integer,
  erp_sucursal_id  integer,
  fini             date,
  ffin             date,
  receipts_total   integer     DEFAULT 0,
  receipts_new     integer     DEFAULT 0,
  items_inserted   integer     DEFAULT 0,
  success          boolean     DEFAULT true,
  error_msg        text
);

-- ── RLS ───────────────────────────────────────────────────────────────────────
ALTER TABLE purchase_receipts       ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_receipt_items  ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_sync_log       ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated read purchase_receipts"
  ON purchase_receipts FOR SELECT TO authenticated USING (true);

CREATE POLICY "service full purchase_receipts"
  ON purchase_receipts FOR ALL TO service_role USING (true);

CREATE POLICY "authenticated read purchase_receipt_items"
  ON purchase_receipt_items FOR SELECT TO authenticated USING (true);

CREATE POLICY "service full purchase_receipt_items"
  ON purchase_receipt_items FOR ALL TO service_role USING (true);

CREATE POLICY "authenticated read purchase_sync_log"
  ON purchase_sync_log FOR SELECT TO authenticated USING (true);

CREATE POLICY "service full purchase_sync_log"
  ON purchase_sync_log FOR ALL TO service_role USING (true);
