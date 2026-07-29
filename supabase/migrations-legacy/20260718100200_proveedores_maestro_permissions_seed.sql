-- Maestro de Proveedores — permisos del módulo (Fase 1.3 / Fase 0.4: mismos roles que facturas_compra + role 13)
SET lock_timeout = '5s';

INSERT INTO public.role_permissions (role_id, module_key, can_view, can_edit)
VALUES
    (2, 'proveedores', true, true),
    (3, 'proveedores', true, true),
    (13, 'proveedores', true, true)
ON CONFLICT (role_id, module_key) DO NOTHING;
