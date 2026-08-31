-- Una corrección de caja es OPERATIVA, y quien la decide es `requests_caja`.
--
-- Encontrado al revisar si el módulo estaba listo, y son dos defectos mudos que
-- sólo se ven leyendo las policies.
--
-- 1. `es_solicitud_operativa()` no conocía `CAJA_MOVIMIENTO_CHANGE`, así que la
--    policy de SELECT la metía en la rama de lo NO operativo — o sea que para
--    verla hacía falta `requests_personales`, el módulo de vacaciones, permisos
--    e incapacidades. Una corrección sobre el efectivo de una caja aparecía en
--    la bandeja de personal y NO en la operativa. Nadie iba a buscarla ahí.
--
-- 2. La policy de UPDATE enumera las familias una por una y `requests_caja` no
--    estaba. Aprobar seguía funcionando —lo escribe `operar-caja` con la llave
--    del servidor, que no pasa por RLS— pero **RECHAZAR no**: eso lo hace el
--    navegador. O sea que se podía aprobar y no se podía rechazar, y el rechazo
--    fallaba sin decir por qué.
--
-- Los dos juntos son el modo de falla de siempre: nada da error, la solicitud
-- existe, y no aparece donde se la busca.

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.es_solicitud_operativa(p_type text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'extensions'
AS $function$
  SELECT p_type = ANY (ARRAY[
    'ANNULMENT_REQUEST', 'PAYMENT_CHANGE_REQUEST',
    'VENDOR_CHANGE_REQUEST', 'CLIENT_CHANGE_REQUEST',
    'INVENTORY_LOAD_REQUEST', 'INVENTORY_DISCARD_REQUEST',
    'INVENTORY_TRANSFER_REQUEST', 'INVENTORY_TRANSFER_PUSH',
    'CAJA_MOVIMIENTO_CHANGE'
  ]);
$function$;

-- La policy de UPDATE, con la familia de caja agregada. Se reescribe entera —no
-- hay forma de sumarle una rama a un `USING`— y por eso queda igual a la que
-- había salvo ese bloque.
DROP POLICY IF EXISTS approval_requests_update ON public.approval_requests;
CREATE POLICY approval_requests_update ON public.approval_requests
FOR UPDATE
USING (
  ((modulo_de_aprobacion(type) = 'requests_facturacion')
    AND (SELECT auth_has_module_permission('requests_facturacion','can_approve'))
    AND CASE (SELECT auth_module_scope('requests_facturacion'))
          WHEN 'ALL'  THEN true
          WHEN 'MINE' THEN false
          ELSE EXISTS (SELECT 1 FROM employees e
                        WHERE e.id = approval_requests.employee_id
                          AND e.branch_id = (SELECT auth_employee_branch_id()))
        END)
  OR ((modulo_de_aprobacion(type) = 'requests_inventario')
    AND (SELECT auth_has_module_permission('requests_inventario','can_approve'))
    AND CASE (SELECT auth_module_scope('requests_inventario'))
          WHEN 'ALL'  THEN true
          WHEN 'MINE' THEN false
          ELSE EXISTS (SELECT 1 FROM employees e
                        WHERE e.id = approval_requests.employee_id
                          AND e.branch_id = (SELECT auth_employee_branch_id()))
        END)
  -- La familia nueva. El ámbito se mide contra la SALA DE LA CAJA
  -- (`metadata->>'branch_id'`) y no contra la sucursal de quien la pidió: una
  -- corrección es sobre una caja, y quien la anotó puede estar de paso en otra
  -- sala. Es el mismo criterio que ya usan los traslados.
  OR ((modulo_de_aprobacion(type) = 'requests_caja')
    AND (SELECT auth_has_module_permission('requests_caja','can_approve'))
    AND (((SELECT auth_module_scope('requests_caja')) = 'ALL')
         OR (NULLIF(metadata ->> 'branch_id','')::integer
             = (SELECT auth_employee_branch_id()))))
  OR ((NOT es_solicitud_operativa(type))
    AND (SELECT auth_has_module_permission('requests_personales','can_approve'))
    AND CASE (SELECT auth_module_scope('requests_personales'))
          WHEN 'ALL'  THEN true
          WHEN 'MINE' THEN false
          ELSE EXISTS (SELECT 1 FROM employees e
                        WHERE e.id = approval_requests.employee_id
                          AND e.branch_id = (SELECT auth_employee_branch_id()))
        END)
  OR ((type = 'INVENTORY_TRANSFER_REQUEST')
    AND (SELECT auth_has_module_permission('traslados','can_approve'))
    AND (((SELECT auth_module_scope('traslados')) = 'ALL')
         OR (NULLIF(metadata ->> 'origen_branch_id','')::integer = (SELECT auth_employee_branch_id()))
         OR (NULLIF(metadata ->> 'branch_id','')::integer = (SELECT auth_employee_branch_id()))
         OR (status = 'PENDING'
             AND NULLIF(metadata ->> 'origen_branch_id','')::integer
                 = ANY (COALESCE((SELECT salas_que_cubro_ahora()), ARRAY[]::integer[])))))
  OR (employee_id = (SELECT auth_employee_id()) AND status = 'PENDING')
  OR (type = 'SHIFT_CHANGE' AND status = 'PENDING'
      AND approver_id = (SELECT auth_employee_id())
      AND employee_id <> (SELECT auth_employee_id()))
);
