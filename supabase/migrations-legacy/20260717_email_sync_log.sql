-- Facturas de compra — tabla de log dedicada (patrón bloque7B, NO reusar sync_log
-- genérico: está acoplado a semántica de ventas DTE, branch_id/fini/ffin NOT NULL).
SET lock_timeout = '5s';

CREATE TABLE public.email_sync_log (
    id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    account_id          bigint REFERENCES public.email_sync_accounts(id),
    source              text,
    checked_at          timestamptz NOT NULL DEFAULT now(),
    success             boolean NOT NULL,
    error_msg           text,
    messages_scanned    integer,
    documents_inserted  integer,
    documents_skipped   integer,
    pdfs_unmatched      integer,
    created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_email_sync_log_checked_at ON public.email_sync_log (checked_at DESC);
CREATE INDEX idx_email_sync_log_account ON public.email_sync_log (account_id);

ALTER TABLE public.email_sync_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY email_sync_log_select ON public.email_sync_log
    FOR SELECT TO authenticated
    USING ((SELECT auth_has_module_permission('sync_health', 'can_view')));

REVOKE ALL ON public.email_sync_log FROM anon;
GRANT SELECT ON public.email_sync_log TO authenticated, service_role;
GRANT INSERT ON public.email_sync_log TO service_role;

CREATE OR REPLACE VIEW public.v_sync_health WITH (security_invoker = true) AS
  SELECT 'dte'::text AS domain, NULL::text AS source,
    branch_id::bigint AS branch_id, NULL::integer AS erp_sucursal_id,
    ran_at AS checked_at, success, error_msg
  FROM public.sync_log
  UNION ALL
  SELECT 'inventory', NULL,
    NULL::bigint, erp_sucursal_id::integer,
    synced_at, success, error_msg
  FROM public.inventory_sync_log
  UNION ALL
  SELECT 'purchases', NULL,
    branch_id::bigint, erp_sucursal_id::integer,
    synced_at, success, error_msg
  FROM public.purchase_sync_log
  UNION ALL
  SELECT 'products', NULL,
    NULL::bigint, NULL::integer,
    checked_at, success, error_msg
  FROM public.products_sync_log
  UNION ALL
  SELECT 'minmax', source,
    NULL::bigint, erp_sucursal_id::integer,
    checked_at, success, error_msg
  FROM public.minmax_sync_log
  UNION ALL
  SELECT 'backup', NULL,
    NULL::bigint, NULL::integer,
    checked_at, success, error_msg
  FROM public.backup_sync_log
  UNION ALL
  SELECT 'email', source,
    NULL::bigint, NULL::integer,
    checked_at, success, error_msg
  FROM public.email_sync_log;

COMMENT ON COLUMN public.email_sync_accounts.vault_secret_name IS
  'Nombre del secret de la edge function (Deno.env.get), pese al nombre de la columna NO es un secret de Supabase Vault — mismo patrón que ERP_PURCHASES_CREDS/GEMINI_API_KEY.';
