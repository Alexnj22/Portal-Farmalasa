SET lock_timeout = '5s';

-- Un tercer alcance —«sólo míos»— y quién entra a las personales (2026-08-10).
--
-- Pedido del usuario: «ambas vistas deben contener en permisos todos los
-- necesarios: aprobar, gestionar, ver, alcance (todos, mi sucursal, míos)».
--
-- ── Por qué hace falta un tercer escalón ─────────────────────────────────
-- Hasta hoy el alcance era ALL o BRANCH, y para las solicitudes personales
-- ninguno de los dos sirve: quien manda su permiso de vacaciones no tiene por
-- qué ver el de su compañero de sala, y BRANCH le daría justo eso.
--
-- **El riesgo de agregarlo es una policy escrita a medias**: la que sólo
-- pregunta `scope = 'ALL'` y trata todo lo demás como «mi sucursal» leería MINE
-- como BRANCH y abriría de más — el valor nuevo haría lo contrario de lo que
-- promete su nombre. Por eso las dos policies se reescriben acá, en la misma
-- migración que lo introduce, y no después. De ahí el `CASE ... WHEN 'MINE'
-- THEN false`: lo propio ya pasó por la primera rama del SELECT.
--
-- `role_permissions.scope` no tiene CHECK (verificado), así que las 1,320 filas
-- existentes —ALL o BRANCH— se siguen leyendo igual.
--
-- Con alcance MINE no se decide NADA, ni siquiera lo propio: aprobarse la
-- solicitud a uno mismo no es aprobar.
--
-- ── Y quién entra a Personales ───────────────────────────────────────────
-- Decisión del usuario: «ahorita que solo tenga permiso talento humano y edwin».
-- El resto queda en false, listo para encender.

-- Las dos policies, reconstruidas del catálogo de prod (`pg_get_expr`), que es
-- exactamente lo que quedó aplicado.

DROP POLICY IF EXISTS approval_requests_select ON public.approval_requests;

CREATE POLICY approval_requests_select ON public.approval_requests
FOR SELECT TO authenticated
USING (((employee_id = ( SELECT auth_employee_id() AS auth_employee_id)) OR (es_solicitud_operativa(type) AND ( SELECT auth_has_module_permission('requests'::text, 'can_view'::text) AS auth_has_module_permission) AND
CASE ( SELECT auth_module_scope('requests'::text) AS auth_module_scope)
    WHEN 'ALL'::text THEN true
    WHEN 'MINE'::text THEN false
    ELSE (EXISTS ( SELECT 1
       FROM employees e
      WHERE ((e.id = approval_requests.employee_id) AND (e.branch_id = ( SELECT auth_employee_branch_id() AS auth_employee_branch_id)))))
END) OR ((NOT es_solicitud_operativa(type)) AND ( SELECT auth_has_module_permission('requests_personales'::text, 'can_view'::text) AS auth_has_module_permission) AND
CASE ( SELECT auth_module_scope('requests_personales'::text) AS auth_module_scope)
    WHEN 'ALL'::text THEN true
    WHEN 'MINE'::text THEN false
    ELSE (EXISTS ( SELECT 1
       FROM employees e
      WHERE ((e.id = approval_requests.employee_id) AND (e.branch_id = ( SELECT auth_employee_branch_id() AS auth_employee_branch_id)))))
END) OR ((type = 'INVENTORY_TRANSFER_REQUEST'::text) AND ( SELECT auth_has_module_permission('traslados'::text, 'can_approve'::text) AS auth_has_module_permission) AND ((( SELECT auth_module_scope('traslados'::text) AS auth_module_scope) = 'ALL'::text) OR ((metadata -> 'destinatarios'::text) ? (( SELECT auth_employee_id() AS auth_employee_id))::text) OR (((NULLIF((metadata ->> 'origen_branch_id'::text), ''::text))::integer = ( SELECT auth_employee_branch_id() AS auth_employee_branch_id)) AND (( SELECT auth_employee_system_role() AS auth_employee_system_role) = ANY (ARRAY['JEFE'::text, 'SUBJEFE'::text]))) OR (((NULLIF((metadata ->> 'branch_id'::text), ''::text))::integer = ( SELECT auth_employee_branch_id() AS auth_employee_branch_id)) AND ((( SELECT auth_employee_system_role() AS auth_employee_system_role) = ANY (ARRAY['JEFE'::text, 'SUBJEFE'::text])) OR ( SELECT estoy_en_turno() AS estoy_en_turno)))))));

DROP POLICY IF EXISTS approval_requests_update ON public.approval_requests;

