-- Una solicitud operativa se queda en la SALA DONDE SE HIZO, no en la de la
-- ficha de quien la pidió (el usuario, 2026-11-12: «todo se debe quedar en la
-- sala que lo hace»).
--
-- Caso: Fernando Oliva, ficha en Bodega, de apoyo en Salud 4. Dos movimientos
-- de caja que hizo en Salud 4 los veía Bodega y Salud 4 NO. La rama de alcance
-- de sala decidía por employees.branch_id. Ahora decide por metadata.branch_id
-- —que guardan TODAS las operativas al crearse (medido: 3.651 traslados y 521
-- de las demás, todas con un número)— y sólo sin él cae a la ficha. Es el mismo
-- criterio que `salaDeSolicitud` en la pantalla. Las personales (vacaciones,
-- permisos) siguen por la ficha: ahí la sala ES la de la persona.
-- Los traslados siguen fuera de esta rama (20261112164718): los decide la suya.
SET lock_timeout = '5s';

DROP POLICY IF EXISTS approval_requests_select ON public.approval_requests;
CREATE POLICY approval_requests_select ON public.approval_requests
FOR SELECT TO authenticated
USING (
  (employee_id = (SELECT auth_employee_id()))
  OR (
    es_solicitud_operativa(type)
    AND (SELECT auth_has_module_permission('requests', 'can_view'))
    AND CASE (SELECT auth_module_scope('requests'))
      WHEN 'ALL' THEN true
      WHEN 'MINE' THEN false
      ELSE (
        type <> ALL (ARRAY['INVENTORY_TRANSFER_REQUEST', 'INVENTORY_TRANSFER_PUSH'])
        AND CASE WHEN (metadata ->> 'branch_id') ~ '^[0-9]+$'
              THEN (metadata ->> 'branch_id')::integer = (SELECT auth_employee_branch_id())
              ELSE EXISTS (SELECT 1 FROM employees e
                           WHERE e.id = approval_requests.employee_id
                             AND e.branch_id = (SELECT auth_employee_branch_id()))
            END
      )
    END
  )
  OR (
    (NOT es_solicitud_operativa(type))
    AND (SELECT auth_has_module_permission('requests_personales', 'can_view'))
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
  OR (
    type = 'INVENTORY_TRANSFER_PUSH'
    AND (SELECT auth_has_module_permission('traslados', 'can_view'))
    AND (
      (SELECT auth_module_scope('traslados')) = 'ALL'
      OR NULLIF(metadata ->> 'origen_branch_id', '')::integer = (SELECT auth_employee_branch_id())
      OR NULLIF(metadata ->> 'branch_id', '')::integer = (SELECT auth_employee_branch_id())
      OR (status = 'PENDING'
          AND NULLIF(metadata ->> 'branch_id', '')::integer
              = ANY (COALESCE((SELECT salas_que_cubro_ahora()), ARRAY[]::integer[])))
    )
  )
);
