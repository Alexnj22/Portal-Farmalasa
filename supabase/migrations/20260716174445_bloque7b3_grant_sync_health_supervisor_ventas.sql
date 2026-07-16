SET lock_timeout = '5s';

-- Acceso permanente a "Salud de Syncs" (7B.3) y futuras vistas del mismo
-- menú "Sistema" (7B.7) — decisión del usuario 2026-07-16: otorgar al rol
-- real "Supervisor/a de Ventas" (role_id=13, rol primario de Edwin Nuñez)
-- en vez de depender de secondary_role_id (que no otorga permisos).
INSERT INTO public.role_permissions (role_id, module_key, can_view)
VALUES (13, 'sync_health', true)
ON CONFLICT DO NOTHING;
