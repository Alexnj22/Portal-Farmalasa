SET lock_timeout = '5s';

-- El jefe de sala no veía NINGUNA solicitud de su sucursal (2026-08-10).
--
-- Dos candados, uno encima del otro:
--
--  1. `Jefe/a de Sala` (rol 19, 6 personas activas) tenía el módulo `requests`
--     con `can_view = false`. Ni siquiera podía abrir la Bandeja.
--  2. Y aunque lo tuviera, esta policy exigía `can_approve` para VER. O sea que
--     mirar y decidir eran el mismo permiso, y no hay forma de dar uno sin el
--     otro. Es el mismo agujero que ya está anotado en `TrasladosView`: «si
--     algún día se le da can_view a secas a alguien, esta vista se le va a abrir
--     vacía. El arreglo sería de la policy, no de acá.» Este es ese día.
--
-- Decisión del usuario: el jefe **ve, no decide**. La de UPDATE no se toca —
-- sigue pidiendo `can_approve`— así que ver la solicitud de su sala no le da
-- ninguna capacidad de resolverla. Quien decide sigue siendo Supervisión.
--
-- Pivotar el SELECT de `can_approve` a `can_view` no le quita acceso a nadie:
-- verificado contra prod, los dos únicos roles con `can_approve` en `requests`
-- —Supervisor/a de Ventas y la cuenta de CI— tienen los dos `can_view = true`.
--
-- Las llamadas a `auth_*` van envueltas en `(SELECT ...)`, como toda esta
-- familia desde el outage del 2026-07-08: sin el initplan, Postgres las evalúa
-- POR FILA y cada evaluación consulta employees + role_permissions.

DROP POLICY IF EXISTS approval_requests_select ON public.approval_requests;

CREATE POLICY approval_requests_select ON public.approval_requests
FOR SELECT TO authenticated
USING (
  -- Lo propio, siempre.
  employee_id = (SELECT public.auth_employee_id())

  -- El módulo de solicitudes: ahora alcanza con poder VER.
  OR (
    (SELECT public.auth_has_module_permission('requests', 'can_view'))
    AND (
      (SELECT public.auth_module_scope('requests')) = 'ALL'
      OR EXISTS (
        SELECT 1 FROM public.employees e
        WHERE e.id = approval_requests.employee_id
          AND e.branch_id = (SELECT public.auth_employee_branch_id())
      )
    )
  )

  -- El traslado tiene su propio módulo y su propia cascada, sin cambios.
  OR (
    type = 'INVENTORY_TRANSFER_REQUEST'
    AND (SELECT public.auth_has_module_permission('traslados', 'can_approve'))
    AND (
      (SELECT public.auth_module_scope('traslados')) = 'ALL'
      OR (metadata -> 'destinatarios') ? ((SELECT public.auth_employee_id()))::text
      OR (
        (NULLIF(metadata ->> 'origen_branch_id', ''))::integer = (SELECT public.auth_employee_branch_id())
        AND (SELECT public.auth_employee_system_role()) = ANY (ARRAY['JEFE', 'SUBJEFE'])
      )
      OR (
        (NULLIF(metadata ->> 'branch_id', ''))::integer = (SELECT public.auth_employee_branch_id())
        AND (
          (SELECT public.auth_employee_system_role()) = ANY (ARRAY['JEFE', 'SUBJEFE'])
          OR (SELECT public.estoy_en_turno())
        )
      )
    )
  )
);

-- Y el permiso que faltaba. `can_edit` y `can_approve` quedan en false a
-- propósito: ver no es decidir, y crear a nombre de otro tampoco.
UPDATE public.role_permissions
SET can_view = true
WHERE module_key = 'requests'
  AND role_id IN (19, 20)   -- Jefe/a de Sala, Subjefe/a de Sala
  AND scope = 'BRANCH';
