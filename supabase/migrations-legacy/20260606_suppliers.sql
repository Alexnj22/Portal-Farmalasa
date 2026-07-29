-- Tabla de proveedores extraída del ERP vía purchase_receipts.
-- Análoga a laboratorios: catálogo de quién vende a Farmalasa.

CREATE TABLE IF NOT EXISTS suppliers (
  id               serial        PRIMARY KEY,
  erp_supplier_id  integer       UNIQUE,           -- proveedor.id del ERP
  nombre           text          NOT NULL,
  nrc              text,                           -- registro IVA El Salvador
  created_at       timestamptz   DEFAULT now(),
  updated_at       timestamptz   DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_suppliers_erp_id ON suppliers (erp_supplier_id);
CREATE INDEX IF NOT EXISTS idx_suppliers_nombre ON suppliers (nombre);

-- Columna en purchase_receipts para FK al proveedor normalizado
ALTER TABLE purchase_receipts
  ADD COLUMN IF NOT EXISTS supplier_id integer REFERENCES suppliers(id),
  ADD COLUMN IF NOT EXISTS erp_supplier_id integer;

CREATE INDEX IF NOT EXISTS idx_purchase_receipts_supplier ON purchase_receipts (supplier_id);

-- RLS
ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated read suppliers"
  ON suppliers FOR SELECT TO authenticated USING (true);

CREATE POLICY "service full suppliers"
  ON suppliers FOR ALL TO service_role USING (true);
