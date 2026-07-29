-- ============================================================
-- DB AUDIT CLEANUP v4 — Normalizar product_costs (2026-05-17)
-- La tabla tenía 0 filas y no estaba referenciada en el código.
-- presentacion TEXT → presentacion_id INTEGER FK presentaciones(id)
-- ============================================================

ALTER TABLE product_costs DROP CONSTRAINT IF EXISTS product_costs_product_id_presentacion_key;
ALTER TABLE product_costs DROP COLUMN IF EXISTS presentacion;

ALTER TABLE product_costs
  ADD COLUMN presentacion_id integer NOT NULL REFERENCES presentaciones(id) ON DELETE RESTRICT;

ALTER TABLE product_costs
  ADD CONSTRAINT product_costs_product_id_presentacion_id_key
  UNIQUE (product_id, presentacion_id);
