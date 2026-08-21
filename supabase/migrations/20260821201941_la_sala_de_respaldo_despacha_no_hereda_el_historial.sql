-- La sala de respaldo despacha, no hereda el historial.
--
-- Medido en producción el 2026-08-21 sobre la sesión del jefe de sala de
-- Salud 3: veía 142 solicitudes, 53 de otras salas. 24 eran legítimas —Salud 3
-- era la sala de ORIGEN, o sea que le estaban pidiendo producto a ella—, pero
-- **29 no**: traslados Bodega→Salud 1 (19), Bodega→Salud 5 (7), Bodega→Salud 4
-- (2) y Bodega→La Popular (1), todos ya aprobados o rechazados, en los que
-- Salud 3 no puso ni pidió nada.
--
-- La puerta era `metadata.destinatarios`. Desde v2.657.0 Salud 3 es la
-- `sala_respaldo_id` de Bodega —el único par configurado—, así que cuando
-- alguien le pide producto a Bodega estando cerrada, la cascada de avisos
-- escribe a la gente de Salud 3 en esa lista para que pueda despachar. La
-- lista quedaba grabada en la fila **para siempre**: la solicitud seguía
-- visible para Salud 3 meses después, resuelta y ajena. Sólo iba a crecer.
--
-- La decisión del usuario (2026-08-21): «salud 3 no debe de poder ver el
-- historial de bodega, solo debe poder aprobar o rechazar en las horas ya
-- definidas».
--
-- Entonces la lista de destinatarios deja de dar acceso, y el respaldo pasa a
-- ser lo que su nombre dice: **mientras haya algo que contestar y mientras la
-- sala cubierta esté cerrada**. Las dos condiciones juntas, porque cada una
-- sola deja un hueco — `destinatarios` sin horario dejaba despachar a las 10 de
-- la mañana con Bodega abierta, y el horario sin `PENDING` dejaba mirar el
-- historial cada tarde a partir de las 17:00.
--
-- Quitar `destinatarios` no le saca acceso a nadie más. Verificado sobre las
-- 285 filas de la historia: **cero** destinatarios pertenecen a una sala que no
-- sea la de origen, la de destino o la de respaldo. Los de la sala de origen ya
-- entran por `origen_branch_id`, y los de la de destino por `branch_id` — o,
-- antes todavía, porque quien pidió es de su sala.
--
-- Y medido fila por fila ANTES de aplicar, con el predicado nuevo enfrentado al
-- viejo sobre las solicitudes reales: Salud 3 pierde 29, y las otras seis salas
-- pierden 0 y ganan 0.
--
-- ⚠️ El `status = 'PENDING'` va sólo en el USING del UPDATE, nunca en su
-- WITH CHECK: el WITH CHECK mira la fila NUEVA, y la fila nueva de una
-- aprobación es justamente la que ya no está pendiente. Con la condición en el
-- CHECK, despachar sería imposible — un candado que se cierra sobre la única
-- acción que la policy existe para permitir.
--
-- El espejo de esta regla vive en `supabase/functions/aplicar-traslado-
-- inventario`, que es quien de verdad mueve el producto (corre con
-- service_role, así que el RLS no lo frena). Los dos criterios se escribieron
-- en el mismo orden y en el mismo commit: separados, la pantalla ofrecería un
-- botón que el servidor rebota con 403 — o peor, el servidor dejaría pasar lo
-- que la pantalla ya no muestra.
--
-- Los `TO` de cada policy son los que ya tenían: SELECT a `authenticated`,
-- UPDATE a `public`. No se unifican acá — cambiar a quién alcanza una policy es
-- otra decisión, y no la que este cambio vino a tomar.
SET lock_timeout = '5s';

DROP POLICY IF EXISTS approval_requests_select ON public.approval_requests;

CREATE POLICY approval_requests_select ON public.approval_requests
FOR SELECT TO authenticated
USING (
    (employee_id = (SELECT public.auth_employee_id()))
    OR (
        public.es_solicitud_operativa(type)
        AND (SELECT public.auth_has_module_permission('requests', 'can_view'))
        AND CASE (SELECT public.auth_module_scope('requests'))
            WHEN 'ALL'  THEN true
            WHEN 'MINE' THEN false
            ELSE EXISTS (
                SELECT 1 FROM public.employees e
                 WHERE e.id = approval_requests.employee_id
                   AND e.branch_id = (SELECT public.auth_employee_branch_id()))
        END
    )
    OR (
        (NOT public.es_solicitud_operativa(type))
        AND (SELECT public.auth_has_module_permission('requests_personales', 'can_view'))
        AND CASE (SELECT public.auth_module_scope('requests_personales'))
            WHEN 'ALL'  THEN true
            WHEN 'MINE' THEN false
            ELSE EXISTS (
                SELECT 1 FROM public.employees e
                 WHERE e.id = approval_requests.employee_id
                   AND e.branch_id = (SELECT public.auth_employee_branch_id()))
        END
    )
    OR (
        type = 'INVENTORY_TRANSFER_REQUEST'
        AND (SELECT public.auth_has_module_permission('traslados', 'can_approve'))
        AND (
            (SELECT public.auth_module_scope('traslados')) = 'ALL'
            OR (NULLIF(metadata ->> 'origen_branch_id', ''))::integer = (SELECT public.auth_employee_branch_id())
            OR (NULLIF(metadata ->> 'branch_id', ''))::integer        = (SELECT public.auth_employee_branch_id())
            -- La sala de respaldo: sólo lo que falta contestar, y sólo mientras
            -- la sala que tiene el producto está cerrada.
            OR (
                status = 'PENDING'
                AND (NULLIF(metadata ->> 'origen_branch_id', ''))::integer
                    = ANY (COALESCE((SELECT public.salas_que_cubro_ahora()), ARRAY[]::integer[]))
            )
        )
    )
);

