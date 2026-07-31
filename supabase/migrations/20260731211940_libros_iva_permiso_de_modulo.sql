SET lock_timeout = '5s';

-- Permiso del módulo "Libros IVA".
--
-- Va en la migración y no a mano porque un módulo sin fila en `role_permissions`
-- no lo ve NADIE: el menú y `PermissionGuard` filtran por `hasPermission`, así
-- que la vista quedaría escrita y muerta. Es el mismo defecto del aterrizaje de
-- módulos (cubría 11 de 35).
--
-- Espeja `facturas_compra`, que es el otro módulo del grupo "Datos Contables" y
-- tiene exactamente la audiencia que corresponde: contabilidad. Se hereda su
-- `scope` — un rol con scope BRANCH ve el libro de SU sucursal, que es lo que
-- el gate del RPC aplica del lado del servidor.
--
-- `can_edit` en false: el libro no se edita, se genera. Lo que hay que corregir
-- se corrige en el dato de origen.
INSERT INTO public.role_permissions (role_id, module_key, can_view, can_edit, can_approve, scope)
SELECT rp.role_id, 'libros_iva', rp.can_view, false, false, rp.scope
FROM public.role_permissions rp
WHERE rp.module_key = 'facturas_compra'
  AND NOT EXISTS (
      SELECT 1 FROM public.role_permissions x
      WHERE x.role_id = rp.role_id AND x.module_key = 'libros_iva'
  );
