-- Un traslado se ve por las salas que toca (origen / destino / respaldo),
-- no por la sucursal de la FICHA de quien lo pidió.
--
-- Caso (2026-11-12): Fernando Oliva tiene ficha en Bodega y está de apoyo en
-- Salud 4. Sus pedidos para Salud 4 a Salud 1/2/5 le aparecían a Bodega, porque
-- la rama genérica de solicitudes operativas con alcance de sala acepta
-- «employee_id es de mi sucursal». Los traslados ya tienen su rama propia
-- (origen, destino, sala que cubro mientras está pendiente): se les quita la
-- genérica por ficha. Medido: de 3.651 traslados, sólo 4 dejan de verse en
-- alguna sala (los 4 de este caso); quien pide los sigue viendo por la
-- primera rama (employee_id = auth_employee_id()).
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
        AND EXISTS (SELECT 1 FROM employees e
                    WHERE e.id = approval_requests.employee_id
                      AND e.branch_id = (SELECT auth_employee_branch_id()))
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
