-- La sala ve SUS traslados, no solo quien los pidió.
--
-- Pedido del usuario el 2026-08-06: «las solicitudes me gustaría que sí se vean
-- todas (de la sucursal, o según su alcance), no solo las que yo hice, y
-- recibir también. Claro, si estoy de turno.»
--
-- Hasta ahora, del lado de DESTINO solo veía sus traslados quien los había
-- creado. Es la sala la que recibe la caja, no la persona: quien pidió puede
-- estar de descanso cuando llega, y el resto de la sala no tenía forma ni de
-- verlo ni de recibirlo. La solicitud quedaba en tránsito hasta que volviera.
--
-- ── El turno, sin pagarlo por fila ──────────────────────────────────────────
-- «Si estoy de turno» es una propiedad de QUIEN MIRA, no de la fila que mira.
-- Por eso `estoy_en_turno()` no recibe parámetros: envuelta en `(SELECT ...)`
-- Postgres la resuelve UNA vez por consulta como initplan, no una por fila.
-- Una versión que recibiera la sala de la fila sería una llamada por fila
-- —cada una consultando employees y employee_rosters— que es exactamente la
-- forma del incidente del 2026-07-08.
--
-- La jefatura entra siempre, igual que del lado de origen: es la que responde
-- por la sala aunque no le toque el turno.

SET lock_timeout = '5s';

-- ── 1 · ¿Estoy en turno ahora, en mi sala? ──────────────────────────────────
-- `employees.branch_id` es bigint y la función toma integer: el cast va
-- explícito porque sin él Postgres no encuentra la firma y falla al crearla.
CREATE OR REPLACE FUNCTION public.estoy_en_turno()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.employees e
        WHERE e.id = public.auth_employee_id()
          AND e.id IN (
              SELECT t.employee_id FROM public.empleados_en_turno(e.branch_id::integer) t
          )
    );
$$;

REVOKE EXECUTE ON FUNCTION public.estoy_en_turno() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.estoy_en_turno() TO authenticated, service_role;

-- ── 2 · Las políticas ───────────────────────────────────────────────────────
-- Se conservan las dos ramas anteriores tal cual y se agrega la tercera: la
-- sala de DESTINO. Las de arriba sostienen los otros 15 tipos y el lado de
-- origen; tocarlas sería cambiar quién ve las vacaciones.
DROP POLICY IF EXISTS approval_requests_select ON public.approval_requests;
CREATE POLICY approval_requests_select ON public.approval_requests
FOR SELECT TO authenticated
USING (
    employee_id = (SELECT auth.uid())
    OR (
        (SELECT auth_has_module_permission('requests', 'can_approve'))
        AND (
            (SELECT auth_module_scope('requests')) = 'ALL'
            OR EXISTS (SELECT 1 FROM public.employees e
                        WHERE e.id = approval_requests.employee_id
                          AND e.branch_id = (SELECT auth_employee_branch_id()))
        )
    )
    OR (
        type = 'INVENTORY_TRANSFER_REQUEST'
        AND (SELECT auth_has_module_permission('traslados', 'can_approve'))
        AND (
            (SELECT auth_module_scope('traslados')) = 'ALL'
            -- la sala de ORIGEN: a quien le tocó cuando entró, y su jefatura
            OR metadata->'destinatarios' ? ((SELECT auth_employee_id())::text)
            OR (
                nullif(metadata->>'origen_branch_id', '')::integer = (SELECT auth_employee_branch_id())
                AND (SELECT auth_employee_system_role()) IN ('JEFE', 'SUBJEFE')
            )
            -- la sala de DESTINO: la jefatura siempre, y quien esté en turno
            OR (
                nullif(metadata->>'branch_id', '')::integer = (SELECT auth_employee_branch_id())
                AND (
                    (SELECT auth_employee_system_role()) IN ('JEFE', 'SUBJEFE')
                    OR (SELECT public.estoy_en_turno())
                )
            )
        )
    )
);

DROP POLICY IF EXISTS approval_requests_update ON public.approval_requests;
CREATE POLICY approval_requests_update ON public.approval_requests
FOR UPDATE TO authenticated
USING (
    (
        (SELECT auth_has_module_permission('requests', 'can_approve'))
        AND (
            (SELECT auth_module_scope('requests')) = 'ALL'
            OR EXISTS (SELECT 1 FROM public.employees e
                        WHERE e.id = approval_requests.employee_id
                          AND e.branch_id = (SELECT auth_employee_branch_id()))
        )
    )
    OR (
        type = 'INVENTORY_TRANSFER_REQUEST'
        AND (SELECT auth_has_module_permission('traslados', 'can_approve'))
        AND (
            (SELECT auth_module_scope('traslados')) = 'ALL'
            OR metadata->'destinatarios' ? ((SELECT auth_employee_id())::text)
            OR (
                nullif(metadata->>'origen_branch_id', '')::integer = (SELECT auth_employee_branch_id())
                AND (SELECT auth_employee_system_role()) IN ('JEFE', 'SUBJEFE')
            )
            OR (
                nullif(metadata->>'branch_id', '')::integer = (SELECT auth_employee_branch_id())
                AND (
                    (SELECT auth_employee_system_role()) IN ('JEFE', 'SUBJEFE')
                    OR (SELECT public.estoy_en_turno())
                )
            )
        )
    )
)
WITH CHECK (
    (
        (SELECT auth_has_module_permission('requests', 'can_approve'))
        AND (
            (SELECT auth_module_scope('requests')) = 'ALL'
            OR EXISTS (SELECT 1 FROM public.employees e
                        WHERE e.id = approval_requests.employee_id
                          AND e.branch_id = (SELECT auth_employee_branch_id()))
        )
    )
    OR (
        type = 'INVENTORY_TRANSFER_REQUEST'
        AND (SELECT auth_has_module_permission('traslados', 'can_approve'))
        AND (
            (SELECT auth_module_scope('traslados')) = 'ALL'
            OR metadata->'destinatarios' ? ((SELECT auth_employee_id())::text)
            OR (
                nullif(metadata->>'origen_branch_id', '')::integer = (SELECT auth_employee_branch_id())
                AND (SELECT auth_employee_system_role()) IN ('JEFE', 'SUBJEFE')
            )
            OR (
                nullif(metadata->>'branch_id', '')::integer = (SELECT auth_employee_branch_id())
                AND (
                    (SELECT auth_employee_system_role()) IN ('JEFE', 'SUBJEFE')
                    OR (SELECT public.estoy_en_turno())
                )
            )
        )
    )
);
