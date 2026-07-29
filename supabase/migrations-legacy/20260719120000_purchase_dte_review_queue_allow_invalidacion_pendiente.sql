SET lock_timeout = '5s';

ALTER TABLE public.purchase_dte_review_queue
  DROP CONSTRAINT purchase_dte_review_queue_kind_check;

ALTER TABLE public.purchase_dte_review_queue
  ADD CONSTRAINT purchase_dte_review_queue_kind_check
  CHECK (kind = ANY (ARRAY['orphan_pdf'::text, 'invalid_json'::text, 'invalidacion_pendiente'::text]));
