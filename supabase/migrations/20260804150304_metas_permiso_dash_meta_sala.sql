SET lock_timeout = '5s';

-- Permiso del widget «Meta del mes» del Inicio (Metas Fase 3).
--
-- Solo se otorga a quien ya administra metas y ya tiene el Inicio: la
-- supervisión, la gerencia y la cuenta de QA. Los roles de sala se reparten
-- desde la pantalla de Permisos, que es donde se decide si el widget muestra
-- todas las salas (scope ALL) o solo la propia (scope BRANCH).
INSERT INTO public.role_permissions (role_id, module_key, can_view, can_edit, can_approve, scope)
SELECT r.id, 'dash_meta_sala', true, false, false, 'ALL'
FROM public.roles r
WHERE r.name IN ('Administrador', 'Gerente General', 'Supervisor/a de Ventas', 'QA / Testing (CI)')
ON CONFLICT (role_id, module_key) DO NOTHING;
