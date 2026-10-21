SET lock_timeout = '5s';
-- La pantalla Reservas (Comercial, /reservas) es un módulo nuevo. La ven los
-- mismos cargos que ya veían el widget `dash_reservas` (con su alcance), más
-- quien la veía como pestaña de Ofertas para clientes y no tenía el widget.
INSERT INTO public.role_permissions (role_id, module_key, can_view, can_edit, can_approve, scope)
SELECT DISTINCT ON (role_id) role_id, 'reservas', can_view, can_edit, false, scope
FROM (
  SELECT role_id, can_view, can_edit, scope, 1 AS prio FROM public.role_permissions WHERE module_key = 'dash_reservas' AND can_view
  UNION ALL
  SELECT role_id, can_view, can_edit, scope, 2 FROM public.role_permissions WHERE module_key = 'ofertas_clientes' AND can_view
) s
WHERE NOT EXISTS (SELECT 1 FROM public.role_permissions p WHERE p.role_id = s.role_id AND p.module_key = 'reservas')
ORDER BY role_id, prio;
