-- La pestaña «Agotados» de Min/Max (lo que la sala no tiene y sí vende) hereda
-- exactamente el permiso de «Sucursal»: quien hoy ve el análisis de una sala ve
-- también lo que le falta. No se abre a nadie nuevo.
SET lock_timeout = '5s';

INSERT INTO public.role_permissions (role_id, module_key, can_view, can_edit, can_approve, scope)
SELECT rp.role_id, 'minmax_tab_agotados', rp.can_view, rp.can_edit, rp.can_approve, rp.scope
FROM public.role_permissions rp
WHERE rp.module_key = 'minmax_tab_sucursal'
ON CONFLICT (role_id, module_key) DO NOTHING;
