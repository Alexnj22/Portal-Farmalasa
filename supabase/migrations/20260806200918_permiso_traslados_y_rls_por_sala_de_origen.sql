-- El permiso de traslados, y el RLS que mira la sala de ORIGEN.
--
-- ── El agujero que esto tapa ────────────────────────────────────────────────
-- Las políticas de `approval_requests` resuelven la visibilidad por la sala de
-- QUIEN PIDE. Sirve para las tres operaciones anteriores, donde quien pide y
-- quien aprueba miran el mismo inventario. En un traslado son salas distintas
-- por definición: lo crea alguien de la sala que NO tiene y lo confirma alguien
-- de la sala que SÍ tiene. Con las políticas de hoy, el destinatario del aviso
-- abre el enlace y no encuentra nada — y una consulta que devuelve cero filas
-- no falla, así que se leería como «ya la resolvieron».
--
-- Y aun con la sala corregida faltaba el permiso: medido hoy, las únicas dos
-- personas activas con `can_approve` en `requests` son Supervisión y la cuenta
-- de QA. **Jefe/a de Sala tiene `can_approve` y `can_view` en false**: los seis
-- jefes no ven nada en Solicitudes.
--
-- ── Por qué un módulo nuevo y no ampliar `requests` ─────────────────────────
-- `requests` es «permisos, vacaciones e incapacidades». Darle `can_approve` a
-- Jefe/a de Sala para que pueda confirmar un traslado le entregaría de arrastre
-- las vacaciones, los anticipos y las incapacidades de su sala. `traslados` es
-- un permiso que solo alcanza para esto.
--
-- ── Quién puede confirmar (decisión del usuario, 2026-08-06) ────────────────
-- La jefatura de la sala **siempre**; el dependiente **solo si estaba en turno**
-- cuando entró la solicitud. Eso último no se chequea contra el reloj en cada
-- lectura —sería una función por fila, que es exactamente lo que tiró el portal
-- el 2026-07-08— sino contra `metadata.destinatarios`, que es la foto que dejó
-- la cascada en el momento de crearla. La diferencia práctica: quien recibió el
-- aviso puede contestarlo aunque su turno haya terminado mientras tanto. Es
-- deliberado; la alternativa es que el enlace del aviso lleve a una pantalla
-- vacía por haber tardado veinte minutos.
--
-- Las llamadas a `auth_*` van envueltas en `(SELECT ...)` — sin eso Postgres las
-- evalúa POR FILA y cada una consulta employees + role_permissions.

SET lock_timeout = '5s';

-- ── 1 · El módulo ───────────────────────────────────────────────────────────
-- `role_permissions` es esparsa: sin fila no hay permiso. Así que solo se
-- insertan los roles que lo necesitan, y ninguno de los demás cambia.
--
-- BRANCH para las salas y la bodega; ALL solo para quien ya supervisa todo.
INSERT INTO public.role_permissions (role_id, module_key, can_view, can_edit, can_approve, scope)
SELECT r.id, 'traslados', true, true, true, r.scope
FROM (VALUES
        (19, 'BRANCH'),   -- Jefe/a de Sala
        (20, 'BRANCH'),   -- Subjefe/a de Sala
        (23, 'BRANCH'),   -- Regente de Enfermeria
        (30, 'BRANCH'),   -- Dependiente de Farmacia
        (15, 'BRANCH'),   -- Auxiliar de Bodega
        (12, 'BRANCH'),   -- Jefe/a de Compras y Logistica
        (13, 'ALL'),      -- Supervisor/a de Ventas
        (2,  'ALL'),      -- Gerente General
        (3,  'ALL'),      -- Administrador
        (33, 'ALL')       -- QA / Testing (CI)
     ) AS r(id, scope)
WHERE EXISTS (SELECT 1 FROM public.roles ro WHERE ro.id = r.id)
ON CONFLICT DO NOTHING;

-- ── 2 · El RLS ──────────────────────────────────────────────────────────────
-- Se reescriben las tres políticas conservando su rama original intacta y
-- agregando la del traslado. La rama vieja es la que sostiene los otros 15
-- tipos: tocarla sería cambiar quién ve las vacaciones.
DROP POLICY IF EXISTS approval_requests_select ON public.approval_requests;
CREATE POLICY approval_requests_select ON public.approval_requests
FOR SELECT TO authenticated
USING (
    -- lo de siempre: lo mío, o lo de mi sala si puedo aprobar solicitudes
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
    -- el traslado: se mira desde la sala de ORIGEN, que es la que decide
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
        )
    )
);
