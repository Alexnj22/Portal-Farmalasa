-- BUG DE PRIVACIDAD confirmado en vivo: role_permissions daba can_view=true,
-- can_edit=true en el módulo 'announcements' al rol "Dependiente de Farmacia"
-- (22 de 47 empleados activos, 47% de la compañía) — la fila tenía
-- scope='BRANCH' (intención: gestionar avisos solo de su sucursal), pero la
-- policy RLS de announcements_audience usa auth_has_module_permission(...)
-- como bypass total sin mirar `scope`, así que en la práctica estos 22
-- empleados veían y podían crear/editar/borrar avisos de TODA la empresa,
-- incluyendo avisos dirigidos a otras sucursales o a otros empleados
-- específicos. Confirmado con RLS simulado: un empleado real de este rol
-- vio avisos de otra sucursal y dirigidos a otro compañero. A pedido
-- directo del usuario, se retira el permiso — pasan al flujo self-service
-- normal (solo GLOBAL/su sucursal/su rol/dirigidos a él, vía la policy ya
-- corregida en 20260706_fix_announcements_audience_rls.sql).
UPDATE public.role_permissions
SET can_view = false, can_edit = false
WHERE role_id = 30 AND module_key = 'announcements';
