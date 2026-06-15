-- Reglas de despacho basadas en presentación: 2 columnas nuevas en dispatch_rules.
-- dispatch_id_presentacion: FK a presentaciones(id) — presentación seleccionada para agrupar el despacho.
-- dispatch_multiplo: cuántas unidades de esa presentación por lote (default=1).
-- El RPC get_pedido_preview v15 usa estos campos con la fórmula universal:
--   CEIL(raw * d.factor / (dp_factor * dp_multiplo)) * dp_factor * dp_multiplo / d.factor
-- Las columnas legacy (solo_cajas, multiplo, blister, multiplo_unidades) quedan como fallback.

ALTER TABLE dispatch_rules
  ADD COLUMN IF NOT EXISTS dispatch_id_presentacion integer REFERENCES presentaciones(id),
  ADD COLUMN IF NOT EXISTS dispatch_multiplo smallint DEFAULT 1 CHECK (dispatch_multiplo >= 1);
