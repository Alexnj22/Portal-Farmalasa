-- Facturas de compra — seeds: cuentas Gmail conectadas + permisos del módulo
SET lock_timeout = '5s';

INSERT INTO public.email_sync_accounts (email, provider, vault_secret_name, client_id_secret_name, client_secret_secret_name, active)
VALUES
    ('farmasalud.sv@gmail.com', 'gmail', 'GMAIL_RT_1', 'GMAIL_CLIENT_ID_1', 'GMAIL_CLIENT_SECRET_1', true),
    ('compraslasalud.sv@gmail.com', 'gmail', 'GMAIL_RT_2', 'GMAIL_CLIENT_ID_2', 'GMAIL_CLIENT_SECRET_2', true)
ON CONFLICT (email) DO NOTHING;

INSERT INTO public.role_permissions (role_id, module_key, can_view, can_edit)
VALUES
    (2, 'facturas_compra', true, true),
    (3, 'facturas_compra', true, true)
ON CONFLICT (role_id, module_key) DO NOTHING;
