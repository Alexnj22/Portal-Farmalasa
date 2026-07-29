SET lock_timeout = '5s';

-- CI e2e-smoke (tests/e2e/smoke.spec.js) descubrió que role_id=33 (QA / Testing CI,
-- ver project_qa_ci_test_account) le faltaban 2 permisos de SOLO LECTURA que sus
-- propios smoke tests necesitan para ver contenido real en vistas a las que ya
-- tiene acceso de módulo: 'overview' (Dashboard) y 'pedidos' (Pedidos).
-- Sin dash_kpi.can_view, la fila de KPIs del Dashboard (incl. "Empleados activos")
-- nunca renderiza. Sin pedidos_tab_historial.can_view, ninguna pestaña de Pedidos
-- pasa el filtro de permisos y el texto "Pedidos" nunca aparece. can_edit se deja
-- en false en ambos — mismo criterio de mínimo privilegio con el que se creó el rol.
INSERT INTO public.role_permissions (role_id, module_key, can_view, can_edit, can_approve, scope)
VALUES
  (33, 'dash_kpi', true, false, false, 'ALL'),
  (33, 'pedidos_tab_historial', true, false, false, 'ALL')
ON CONFLICT (role_id, module_key) DO UPDATE SET can_view = true;
