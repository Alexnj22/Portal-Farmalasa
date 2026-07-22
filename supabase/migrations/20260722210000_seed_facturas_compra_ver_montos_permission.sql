SET lock_timeout = '5s';

-- Nuevo permiso granular tipo "tab" (mismo patrón que minmax_ver_costos):
-- gatea la visibilidad de las cards contables ($) en FacturasCompraView,
-- independiente de facturas_compra.can_view (ver documentos sigue igual).
-- Backfill: los roles que YA tienen facturas_compra.can_view=true no deben
-- perder las cards al desplegar el nuevo gate — se les activa explícito.
INSERT INTO role_permissions (role_id, module_key, can_view, can_edit, can_approve, scope, updated_at)
SELECT role_id, 'facturas_compra_ver_montos', true, false, false, 'ALL', now()
FROM role_permissions
WHERE module_key = 'facturas_compra' AND can_view = true
ON CONFLICT (role_id, module_key) DO UPDATE SET can_view = true, updated_at = now();
