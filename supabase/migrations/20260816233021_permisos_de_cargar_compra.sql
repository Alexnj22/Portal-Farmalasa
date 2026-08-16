-- Quién usa «Cargar compra».
--
-- Va como migración y no como un INSERT suelto porque un permiso que sólo
-- existe en producción no se puede reproducir en un entorno nuevo: la pantalla
-- aparecería vacía y nadie sabría por qué.
--
-- `can_edit` no es un permiso de adorno acá: es lo que deja CONFIRMAR a qué
-- producto nuestro corresponde un renglón, y esa confirmación se guarda en el
-- diccionario para siempre. Ver sin editar sirve para revisar la compra armada
-- sin poder enseñarle nada al portal.

SET lock_timeout = '5s';

INSERT INTO public.role_permissions (role_id, module_key, can_view, can_edit, can_approve, scope)
VALUES (12, 'cargar_compra', true, true, false, 'ALL'),   -- Jefe/a de Compras y Logística
       (2,  'cargar_compra', true, true, false, 'ALL')    -- Gerente General
ON CONFLICT (role_id, module_key) DO UPDATE
   SET can_view = EXCLUDED.can_view, can_edit = EXCLUDED.can_edit,
       can_approve = EXCLUDED.can_approve, scope = EXCLUDED.scope;
