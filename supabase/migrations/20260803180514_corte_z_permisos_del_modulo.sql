SET lock_timeout = '5s';

-- Paso 5 del alta de módulo: sin filas acá, TODOS los usuarios ven AccessDenied
-- y el módulo tampoco aparece en la pantalla de Permisos.
--
-- Se copian de `libros_iva` porque es el módulo hermano: quien puede ver los
-- libros de IVA es exactamente quien tiene que poder cotejar el Corte Z contra
-- ellos. `can_edit` va en FALSE para todos, incluido Gerente General: un Corte Z
-- no se edita — si el número está mal, está mal en el origen.
INSERT INTO public.role_permissions (role_id, module_key, can_view, can_edit, can_approve, scope)
SELECT rp.role_id, 'corte_z', rp.can_view, false, false, rp.scope
FROM public.role_permissions rp
WHERE rp.module_key = 'libros_iva'
ON CONFLICT (role_id, module_key) DO UPDATE
   SET can_view = EXCLUDED.can_view,
       scope    = EXCLUDED.scope
   WHERE role_permissions.can_view IS DISTINCT FROM EXCLUDED.can_view
      OR role_permissions.scope    IS DISTINCT FROM EXCLUDED.scope;