DROP POLICY IF EXISTS approval_requests_update ON public.approval_requests;

CREATE POLICY approval_requests_update ON public.approval_requests
FOR UPDATE TO public
USING (
    (
        public.modulo_de_aprobacion(type) = 'requests_facturacion'
        AND (SELECT public.auth_has_module_permission('requests_facturacion', 'can_approve'))
        AND CASE (SELECT public.auth_module_scope('requests_facturacion'))
            WHEN 'ALL'  THEN true
            WHEN 'MINE' THEN false
            ELSE EXISTS (
                SELECT 1 FROM public.employees e
                 WHERE e.id = approval_requests.employee_id
                   AND e.branch_id = (SELECT public.auth_employee_branch_id()))
        END
    )
    OR (
        public.modulo_de_aprobacion(type) = 'requests_inventario'
        AND (SELECT public.auth_has_module_permission('requests_inventario', 'can_approve'))
        AND CASE (SELECT public.auth_module_scope('requests_inventario'))
            WHEN 'ALL'  THEN true
            WHEN 'MINE' THEN false
            ELSE EXISTS (
                SELECT 1 FROM public.employees e
                 WHERE e.id = approval_requests.employee_id
                   AND e.branch_id = (SELECT public.auth_employee_branch_id()))
        END
    )
    OR (
        (NOT public.es_solicitud_operativa(type))
        AND (SELECT public.auth_has_module_permission('requests_personales', 'can_approve'))
        AND CASE (SELECT public.auth_module_scope('requests_personales'))
            WHEN 'ALL'  THEN true
            WHEN 'MINE' THEN false
            ELSE EXISTS (
                SELECT 1 FROM public.employees e
                 WHERE e.id = approval_requests.employee_id
                   AND e.branch_id = (SELECT public.auth_employee_branch_id()))
        END
    )
    OR (
        type = 'INVENTORY_TRANSFER_REQUEST'
        AND (SELECT public.auth_has_module_permission('traslados', 'can_approve'))
        AND (
            (SELECT public.auth_module_scope('traslados')) = 'ALL'
            OR (NULLIF(metadata ->> 'origen_branch_id', ''))::integer = (SELECT public.auth_employee_branch_id())
            OR (NULLIF(metadata ->> 'branch_id', ''))::integer        = (SELECT public.auth_employee_branch_id())
            OR (
                status = 'PENDING'
                AND (NULLIF(metadata ->> 'origen_branch_id', ''))::integer
                    = ANY (COALESCE((SELECT public.salas_que_cubro_ahora()), ARRAY[]::integer[]))
            )
        )
    )
    OR (employee_id = (SELECT public.auth_employee_id()) AND status = 'PENDING')
    OR (
        type = 'SHIFT_CHANGE' AND status = 'PENDING'
        AND approver_id = (SELECT public.auth_employee_id())
        AND employee_id <> (SELECT public.auth_employee_id())
    )
)
WITH CHECK (
    (
        public.modulo_de_aprobacion(type) = 'requests_facturacion'
        AND (SELECT public.auth_has_module_permission('requests_facturacion', 'can_approve'))
        AND CASE (SELECT public.auth_module_scope('requests_facturacion'))
            WHEN 'ALL'  THEN true
            WHEN 'MINE' THEN false
            ELSE EXISTS (
                SELECT 1 FROM public.employees e
                 WHERE e.id = approval_requests.employee_id
                   AND e.branch_id = (SELECT public.auth_employee_branch_id()))
        END
    )
    OR (
        public.modulo_de_aprobacion(type) = 'requests_inventario'
        AND (SELECT public.auth_has_module_permission('requests_inventario', 'can_approve'))
        AND CASE (SELECT public.auth_module_scope('requests_inventario'))
            WHEN 'ALL'  THEN true
            WHEN 'MINE' THEN false
            ELSE EXISTS (
                SELECT 1 FROM public.employees e
                 WHERE e.id = approval_requests.employee_id
                   AND e.branch_id = (SELECT public.auth_employee_branch_id()))
        END
    )
    OR (
        (NOT public.es_solicitud_operativa(type))
        AND (SELECT public.auth_has_module_permission('requests_personales', 'can_approve'))
        AND CASE (SELECT public.auth_module_scope('requests_personales'))
            WHEN 'ALL'  THEN true
            WHEN 'MINE' THEN false
            ELSE EXISTS (
                SELECT 1 FROM public.employees e
                 WHERE e.id = approval_requests.employee_id
                   AND e.branch_id = (SELECT public.auth_employee_branch_id()))
        END
    )
    OR (
        type = 'INVENTORY_TRANSFER_REQUEST'
        AND (SELECT public.auth_has_module_permission('traslados', 'can_approve'))
        AND (
            (SELECT public.auth_module_scope('traslados')) = 'ALL'
            OR (NULLIF(metadata ->> 'origen_branch_id', ''))::integer = (SELECT public.auth_employee_branch_id())
            OR (NULLIF(metadata ->> 'branch_id', ''))::integer        = (SELECT public.auth_employee_branch_id())
            -- Sin `status = 'PENDING'` a propósito: acá se mira la fila NUEVA,
            -- que es la que acaba de dejar de estar pendiente. Ver el
            -- encabezado. El USING ya cobró que la vieja lo estuviera.
            OR (NULLIF(metadata ->> 'origen_branch_id', ''))::integer
                = ANY (COALESCE((SELECT public.salas_que_cubro_ahora()), ARRAY[]::integer[]))
        )
    )
    OR (employee_id = (SELECT public.auth_employee_id()) AND status = 'CANCELLED')
    OR (type = 'SHIFT_CHANGE' AND employee_id <> (SELECT public.auth_employee_id()))
);
