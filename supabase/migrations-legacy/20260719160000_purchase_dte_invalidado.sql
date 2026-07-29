-- Facturas de Compra: marca de invalidación (v2.23.9)
-- Los correos de "invalidación" (proveedor anula un CCF/factura ya emitido)
-- llegan como un JSON con esquema propio (identificacion/emisor/documento/
-- motivo, distinto al DTE normal) y hasta ahora caían sin distinción a
-- purchase_dte_review_queue junto con JSON genuinamente inválido/roto, sin
-- quedar conectados al documento original que invalidan.
SET lock_timeout = '5s';

ALTER TABLE purchase_dte_documents
  ADD COLUMN IF NOT EXISTS invalidado boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS invalidado_motivo text,
  ADD COLUMN IF NOT EXISTS invalidado_at timestamptz;
