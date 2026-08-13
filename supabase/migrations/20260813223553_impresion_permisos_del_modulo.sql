SET lock_timeout = '5s';

-- Paso 5 del alta de módulo: sin filas acá el módulo no existe para nadie —
-- todos ven AccessDenied y tampoco aparece en la pantalla de Permisos.
--
-- Se copian de `ios_test` porque es el módulo hermano: las dos son pantallas de
-- diagnóstico —una mide el layout en el teléfono, la otra mide el ancho del
-- rollo de la ticketera— y las dos las usa quien está poniendo a punto un
-- equipo, no quien atiende el mostrador. Desde la pantalla de Permisos se puede
-- ampliar a un jefe de sala el día que haga falta.
--
-- `can_edit` se copia tal cual: acá no habilita escribir nada en la base, sólo
-- distingue a quien administra de quien mira.
INSERT INTO public.role_permissions (role_id, module_key, can_view, can_edit, can_approve, scope)
SELECT rp.role_id, 'impresion', rp.can_view, rp.can_edit, false, rp.scope
FROM public.role_permissions rp
WHERE rp.module_key = 'ios_test'
ON CONFLICT (role_id, module_key) DO UPDATE
   SET can_view = EXCLUDED.can_view,
       can_edit = EXCLUDED.can_edit,
       scope    = EXCLUDED.scope
   WHERE role_permissions.can_view IS DISTINCT FROM EXCLUDED.can_view
      OR role_permissions.can_edit IS DISTINCT FROM EXCLUDED.can_edit
      OR role_permissions.scope    IS DISTINCT FROM EXCLUDED.scope;
