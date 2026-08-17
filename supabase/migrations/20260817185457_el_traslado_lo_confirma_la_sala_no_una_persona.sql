-- Un traslado lo confirma LA SALA, no una persona.
--
-- Reportado: «los traslados entre sala deben poder los vendedores de la
-- sucursal poderlos aprobar; esa solicitud de Rodrigo que es para Salud 5, otro
-- vendedor de Salud 5 no lo puede confirmar ni le sale».
--
-- ── Lo medido en prod el 2026-08-17 ────────────────────────────────────────
-- El traslado de Rodrigo sale de Salud 5 (origen, la que TIENE el producto) y
-- va a Salud 3 (destino, la que pidió). Salud 5 tiene 5 personas activas y UNA
-- sola con `system_role = 'JEFE'`; las otras cuatro son 'EMPLEADO' —tres
-- Dependientes de Farmacia y una Regente de Enfermería—. Las cinco tienen
-- `traslados.can_approve` con alcance BRANCH: **el permiso ya estaba
-- concedido**, y la pantalla ya pintaba el botón mirando ese mismo permiso
-- (`TarjetaSolicitud`, `hasPermission('traslados','can_approve')`).
--
-- Lo que las frenaba era esta policy, que sobre la sala de ORIGEN exigía
-- ADEMÁS `system_role IN ('JEFE','SUBJEFE')`. En toda la empresa hay 7 JEFE y
-- 2 SUBJEFE para 8 salas, así que cada traslado quedaba colgado de que una
-- persona concreta abriera el portal.
--
-- La válvula de escape existía pero del lado equivocado: `estoy_en_turno()`
-- sólo estaba en la rama de la sala de DESTINO, que es la que PIDE y no tiene
-- nada que confirmar. Y encima está muerta: esa semana había OCHO personas con
-- horario publicado en toda la empresa y Salud 5 tenía CERO, así que
-- `empleados_en_turno(29)` devolvía vacío. Las 9 solicitudes de traslado de
-- toda la historia tienen `escalon_aviso = 'JEFATURA'`: la cascada NUNCA
-- encontró a nadie en turno, ni una vez.
--
-- ── Qué cambia ─────────────────────────────────────────────────────────────
-- La regla pasa a ser una sola, sin condición de cargo ni de horario:
-- **cualquiera de las dos salas involucradas, con `traslados.can_approve`**.
-- El permiso del módulo vuelve a ser lo que decide, que es para lo que está.
--
-- Y la cascada de destinatarios deja de elegir una persona: avisa a la sala
-- entera que puede confirmar. Era el otro medio arreglo — sin esto la
-- solicitud se vuelve visible para los cuatro pero la campana le sigue sonando
-- a uno, y nadie se entera de que hay algo que contestar.
--
-- La MISMA regla vive en `supabase/functions/aplicar-traslado-inventario`, que
-- usa la llave de servicio y por lo tanto el RLS no la frena. Se movieron en el
-- mismo commit: separadas, la pantalla ofrece el botón y el despacho lo rebota
-- con 403.
--
-- Alcance: SÓLO traslados (decisión del usuario, 2026-08-17). Las otras tres
-- familias —facturación, ajustes de inventario, Min/Max— quedan letra por
-- letra como estaban; verificado por md5 del texto de la policy antes y
-- después, en staging y en prod.
--
-- Nota de rendimiento: la rama del traslado queda con CUATRO llamadas `auth_*`,
-- todas envueltas en `(SELECT …)` —initplan, una evaluación por consulta y no
-- por fila— y pierde `auth_employee_system_role()` y `estoy_en_turno()`. Esta
-- última entraba a `empleados_en_turno()` en CADA evaluación. Es la regla del
-- incidente 2026-07-08 y acá el saldo es a favor.
--
-- Probada primero en el branch de staging (cbnjplmnfmfsambavjce).

SET lock_timeout = '5s';

