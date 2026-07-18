-- Facturas de compra — generaliza purchase_dte_unmatched_pdfs (recién creada,
-- 0 filas en staging/prod, seguro reemplazarla) a una cola de revisión que cubre
-- 2 casos, no solo PDFs huérfanos:
--   a) orphan_pdf: PDF sin JSON en el correo, o sin match de nombre de archivo
--   b) invalid_json: adjunto .json que no parsea o no pasa la validación mínima
--      de DTE (incluye "documentos de invalidación", que tienen otro esquema)
-- Feedback del usuario (2026-07-17): quiere poder "descartar" desde la vista
-- también los invalid_json (antes solo vivían como texto en el log, sin fila).
SET lock_timeout = '5s';

DROP TABLE public.purchase_dte_unmatched_pdfs;

CREATE TABLE public.purchase_dte_review_queue (
    id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    kind                text NOT NULL CHECK (kind IN ('orphan_pdf', 'invalid_json')),
    file_path           text NOT NULL,
    filename            text,
    reason              text,
    account_id          bigint NOT NULL REFERENCES public.email_sync_accounts(id),
    source_message_id   text,
    from_email          text,
    subject             text,
    received_at         timestamptz,
    status              text NOT NULL DEFAULT 'pendiente' CHECK (status IN ('pendiente', 'emparejado', 'descartado', 'confirmado')),
    matched_document_id bigint REFERENCES public.purchase_dte_documents(id),
    ai_suggested        jsonb,
    resolved_by         uuid REFERENCES public.employees(id),
    resolved_at         timestamptz,
    created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_purchase_dte_review_account ON public.purchase_dte_review_queue (account_id);
CREATE INDEX idx_purchase_dte_review_status ON public.purchase_dte_review_queue (status);
CREATE INDEX idx_purchase_dte_review_kind ON public.purchase_dte_review_queue (kind);
CREATE INDEX idx_purchase_dte_review_matched_doc ON public.purchase_dte_review_queue (matched_document_id);

ALTER TABLE public.purchase_dte_review_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY purchase_dte_review_select ON public.purchase_dte_review_queue
    FOR SELECT TO authenticated
    USING ((SELECT auth_has_module_permission('facturas_compra', 'can_view')));

CREATE POLICY purchase_dte_review_update ON public.purchase_dte_review_queue
    FOR UPDATE TO authenticated
    USING ((SELECT auth_can_edit_any(ARRAY['facturas_compra'])))
    WITH CHECK ((SELECT auth_can_edit_any(ARRAY['facturas_compra'])));