CREATE POLICY approval_requests_update ON public.approval_requests
FOR UPDATE TO authenticated
USING (((es_solicitud_operativa(type) AND ( SELECT auth_has_module_permission('requests'::text, 'can_approve'::text) AS auth_has_module_permission) AND
CASE ( SELECT auth_module_scope('requests'::text) AS auth_module_scope)
    WHEN 'ALL'::text THEN true
    WHEN 'MINE'::text THEN false
    ELSE (EXISTS ( SELECT 1
       FROM employees e
      WHERE ((e.id = approval_requests.employee_id) AND (e.branch_id = ( SELECT auth_employee_branch_id() AS auth_employee_branch_id)))))
END) OR ((NOT es_solicitud_operativa(type)) AND ( SELECT auth_has_module_permission('requests_personales'::text, 'can_approve'::text) AS auth_has_module_permission) AND
CASE ( SELECT auth_module_scope('requests_personales'::text) AS auth_module_scope)
    WHEN 'ALL'::text THEN true
    WHEN 'MINE'::text THEN false
    ELSE (EXISTS ( SELECT 1
       FROM employees e
      WHERE ((e.id = approval_requests.employee_id) AND (e.branch_id = ( SELECT auth_employee_branch_id() AS auth_employee_branch_id)))))
END) OR ((type = 'INVENTORY_TRANSFER_REQUEST'::text) AND ( SELECT auth_has_module_permission('traslados'::text, 'can_approve'::text) AS auth_has_module_permission) AND ((( SELECT auth_module_scope('traslados'::text) AS auth_module_scope) = 'ALL'::text) OR ((metadata -> 'destinatarios'::text) ? (( SELECT auth_employee_id() AS auth_employee_id))::text) OR (((NULLIF((metadata ->> 'origen_branch_id'::text), ''::text))::integer = ( SELECT auth_employee_branch_id() AS auth_employee_branch_id)) AND (( SELECT auth_employee_system_role() AS auth_employee_system_role) = ANY (ARRAY['JEFE'::text, 'SUBJEFE'::text]))) OR (((NULLIF((metadata ->> 'branch_id'::text), ''::text))::integer = ( SELECT auth_employee_branch_id() AS auth_employee_branch_id)) AND ((( SELECT auth_employee_system_role() AS auth_employee_system_role) = ANY (ARRAY['JEFE'::text, 'SUBJEFE'::text])) OR ( SELECT estoy_en_turno() AS estoy_en_turno)))))))
WITH CHECK (((es_solicitud_operativa(type) AND ( SELECT auth_has_module_permission('requests'::text, 'can_approve'::text) AS auth_has_module_permission) AND
CASE ( SELECT auth_module_scope('requests'::text) AS auth_module_scope)
    WHEN 'ALL'::text THEN true
    WHEN 'MINE'::text THEN false
    ELSE (EXISTS ( SELECT 1
       FROM employees e
      WHERE ((e.id = approval_requests.employee_id) AND (e.branch_id = ( SELECT auth_employee_branch_id() AS auth_employee_branch_id)))))
END) OR ((NOT es_solicitud_operativa(type)) AND ( SELECT auth_has_module_permission('requests_personales'::text, 'can_approve'::text) AS auth_has_module_permission) AND
CASE ( SELECT auth_module_scope('requests_personales'::text) AS auth_module_scope)
    WHEN 'ALL'::text THEN true
    WHEN 'MINE'::text THEN false
    ELSE (EXISTS ( SELECT 1
       FROM employees e
      WHERE ((e.id = approval_requests.employee_id) AND (e.branch_id = ( SELECT auth_employee_branch_id() AS auth_employee_branch_id)))))
END) OR ((type = 'INVENTORY_TRANSFER_REQUEST'::text) AND ( SELECT auth_has_module_permission('traslados'::text, 'can_approve'::text) AS auth_has_module_permission) AND ((( SELECT auth_module_scope('traslados'::text) AS auth_module_scope) = 'ALL'::text) OR ((metadata -> 'destinatarios'::text) ? (( SELECT auth_employee_id() AS auth_employee_id))::text) OR (((NULLIF((metadata ->> 'origen_branch_id'::text), ''::text))::integer = ( SELECT auth_employee_branch_id() AS auth_employee_branch_id)) AND (( SELECT auth_employee_system_role() AS auth_employee_system_role) = ANY (ARRAY['JEFE'::text, 'SUBJEFE'::text]))) OR (((NULLIF((metadata ->> 'branch_id'::text), ''::text))::integer = ( SELECT auth_employee_branch_id() AS auth_employee_branch_id)) AND ((( SELECT auth_employee_system_role() AS auth_employee_system_role) = ANY (ARRAY['JEFE'::text, 'SUBJEFE'::text])) OR ( SELECT estoy_en_turno() AS estoy_en_turno)))))));

-- Quién entra hoy a Personales.
UPDATE public.role_permissions SET can_view = false, can_edit = false, can_approve = false
WHERE module_key = 'requests_personales';

UPDATE public.role_permissions
SET can_view = true, can_edit = true, can_approve = true, scope = 'ALL'
WHERE module_key = 'requests_personales'
  AND role_id IN (SELECT id FROM public.roles
                  WHERE name IN ('Jefe/a de Talento Humano', 'Supervisor/a de Ventas',
                                 'QA / Testing (CI)'));
