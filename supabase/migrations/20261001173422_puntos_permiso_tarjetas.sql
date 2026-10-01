SET lock_timeout = '5s';

-- ═══ Puntos: las tarjetas de cifras, con permiso propio ════════════════════
-- Pedido del usuario (2026-10-01): «quiero que las cards sean un permiso. Se
-- lo quitas a todos menos a admin». Las tarjetas de Resumen y de Consulta
-- pasan a `puntos_tarjetas`; sólo lo tienen los cuatro cargos de
-- administración (y la cuenta de QA). Las pestañas siguen como estaban.
INSERT INTO public.role_permissions (role_id, module_key, can_view, can_edit, can_approve, scope)
SELECT r.id, 'puntos_tarjetas', true, false, false, 'ALL'
  FROM public.roles r
 WHERE r.name IN ('Gerente General', 'Administrador', 'Jefe/a de Talento Humano', 'Supervisor/a de Ventas', 'QA / Testing (CI)')
ON CONFLICT (role_id, module_key) DO UPDATE SET can_view = true;
