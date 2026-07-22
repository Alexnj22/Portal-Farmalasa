-- Fase 3.1 (PLAN-MEJORAS-DTE-PROVEEDORES-2026-07.md): integridad del DTE
-- conservado (Decreto 487 Art. 3 — "garantizando su consulta e integridad").
-- orig_json_path guarda el adjunto crudo tal cual llegó (sin unwrapDteEnvelope
-- ni repairMojibakeDeep) como respaldo — json_path (normalizado) sigue siendo
-- la fuente que lee el portal para visualización y búsqueda (items_text).
-- sello_recibido captura la evidencia de recepción del MH cuando el
-- proveedor manda el sobre {selloRecibido, firmaElectronica, dteJson}.
SET lock_timeout = '5s';

ALTER TABLE public.purchase_dte_documents
  ADD COLUMN IF NOT EXISTS orig_json_path text,
  ADD COLUMN IF NOT EXISTS sello_recibido text;

COMMENT ON COLUMN public.purchase_dte_documents.orig_json_path IS
  'Bytes originales del adjunto/link tal cual llegaron, sin unwrapDteEnvelope ni repairMojibakeDeep — respaldo de integridad (Decreto 487 Art. 3). json_path (normalizado) es la fuente para UI/búsqueda; este campo no se expone en get_purchase_dte_documents.';
