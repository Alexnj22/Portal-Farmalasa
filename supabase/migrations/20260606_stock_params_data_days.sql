-- Agrega columnas para rastrear días efectivos usados en el cálculo de velocidad.
-- draft_data_days: días usados en el borrador (< analysis_days para productos nuevos)
-- data_days: días usados en el último cálculo publicado
ALTER TABLE product_stock_params
  ADD COLUMN IF NOT EXISTS draft_data_days integer,
  ADD COLUMN IF NOT EXISTS data_days       integer;
