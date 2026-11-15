-- El widget «Consulta de precios» del Inicio (2026-11-15): activo para todo
-- cargo que ya tiene «Consulta de inventario», a pedido del usuario («para
-- todos»). Sólo datos: una fila de permiso por cargo, sin DDL.
SET lock_timeout = '5s';

INSERT INTO public.role_permissions (role_id, module_key, can_view, can_edit, can_approve, scope)
SELECT rp.role_id, 'dash_consulta_precios', true, false, false, 'ALL'
  FROM public.role_permissions rp
 WHERE rp.module_key = 'dash_inv_search' AND rp.can_view
ON CONFLICT (role_id, module_key) DO NOTHING;
