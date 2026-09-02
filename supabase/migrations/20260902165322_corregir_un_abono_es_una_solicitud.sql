SET lock_timeout = '5s';

/* ── Corregir un abono es una SOLICITUD, y la decide su propio permiso ─────
 *
 * Pedido del usuario (2-sep): «si se quiere editar un abono, no permite; que
 * sea como solicitud a supervisor … la solicitud sería de edición o anulación.
 * Edición por monto o tipo de pago». Y sobre el permiso: «agregalo aquí, para
 * asignarle a otras personas también».
 *
 * ── Editar es BORRAR y volver a abonar ────────────────────────────────────
 * Decisión del usuario, y es la única que el sistema de origen permite: su
 * panel de crédito abona y borra, no edita. Auditado el 2-sep — la acción de
 * borrado se llama `quitar` y lleva el id del abono. Así que «corregir el monto»
 * se aplica como *quitar el viejo y abonar el nuevo*, y eso deja dos renglones
 * en el historial de allá: es más ruidoso que un UPDATE y es la verdad, porque
 * un abono que se corrigió no es el mismo abono.
 *
 * ── Módulo propio y no `requests_caja` ────────────────────────────────────
 * Son dos públicos: quien corrige un vale del cajón no es necesariamente quien
 * decide sobre la cartera de créditos. Con un solo interruptor, dar uno regala
 * el otro — que es exactamente lo que el usuario pidió evitar.
 */

-- 1. El tipo. Se listan TODOS y no se agrega «uno más» a ciegas: un CHECK que
--    nadie lee entero termina aceptando valores que ninguna pantalla sabe
--    mostrar.
ALTER TABLE public.approval_requests
    DROP CONSTRAINT IF EXISTS approval_requests_type_check;

ALTER TABLE public.approval_requests
    ADD CONSTRAINT approval_requests_type_check CHECK (type IN (
        'PERMISSION','VACATION','SICK_LEAVE','SCHEDULE_CHANGE','SHIFT_CHANGE','OTHER',
        'ANNULMENT_REQUEST','PAYMENT_CHANGE_REQUEST','VENDOR_CHANGE_REQUEST',
        'CLIENT_CHANGE_REQUEST',
        'INVENTORY_TRANSFER_REQUEST','INVENTORY_TRANSFER_PUSH',
        'INVENTORY_DISCARD_REQUEST','INVENTORY_LOAD_REQUEST',
        'MINMAX_CHANGE_REQUEST',
        'CAJA_MOVIMIENTO_CHANGE',
        'ABONO_CREDITO_CHANGE'
    )) NOT VALID;

-- `NOT VALID` y después `VALIDATE`: así el ALTER no bloquea la tabla mientras
-- revisa las filas viejas, que es la regla de esta base para DDL sobre algo que
-- se escribe seguido.
ALTER TABLE public.approval_requests VALIDATE CONSTRAINT approval_requests_type_check;

-- 2. Es OPERATIVA. Sin esto, la policy de SELECT la mete en la rama de lo NO
--    operativo y para verla haría falta `requests_personales` — o sea que una
--    corrección sobre dinero aparecería en la bandeja de vacaciones. Ya pasó
--    con la corrección de caja.
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
    'CAJA_MOVIMIENTO_CHANGE',
    'ABONO_CREDITO_CHANGE'
  ]);
$function$;

-- 3. Quién la decide.
CREATE OR REPLACE FUNCTION public.modulo_de_aprobacion(p_type text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'extensions'
AS $function$
  SELECT CASE
    WHEN p_type = ANY (ARRAY['ANNULMENT_REQUEST', 'PAYMENT_CHANGE_REQUEST',
                             'VENDOR_CHANGE_REQUEST', 'CLIENT_CHANGE_REQUEST'])
      THEN 'requests_facturacion'
    WHEN p_type = ANY (ARRAY['INVENTORY_LOAD_REQUEST', 'INVENTORY_DISCARD_REQUEST'])
      THEN 'requests_inventario'
    WHEN p_type = 'CAJA_MOVIMIENTO_CHANGE'
      THEN 'requests_caja'
    WHEN p_type = 'ABONO_CREDITO_CHANGE'
      THEN 'requests_cuentas_por_cobrar'
    ELSE NULL
  END;
$function$;

-- 4. La policy de UPDATE, con la familia nueva. Se reescribe entera —no hay
--    forma de sumarle una rama a un `USING`— y queda igual a la que había salvo
--    ese bloque. Sin esto se podría APROBAR (lo escribe la edge function con la
--    llave del servidor, que no pasa por RLS) y no RECHAZAR, que lo hace el
--    navegador: el rechazo fallaría sin decir por qué.
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
  OR ((modulo_de_aprobacion(type) = 'requests_caja')
    AND (SELECT auth_has_module_permission('requests_caja','can_approve'))
    AND (((SELECT auth_module_scope('requests_caja')) = 'ALL')
         OR (NULLIF(metadata ->> 'branch_id','')::integer
             = (SELECT auth_employee_branch_id()))))
  -- La familia nueva. El ámbito se mide contra la SALA DEL CRÉDITO
  -- (`metadata->>'branch_id'`) y no contra la sucursal de quien la pidió: el
  -- abono es de una caja, y quien lo cobró puede estar de paso en otra sala.
  OR ((modulo_de_aprobacion(type) = 'requests_cuentas_por_cobrar')
    AND (SELECT auth_has_module_permission('requests_cuentas_por_cobrar','can_approve'))
    AND (((SELECT auth_module_scope('requests_cuentas_por_cobrar')) = 'ALL')
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

/* 5. El permiso arranca en quien ya decide sobre la caja: son las personas que
 *    hoy resuelven una corrección de efectivo, así que el circuito funciona
 *    desde el primer día. Que sea un módulo aparte es lo que deja quitárselo a
 *    unos y dárselo a otros sin tocar el de caja. */
INSERT INTO public.role_permissions (role_id, module_key, can_view, can_edit, can_approve, scope)
SELECT role_id, 'requests_cuentas_por_cobrar', can_view, can_edit, can_approve, scope
FROM public.role_permissions
WHERE module_key = 'requests_caja'
ON CONFLICT (role_id, module_key) DO NOTHING;
