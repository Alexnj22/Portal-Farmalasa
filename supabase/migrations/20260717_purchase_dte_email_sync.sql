-- Facturas de compra recibidas por correo (DTE JSON + PDF)
-- Tablas base + bucket privado para sync-purchase-emails
SET lock_timeout = '5s';

-- 1. Cuentas de correo sincronizadas (los refresh tokens viven en Vault, aquí solo la referencia)
CREATE TABLE public.email_sync_accounts (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    email text NOT NULL UNIQUE,
    provider text NOT NULL DEFAULT 'gmail' CHECK (provider IN ('gmail')),
    vault_secret_name text NOT NULL,
    last_synced_date timestamptz,
    active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.email_sync_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY email_sync_accounts_select ON public.email_sync_accounts
    FOR SELECT TO authenticated
    USING ((SELECT auth_has_module_permission('facturas_compra', 'can_view')));

-- 2. Documentos DTE recibidos
CREATE TABLE public.purchase_dte_documents (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    codigo_generacion text NOT NULL UNIQUE,
    tipo_dte text NOT NULL,
    numero_control text,
    emisor_nit text,
    emisor_nrc text,
    emisor_nombre text,
    fecha_emision date,
    monto_total numeric(14,2),
    total_iva numeric(14,2),
    json_path text NOT NULL,
    pdf_path text,
    account_id bigint NOT NULL REFERENCES public.email_sync_accounts(id),
    from_email text,
    source_message_id text,
    received_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_purchase_dte_docs_fecha ON public.purchase_dte_documents (fecha_emision DESC);
CREATE INDEX idx_purchase_dte_docs_emisor ON public.purchase_dte_documents (emisor_nit);
CREATE INDEX idx_purchase_dte_docs_tipo ON public.purchase_dte_documents (tipo_dte);
CREATE INDEX idx_purchase_dte_docs_account ON public.purchase_dte_documents (account_id);

ALTER TABLE public.purchase_dte_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY purchase_dte_docs_select ON public.purchase_dte_documents
    FOR SELECT TO authenticated
    USING ((SELECT auth_has_module_permission('facturas_compra', 'can_view')));

-- 3. Bucket privado para JSON + PDF
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('purchase-dte', 'purchase-dte', false, 10485760, ARRAY['application/json', 'application/pdf'])
ON CONFLICT (id) DO NOTHING;

CREATE POLICY purchase_dte_storage_select ON storage.objects
    FOR SELECT TO authenticated
    USING (
        bucket_id = 'purchase-dte'
        AND (SELECT auth_has_module_permission('facturas_compra', 'can_view'))
    );
