SET lock_timeout = '5s';

-- Antes un adjunto .zip en un correo de compra se descartaba entero (warning
-- "no soportado v1"), perdiendo el DTE para siempre si el proveedor lo
-- mandaba empaquetado. sync-purchase-emails ahora lo abre en memoria y
-- extrae los .json/.pdf al mismo pipeline de matching — pero si el zip está
-- corrupto o protegido con contraseña (no se puede abrir), se guarda crudo y
-- se encola acá para que un humano lo revise, en vez de perderlo en silencio.
ALTER TABLE purchase_dte_review_queue DROP CONSTRAINT purchase_dte_review_queue_kind_check;
ALTER TABLE purchase_dte_review_queue ADD CONSTRAINT purchase_dte_review_queue_kind_check
  CHECK (kind = ANY (ARRAY['orphan_pdf'::text, 'invalid_json'::text, 'invalidacion_pendiente'::text, 'orphan_zip'::text]));
