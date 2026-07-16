SET lock_timeout = '5s';

-- Bloque 7B.1: rol de sistema dedicado para alertas técnicas de sync (no es
-- un cargo de farmacia), mismo patrón que el rol QA/Testing (id 33): scope
-- GLOBAL, max_limit 0 (no cuenta para headcount real).
INSERT INTO public.roles (name, scope, max_limit, is_su)
VALUES ('Sistema — Alertas Técnicas', 'GLOBAL', 0, false);

-- Permiso de lectura sobre el futuro dashboard de salud de syncs (7B.3) —
-- ya gatea hoy las 3 tablas nuevas de Fase 0 (products/minmax/backup_sync_log).
INSERT INTO public.role_permissions (role_id, module_key, can_view)
SELECT id, 'sync_health', true FROM public.roles WHERE name = 'Sistema — Alertas Técnicas';

-- Asignado como cargo SECUNDARIO de Edwin Nuñez (no reemplaza su rol primario
-- "Supervisor/a de Ventas") — solo se usa para decidir destinatarios de esta
-- alerta puntual, NO otorga permisos vía RLS (auth_employee_role_id() solo
-- lee role_id primario, confirmado en la definición real de la función).
UPDATE public.employees
SET secondary_role_id = (SELECT id FROM public.roles WHERE name = 'Sistema — Alertas Técnicas')
WHERE username = 'edwin.nunez';
