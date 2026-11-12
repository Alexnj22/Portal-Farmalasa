-- Aprobar (UPDATE) y crear por otro (INSERT) una solicitud de facturación o
-- de inventario se decide por la SALA DONDE SE HIZO, como la lectura
-- (20261112165331). Caja y cuentas por cobrar ya lo hacían así.
--
-- Sin esto, un descarte que Fernando (ficha Bodega, de apoyo en Salud 4) hace
-- en Salud 4 lo VE Salud 4 pero no lo puede aprobar —el UPDATE devuelve cero
-- filas sin error— y lo podría aprobar Bodega, que no lo ve. Las personales
-- (vacaciones, permisos) siguen por la ficha: ahí la sala es la de la persona.
-- Sin metadata.branch_id, cae a la ficha (hoy ninguna operativa está así).
SET lock_timeout = '5s';

DROP POLICY IF EXISTS approval_requests_update ON public.approval_requests;
CREATE POLICY approval_requests_update ON public.approval_requests
FOR UPDATE TO authenticated
USING (
  (
    modulo_de_aprobacion(type) = 'requests_facturacion'
    AND (SELECT auth_has_module_permission('requests_facturacion', 'can_approve'))
    AND CASE (SELECT auth_module_scope('requests_facturacion'))
      WHEN 'ALL' THEN true
      WHEN 'MINE' THEN false
      ELSE CASE WHEN (metadata ->> 'branch_id') ~ '^[0-9]+$'
             THEN (metadata ->> 'branch_id')::integer = (SELECT auth_employee_branch_id())
             ELSE EXISTS (SELECT 1 FROM employees e
                          WHERE e.id = approval_requests.employee_id
                            AND e.branch_id = (SELECT auth_employee_branch_id()))
           END
    END
  )
  OR (
    modulo_de_aprobacion(type) = 'requests_inventario'
    AND (SELECT auth_has_module_permission('requests_inventario', 'can_approve'))
    AND CASE (SELECT auth_module_scope('requests_inventario'))
      WHEN 'ALL' THEN true
      WHEN 'MINE' THEN false
      ELSE CASE WHEN (metadata ->> 'branch_id') ~ '^[0-9]+$'
             THEN (metadata ->> 'branch_id')::integer = (SELECT auth_employee_branch_id())
             ELSE EXISTS (SELECT 1 FROM employees e
                          WHERE e.id = approval_requests.employee_id
                            AND e.branch_id = (SELECT auth_employee_branch_id()))
           END
    END
  )
  OR (
    modulo_de_aprobacion(type) = 'requests_caja'
    AND (SELECT auth_has_module_permission('requests_caja', 'can_approve'))
    AND ((SELECT auth_module_scope('requests_caja')) = 'ALL'
         OR NULLIF(metadata ->> 'branch_id', '')::integer = (SELECT auth_employee_branch_id()))
  )
  OR (
    modulo_de_aprobacion(type) = 'requests_cuentas_por_cobrar'
    AND (SELECT auth_has_module_permission('requests_cuentas_por_cobrar', 'can_approve'))
    AND ((SELECT auth_module_scope('requests_cuentas_por_cobrar')) = 'ALL'
         OR NULLIF(metadata ->> 'branch_id', '')::integer = (SELECT auth_employee_branch_id()))
  )
  OR (
    (NOT es_solicitud_operativa(type))
    AND (SELECT auth_has_module_permission('requests_personales', 'can_approve'))
    AND CASE (SELECT auth_module_scope('requests_personales'))
      WHEN 'ALL' THEN true
      WHEN 'MINE' THEN false
      ELSE EXISTS (SELECT 1 FROM employees e
                   WHERE e.id = approval_requests.employee_id
                     AND e.branch_id = (SELECT auth_employee_branch_id()))
    END
  )
  OR (
    type = 'INVENTORY_TRANSFER_REQUEST'
    AND (SELECT auth_has_module_permission('traslados', 'can_approve'))
    AND (
      (SELECT auth_module_scope('traslados')) = 'ALL'
      OR NULLIF(metadata ->> 'origen_branch_id', '')::integer = (SELECT auth_employee_branch_id())
      OR NULLIF(metadata ->> 'branch_id', '')::integer = (SELECT auth_employee_branch_id())
      OR (status = 'PENDING'
          AND NULLIF(metadata ->> 'origen_branch_id', '')::integer
              = ANY (COALESCE((SELECT salas_que_cubro_ahora()), ARRAY[]::integer[])))
    )
  )
);

DROP POLICY IF EXISTS approval_requests_insert ON public.approval_requests;
CREATE POLICY approval_requests_insert ON public.approval_requests
FOR INSERT TO authenticated
WITH CHECK (
  (employee_id = (SELECT auth_employee_id()))
  OR (
    modulo_de_aprobacion(type) = 'requests_facturacion'
    AND (SELECT auth_has_module_permission('requests_facturacion', 'can_approve'))
    AND ((SELECT auth_module_scope('requests_facturacion')) = 'ALL'
         OR CASE WHEN (metadata ->> 'branch_id') ~ '^[0-9]+$'
              THEN (metadata ->> 'branch_id')::integer = (SELECT auth_employee_branch_id())
              ELSE EXISTS (SELECT 1 FROM employees e
                           WHERE e.id = approval_requests.employee_id
                             AND e.branch_id = (SELECT auth_employee_branch_id()))
            END)
  )
  OR (
    modulo_de_aprobacion(type) = 'requests_inventario'
    AND (SELECT auth_has_module_permission('requests_inventario', 'can_approve'))
    AND ((SELECT auth_module_scope('requests_inventario')) = 'ALL'
         OR CASE WHEN (metadata ->> 'branch_id') ~ '^[0-9]+$'
              THEN (metadata ->> 'branch_id')::integer = (SELECT auth_employee_branch_id())
              ELSE EXISTS (SELECT 1 FROM employees e
                           WHERE e.id = approval_requests.employee_id
                             AND e.branch_id = (SELECT auth_employee_branch_id()))
            END)
  )
  OR (
    (NOT es_solicitud_operativa(type))
    AND (SELECT auth_has_module_permission('requests_personales', 'can_approve'))
    AND ((SELECT auth_module_scope('requests_personales')) = 'ALL'
         OR EXISTS (SELECT 1 FROM employees e
                    WHERE e.id = approval_requests.employee_id
                      AND e.branch_id = (SELECT auth_employee_branch_id())))
  )
);
