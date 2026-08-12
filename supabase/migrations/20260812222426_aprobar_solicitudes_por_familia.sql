-- Aprobar solicitudes deja de ser UN interruptor y pasa a ser uno por familia.
--
-- Hasta ahora `requests.can_approve` habilitaba las SIETE clases de solicitud
-- operativa de una sola vez: anular una factura, cambiarle el cliente, cargar
-- inventario, descartarlo y confirmar un traslado. Quien podía una, podía
-- todas. El usuario pidió separarlas para poder delegar sólo una parte cuando
-- se va de vacaciones.
--
-- ── El reparto ────────────────────────────────────────────────────────────
--   facturación  → requests_facturacion   (anulación, pago, vendedor, cliente)
--   inventario   → requests_inventario    (cargas y descartes)
--   traslados    → `traslados`, que YA existía con su propio `can_approve`
--   Min/Max      → `minmax`, ídem
--
-- Los dos últimos NO se duplican acá a propósito. Tener el mismo permiso
-- escrito en dos módulos es la trampa de las dos definiciones de superusuario:
-- se contradicen en cuanto alguien toca una sola. La pantalla de Permisos los
-- muestra juntos; la base los guarda una vez.
--
-- ── Por qué la rama de traslados de la policy NO se toca ──────────────────
-- `approval_requests_update` ya tiene una rama propia para
-- INVENTORY_TRANSFER con condiciones extra: ser destinatario, o ser JEFE de la
-- sala de origen, o estar en turno en la de destino. Si los traslados
-- entraran también por la rama nueva, esa rama de abajo quedaría de adorno:
-- bastaría `traslados.can_approve` para aprobar cualquiera, sin las
-- condiciones. Así que los traslados SALEN de la rama operativa y se quedan
-- sólo en la suya.
--
-- Medido antes de escribir esto: los dos únicos cargos con
-- `requests.can_approve` (Supervisor/a de Ventas y QA) tienen también
-- `traslados.can_approve` con alcance ALL, así que no pierden nada. Y en el
-- INSERT los traslados salen sin reemplazo: se pierde sólo poder CREAR un
-- traslado a nombre de otra persona, que nadie hace —los crea la sala para sí
-- misma— y es un cambio que cierra, no que abre.
--
-- ── El argumento tiene que ser CONSTANTE ──────────────────────────────────
-- Da la tentación de escribir `auth_has_module_permission(modulo_de(type), …)`
-- y resolverlo en una línea. No: ese argumento depende de la FILA, así que ya
-- no se puede envolver en `(SELECT …)` y Postgres evalúa la función una vez
-- por fila — que es exactamente lo que tumbó el portal el 2026-07-08 (25.000 ms
-- contra 19 ms en sales_invoices). Por eso va una rama por familia con el
-- módulo escrito como literal: así cada `auth_*` conserva su initplan y lo
-- único que se evalúa por fila es la comparación de texto, que es inmutable y
-- no toca ninguna tabla.

SET lock_timeout = '5s';

