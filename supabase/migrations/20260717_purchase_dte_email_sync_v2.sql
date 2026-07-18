-- Facturas de compra — ajustes de esquema tras ronda de diseño (2026-07-17)
-- 1. Credenciales Gmail por cuenta (cada cuenta tiene su propio client_id/secret de GCP)
-- 2. supplier_id real en purchase_dte_documents (permite match manual desde la UI)
-- 3. Cola de PDFs sin JSON o sin match de nombre de archivo (antes se descartaban en silencio)
SET lock_timeout = '5s';

ALTER TABLE public.email_sync_accounts
    ADD COLUMN client_id_secret_name text,
    ADD COLUMN client_secret_secret_name text;

ALTER TABLE public.purchase_dte_documents
    ADD COLUMN supplier_id bigint REFERENCES public.suppliers(id);

CREATE INDEX idx_purchase_dte_docs_supplier ON public.purchase_dte_documents (supplier_id);

CREATE TABLE public.purchase_dte_unmatched_pdfs (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    pdf_path text NOT NULL,
    account_id bigint NOT NULL REFERENCES public.email_sync_accounts(id),
    source_message_id text,
    from_email text,
    subject text,
    received_at timestamptz,
    status text NOT NULL DEFAULT 'pendiente' CHECK (status IN ('pendiente','emparejado','descartado')),
    matched_document_id bigint REFERENCES public.purchase_dte_documents(id),
    ai_suggested jsonb,
    resolved_by uuid REFERENCES public.employees(id),
    resolved_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_purchase_dte_unmatched_account ON public.purchase_dte_unmatched_pdfs (account_id);
CREATE INDEX idx_purchase_dte_unmatched_status ON public.purchase_dte_unmatched_pdfs (status);
CREATE INDEX idx_purchase_dte_unmatched_matched_doc ON public.purchase_dte_unmatched_pdfs (matched_document_id);

ALTER TABLE public.purchase_dte_unmatched_pdfs ENABLE ROW LEVEL SECURITY;

CREATE POLICY purchase_dte_unmatched_select ON public.purchase_dte_unmatched_pdfs
    FOR SELECT TO authenticated
    USING ((SELECT auth_has_module_permission('facturas_compra', 'can_view')));

CREATE POLICY purchase_dte_unmatched_update ON public.purchase_dte_unmatched_pdfs
    FOR UPDATE TO authenticated
    USING ((SELECT auth_can_edit_any(ARRAY['facturas_compra'])))
    WITH CHECK ((SELECT auth_can_edit_any(ARRAY['facturas_compra'])));