-- ── 1 · La cascada avisa a la sala, no a quien esté de turno ────────────────
-- Los escalones 'TURNO' y 'JEFATURA' se funden en 'SALA'. `escalon_aviso` se
-- guarda en el metadata y no lo lee NADIE en la aplicación (verificado por grep
-- sobre `src/` y `supabase/functions/`), así que cambiar sus valores no rompe
-- ninguna pantalla; queda como rastro de por dónde salió el aviso.
CREATE OR REPLACE FUNCTION public.resolver_destinatarios_traslado(p_branch_id integer)
RETURNS TABLE(destinatarios uuid[], escalon text)
LANGUAGE plpgsql
STABLE
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v uuid[];
BEGIN
    -- 1 · toda la sala que puede confirmar.
    --
    -- Antes acá había dos escalones: primero quien estuviera EN TURNO y, si no
    -- había nadie, la jefatura. El primero no encontró a nadie ni una sola vez
    -- —depende de horarios publicados, y casi no los hay— así que en la
    -- práctica el traslado siempre cayó en una persona. Hoy es la sala.
    SELECT array_agg(e.id ORDER BY e.name)
      INTO v
      FROM public.employees e
     WHERE e.branch_id = p_branch_id
       AND e.status = 'ACTIVO'
       AND public.puede_confirmar_traslado(e.id);
    IF coalesce(array_length(v, 1), 0) > 0 THEN
        RETURN QUERY SELECT v, 'SALA'::text;
        RETURN;
    END IF;

    -- 2 · Supervisión, que sigue siendo el último respaldo.
    SELECT array_agg(e.id ORDER BY e.name)
      INTO v
      FROM public.employees e
     WHERE e.status = 'ACTIVO'
       AND e.system_role IN ('SUPERVISOR', 'ADMIN', 'SUPERADMIN')
       AND public.puede_confirmar_traslado(e.id);
    RETURN QUERY SELECT v, CASE WHEN coalesce(array_length(v, 1), 0) > 0
                                THEN 'SUPERVISION' ELSE 'NADIE' END;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.resolver_destinatarios_traslado(integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.resolver_destinatarios_traslado(integer) TO authenticated, service_role;

-- ── 2 · Las policies ────────────────────────────────────────────────────────
-- `ALTER POLICY` y no `DROP` + `CREATE`: no deja a la tabla ni un instante sin
-- su regla, ni siquiera si la migración fallara a mitad de camino.
--
-- Sólo cambia la rama del traslado. Las otras tres quedan idénticas.

ALTER POLICY approval_requests_select ON public.approval_requests
USING (
    (employee_id = (SELECT auth_employee_id()))
    OR (es_solicitud_operativa(type)
        AND (SELECT auth_has_module_permission('requests', 'can_view'))
        AND CASE (SELECT auth_module_scope('requests'))
              WHEN 'ALL'  THEN true
              WHEN 'MINE' THEN false
              ELSE (EXISTS (SELECT 1 FROM employees e
                             WHERE e.id = approval_requests.employee_id
                               AND e.branch_id = (SELECT auth_employee_branch_id())))
            END)
    OR ((NOT es_solicitud_operativa(type))
        AND (SELECT auth_has_module_permission('requests_personales', 'can_view'))
        AND CASE (SELECT auth_module_scope('requests_personales'))
              WHEN 'ALL'  THEN true
              WHEN 'MINE' THEN false
              ELSE (EXISTS (SELECT 1 FROM employees e
                             WHERE e.id = approval_requests.employee_id
                               AND e.branch_id = (SELECT auth_employee_branch_id())))
            END)
    -- El traslado: cualquiera de las dos salas involucradas que tenga el
    -- permiso del módulo. Sin cargo y sin horario.
    OR ((type = 'INVENTORY_TRANSFER_REQUEST')
        AND (SELECT auth_has_module_permission('traslados', 'can_approve'))
        AND (((SELECT auth_module_scope('traslados')) = 'ALL')
             OR ((metadata -> 'destinatarios') ? ((SELECT auth_employee_id()))::text)
             OR ((NULLIF((metadata ->> 'origen_branch_id'), ''))::integer = (SELECT auth_employee_branch_id()))
             OR ((NULLIF((metadata ->> 'branch_id'),        ''))::integer = (SELECT auth_employee_branch_id()))))
);

ALTER POLICY approval_requests_update ON public.approval_requests
USING (
    ((modulo_de_aprobacion(type) = 'requests_facturacion')
        AND (SELECT auth_has_module_permission('requests_facturacion', 'can_approve'))
        AND CASE (SELECT auth_module_scope('requests_facturacion'))
              WHEN 'ALL'  THEN true
              WHEN 'MINE' THEN false
              ELSE (EXISTS (SELECT 1 FROM employees e
                             WHERE e.id = approval_requests.employee_id
                               AND e.branch_id = (SELECT auth_employee_branch_id())))
            END)
    OR ((modulo_de_aprobacion(type) = 'requests_inventario')
        AND (SELECT auth_has_module_permission('requests_inventario', 'can_approve'))
        AND CASE (SELECT auth_module_scope('requests_inventario'))
              WHEN 'ALL'  THEN true
              WHEN 'MINE' THEN false
              ELSE (EXISTS (SELECT 1 FROM employees e
                             WHERE e.id = approval_requests.employee_id
                               AND e.branch_id = (SELECT auth_employee_branch_id())))
            END)
    OR ((NOT es_solicitud_operativa(type))
        AND (SELECT auth_has_module_permission('requests_personales', 'can_approve'))
        AND CASE (SELECT auth_module_scope('requests_personales'))
              WHEN 'ALL'  THEN true
              WHEN 'MINE' THEN false
              ELSE (EXISTS (SELECT 1 FROM employees e
                             WHERE e.id = approval_requests.employee_id
                               AND e.branch_id = (SELECT auth_employee_branch_id())))
            END)
    OR ((type = 'INVENTORY_TRANSFER_REQUEST')
        AND (SELECT auth_has_module_permission('traslados', 'can_approve'))
        AND (((SELECT auth_module_scope('traslados')) = 'ALL')
             OR ((metadata -> 'destinatarios') ? ((SELECT auth_employee_id()))::text)
             OR ((NULLIF((metadata ->> 'origen_branch_id'), ''))::integer = (SELECT auth_employee_branch_id()))
             OR ((NULLIF((metadata ->> 'branch_id'),        ''))::integer = (SELECT auth_employee_branch_id()))))
    OR ((employee_id = (SELECT auth_employee_id())) AND (status = 'PENDING'))
    OR ((type = 'SHIFT_CHANGE') AND (status = 'PENDING')
        AND (approver_id = (SELECT auth_employee_id()))
        AND (employee_id <> (SELECT auth_employee_id())))
)
WITH CHECK (
    ((modulo_de_aprobacion(type) = 'requests_facturacion')
        AND (SELECT auth_has_module_permission('requests_facturacion', 'can_approve'))
        AND CASE (SELECT auth_module_scope('requests_facturacion'))
              WHEN 'ALL'  THEN true
              WHEN 'MINE' THEN false
              ELSE (EXISTS (SELECT 1 FROM employees e
                             WHERE e.id = approval_requests.employee_id
                               AND e.branch_id = (SELECT auth_employee_branch_id())))
            END)
    OR ((modulo_de_aprobacion(type) = 'requests_inventario')
        AND (SELECT auth_has_module_permission('requests_inventario', 'can_approve'))
        AND CASE (SELECT auth_module_scope('requests_inventario'))
              WHEN 'ALL'  THEN true
              WHEN 'MINE' THEN false
              ELSE (EXISTS (SELECT 1 FROM employees e
                             WHERE e.id = approval_requests.employee_id
                               AND e.branch_id = (SELECT auth_employee_branch_id())))
            END)
    OR ((NOT es_solicitud_operativa(type))
        AND (SELECT auth_has_module_permission('requests_personales', 'can_approve'))
        AND CASE (SELECT auth_module_scope('requests_personales'))
              WHEN 'ALL'  THEN true
              WHEN 'MINE' THEN false
              ELSE (EXISTS (SELECT 1 FROM employees e
                             WHERE e.id = approval_requests.employee_id
                               AND e.branch_id = (SELECT auth_employee_branch_id())))
            END)
    OR ((type = 'INVENTORY_TRANSFER_REQUEST')
        AND (SELECT auth_has_module_permission('traslados', 'can_approve'))
        AND (((SELECT auth_module_scope('traslados')) = 'ALL')
             OR ((metadata -> 'destinatarios') ? ((SELECT auth_employee_id()))::text)
             OR ((NULLIF((metadata ->> 'origen_branch_id'), ''))::integer = (SELECT auth_employee_branch_id()))
             OR ((NULLIF((metadata ->> 'branch_id'),        ''))::integer = (SELECT auth_employee_branch_id()))))
    OR ((employee_id = (SELECT auth_employee_id())) AND (status = 'CANCELLED'))
    OR ((type = 'SHIFT_CHANGE') AND (employee_id <> (SELECT auth_employee_id())))
);

COMMENT ON FUNCTION public.resolver_destinatarios_traslado(integer) IS
  'A quién avisarle de un traslado que sale de esa sala: la sala entera que puede confirmarlo, y Supervisión si no hay nadie. Hasta el 2026-08-17 eran tres escalones (turno → jefatura → Supervisión) y el primero nunca encontró a nadie: depende de horarios publicados. Lo confirma la sala, no una persona.';