-- ── 1 · El mapa tipo → módulo ─────────────────────────────────────────────
-- Devuelve NULL para lo que no es de estas dos familias (traslados incluidos):
-- así un tipo nuevo sin clasificar NO cae por accidente en un permiso
-- existente, que es el mismo criterio con el que `es_solicitud_operativa` deja
-- lo desconocido del lado cerrado.
CREATE OR REPLACE FUNCTION public.modulo_de_aprobacion(p_type text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public, extensions
AS $$
  SELECT CASE
    WHEN p_type = ANY (ARRAY['ANNULMENT_REQUEST', 'PAYMENT_CHANGE_REQUEST',
                             'VENDOR_CHANGE_REQUEST', 'CLIENT_CHANGE_REQUEST'])
      THEN 'requests_facturacion'
    WHEN p_type = ANY (ARRAY['INVENTORY_LOAD_REQUEST', 'INVENTORY_DISCARD_REQUEST'])
      THEN 'requests_inventario'
    ELSE NULL
  END;
$$;

REVOKE EXECUTE ON FUNCTION public.modulo_de_aprobacion(text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.modulo_de_aprobacion(text) TO authenticated, service_role;

COMMENT ON FUNCTION public.modulo_de_aprobacion(text) IS
  'Que modulo de permisos gobierna aprobar una solicitud de este tipo. NULL = ninguno de los dos nuevos (traslados y personales van por su propia rama).';

-- ── 2 · Sembrar los dos módulos nuevos con lo que hoy vale ────────────────
-- Nadie gana ni pierde nada con esta migración: quien podía aprobar las siete
-- clases sigue pudiendo las cinco que se reparten acá, con su mismo alcance.
-- `can_view` va en false porque estos módulos no abren ninguna pantalla — la
-- bandeja se sigue abriendo con `requests.can_view`, que no se toca.
INSERT INTO public.role_permissions (role_id, module_key, can_view, can_edit, can_approve, scope)
SELECT rp.role_id, m.module_key, false, false, rp.can_approve, rp.scope
FROM public.role_permissions rp
CROSS JOIN (VALUES ('requests_facturacion'), ('requests_inventario')) AS m(module_key)
WHERE rp.module_key = 'requests'
ON CONFLICT (role_id, module_key) DO UPDATE
  SET can_approve = EXCLUDED.can_approve,
      scope       = EXCLUDED.scope,
      updated_at  = now()
  WHERE role_permissions.can_approve IS DISTINCT FROM EXCLUDED.can_approve
     OR role_permissions.scope       IS DISTINCT FROM EXCLUDED.scope;

-- ── 3 · Las policies ──────────────────────────────────────────────────────
-- Sólo cambia la rama operativa. La de personales y la de traslados se copian
-- tal cual estaban: van completas y no abreviadas porque una policy se
-- reemplaza entera, y omitir una rama por descuido es quitarle el acceso a
-- alguien sin que nada falle.

DROP POLICY IF EXISTS approval_requests_update ON public.approval_requests;
CREATE POLICY approval_requests_update ON public.approval_requests
FOR UPDATE
USING (
  -- ── facturación ──
  (modulo_de_aprobacion(type) = 'requests_facturacion'
   AND (SELECT auth_has_module_permission('requests_facturacion', 'can_approve'))
   AND CASE (SELECT auth_module_scope('requests_facturacion'))
         WHEN 'ALL'  THEN true
         WHEN 'MINE' THEN false
         ELSE EXISTS (SELECT 1 FROM employees e
                       WHERE e.id = approval_requests.employee_id
                         AND e.branch_id = (SELECT auth_employee_branch_id()))
       END)
  -- ── inventario ──
  OR (modulo_de_aprobacion(type) = 'requests_inventario'
   AND (SELECT auth_has_module_permission('requests_inventario', 'can_approve'))
   AND CASE (SELECT auth_module_scope('requests_inventario'))
         WHEN 'ALL'  THEN true
         WHEN 'MINE' THEN false
         ELSE EXISTS (SELECT 1 FROM employees e
                       WHERE e.id = approval_requests.employee_id
                         AND e.branch_id = (SELECT auth_employee_branch_id()))
       END)
  -- ── personales (sin cambios) ──
  OR ((NOT es_solicitud_operativa(type))
   AND (SELECT auth_has_module_permission('requests_personales', 'can_approve'))
   AND CASE (SELECT auth_module_scope('requests_personales'))
         WHEN 'ALL'  THEN true
         WHEN 'MINE' THEN false
         ELSE EXISTS (SELECT 1 FROM employees e
                       WHERE e.id = approval_requests.employee_id
                         AND e.branch_id = (SELECT auth_employee_branch_id()))
       END)
  -- ── traslados (sin cambios: conserva sus condiciones propias) ──
  OR (type = 'INVENTORY_TRANSFER_REQUEST'
   AND (SELECT auth_has_module_permission('traslados', 'can_approve'))
   AND ((SELECT auth_module_scope('traslados')) = 'ALL'
        OR (metadata -> 'destinatarios') ? ((SELECT auth_employee_id()))::text
        OR ((NULLIF(metadata ->> 'origen_branch_id', ''))::integer = (SELECT auth_employee_branch_id())
            AND (SELECT auth_employee_system_role()) = ANY (ARRAY['JEFE', 'SUBJEFE']))
        OR ((NULLIF(metadata ->> 'branch_id', ''))::integer = (SELECT auth_employee_branch_id())
            AND ((SELECT auth_employee_system_role()) = ANY (ARRAY['JEFE', 'SUBJEFE'])
                 OR (SELECT estoy_en_turno())))))
  -- ── la propia, y el cambio de turno (sin cambios) ──
  OR (employee_id = (SELECT auth_employee_id()) AND status = 'PENDING')
  OR (type = 'SHIFT_CHANGE' AND status = 'PENDING'
      AND approver_id = (SELECT auth_employee_id())
      AND employee_id <> (SELECT auth_employee_id()))
)
WITH CHECK (
  (modulo_de_aprobacion(type) = 'requests_facturacion'
   AND (SELECT auth_has_module_permission('requests_facturacion', 'can_approve'))
   AND CASE (SELECT auth_module_scope('requests_facturacion'))
         WHEN 'ALL'  THEN true
         WHEN 'MINE' THEN false
         ELSE EXISTS (SELECT 1 FROM employees e
                       WHERE e.id = approval_requests.employee_id
                         AND e.branch_id = (SELECT auth_employee_branch_id()))
       END)
  OR (modulo_de_aprobacion(type) = 'requests_inventario'
   AND (SELECT auth_has_module_permission('requests_inventario', 'can_approve'))
   AND CASE (SELECT auth_module_scope('requests_inventario'))
         WHEN 'ALL'  THEN true
         WHEN 'MINE' THEN false
         ELSE EXISTS (SELECT 1 FROM employees e
                       WHERE e.id = approval_requests.employee_id
                         AND e.branch_id = (SELECT auth_employee_branch_id()))
       END)
  OR ((NOT es_solicitud_operativa(type))
   AND (SELECT auth_has_module_permission('requests_personales', 'can_approve'))
   AND CASE (SELECT auth_module_scope('requests_personales'))
         WHEN 'ALL'  THEN true
         WHEN 'MINE' THEN false
         ELSE EXISTS (SELECT 1 FROM employees e
                       WHERE e.id = approval_requests.employee_id
                         AND e.branch_id = (SELECT auth_employee_branch_id()))
       END)
  OR (type = 'INVENTORY_TRANSFER_REQUEST'
   AND (SELECT auth_has_module_permission('traslados', 'can_approve'))
   AND ((SELECT auth_module_scope('traslados')) = 'ALL'
        OR (metadata -> 'destinatarios') ? ((SELECT auth_employee_id()))::text
        OR ((NULLIF(metadata ->> 'origen_branch_id', ''))::integer = (SELECT auth_employee_branch_id())
            AND (SELECT auth_employee_system_role()) = ANY (ARRAY['JEFE', 'SUBJEFE']))
        OR ((NULLIF(metadata ->> 'branch_id', ''))::integer = (SELECT auth_employee_branch_id())
            AND ((SELECT auth_employee_system_role()) = ANY (ARRAY['JEFE', 'SUBJEFE'])
                 OR (SELECT estoy_en_turno())))))
  -- Cancelar la propia. OJO: acá el estado es CANCELLED, no PENDING como en el
  -- USING — el USING mira la fila que había y el CHECK la que queda.
  OR (employee_id = (SELECT auth_employee_id()) AND status = 'CANCELLED')
  OR (type = 'SHIFT_CHANGE' AND employee_id <> (SELECT auth_employee_id()))
);

DROP POLICY IF EXISTS approval_requests_insert ON public.approval_requests;
CREATE POLICY approval_requests_insert ON public.approval_requests
FOR INSERT
WITH CHECK (
  -- La propia: cualquiera pide para sí mismo.
  employee_id = (SELECT auth_employee_id())
  -- A nombre de otro, sólo quien puede aprobar esa familia.
  OR (modulo_de_aprobacion(type) = 'requests_facturacion'
   AND (SELECT auth_has_module_permission('requests_facturacion', 'can_approve'))
   AND ((SELECT auth_module_scope('requests_facturacion')) = 'ALL'
        OR EXISTS (SELECT 1 FROM employees e
                    WHERE e.id = approval_requests.employee_id
                      AND e.branch_id = (SELECT auth_employee_branch_id()))))
  OR (modulo_de_aprobacion(type) = 'requests_inventario'
   AND (SELECT auth_has_module_permission('requests_inventario', 'can_approve'))
   AND ((SELECT auth_module_scope('requests_inventario')) = 'ALL'
        OR EXISTS (SELECT 1 FROM employees e
                    WHERE e.id = approval_requests.employee_id
                      AND e.branch_id = (SELECT auth_employee_branch_id()))))
  OR ((NOT es_solicitud_operativa(type))
   AND (SELECT auth_has_module_permission('requests_personales', 'can_approve'))
   AND ((SELECT auth_module_scope('requests_personales')) = 'ALL'
        OR EXISTS (SELECT 1 FROM employees e
                    WHERE e.id = approval_requests.employee_id
                      AND e.branch_id = (SELECT auth_employee_branch_id()))))
);

-- `approval_requests_select` NO se toca: ver la bandeja sigue siendo
-- `requests.can_view`, un solo interruptor. Lo que se reparte es decidir, no
-- mirar — y el usuario pidió expresamente que quien cubra vea la bandeja
-- completa.
