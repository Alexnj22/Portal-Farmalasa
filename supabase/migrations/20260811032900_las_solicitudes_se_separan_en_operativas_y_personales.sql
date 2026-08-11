SET lock_timeout = '5s';

-- Un centro de solicitudes para la sala, y las personales aparte (2026-08-10).
--
-- Pedido del usuario: «toda la sucursal debe poder ver las solicitudes, cuáles
-- se aprobaron, cuáles no, los motivos, así están al día ante cualquier cosa» —
-- y en el mismo aliento: «que vean no significa que aprueben».
--
-- ── Por qué NO se abre la tabla entera ────────────────────────────────────
-- `approval_requests` guarda DOS cosas que no se parecen en nada:
--
--   · operativas — hablan de la existencia de la sala y de sus facturas
--     (descarte, carga, traslado, anulación, forma de pago, vendedor, cliente).
--     Que las vea toda la sala es sano: es el cuaderno del turno.
--   · personales — hablan de UNA persona (vacaciones, permiso, incapacidad,
--     anticipo salarial, constancia). Abrirlas a la sala significa que todos
--     ven quién está incapacitado y quién pidió adelanto.
--
-- Abrir «la tabla» habría hecho las dos a la vez. Hoy las personales no se usan
-- («ahorita vacaciones y ese tipo de solicitudes no las necesito»), así que el
-- daño no sería inmediato — sería el día que se enciendan, y para entonces ya
-- nadie recordaría que esta policy las dejó pasar. Se separa ahora, que es
-- cuando cuesta barato.
--
-- ── El criterio vive en UNA función ──────────────────────────────────────
-- `es_solicitud_operativa()` en vez de repetir la lista de tipos en cuatro
-- policies: una lista escrita cuatro veces se desincroniza a la cuarta. Un tipo
-- nuevo que nadie clasifique cae por defecto en PERSONAL, que es el lado
-- cerrado — si hay que equivocarse, que sea escondiendo de más.

CREATE OR REPLACE FUNCTION public.es_solicitud_operativa(p_type text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public, extensions
AS $$
  SELECT p_type = ANY (ARRAY[
    'ANNULMENT_REQUEST', 'PAYMENT_CHANGE_REQUEST',
    'VENDOR_CHANGE_REQUEST', 'CLIENT_CHANGE_REQUEST',
    'INVENTORY_LOAD_REQUEST', 'INVENTORY_DISCARD_REQUEST',
    'INVENTORY_TRANSFER_REQUEST'
  ]);
$$;

COMMENT ON FUNCTION public.es_solicitud_operativa(text) IS
  'Una solicitud OPERATIVA habla de la sala (existencia o factura) y la ve todo '
  'el que tenga `requests`. Una PERSONAL habla de alguien y va por '
  '`requests_personales`. Lo no clasificado cae en personal — el lado cerrado.';

REVOKE EXECUTE ON FUNCTION public.es_solicitud_operativa(text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.es_solicitud_operativa(text) TO authenticated, service_role;

-- ── El módulo nuevo, apagado ─────────────────────────────────────────────
-- Nace en false para TODOS y se enciende abajo sólo donde corresponde. Un
-- módulo nuevo que naciera encendido sería justamente la fuga que esto evita.
INSERT INTO public.role_permissions (role_id, module_key, can_view, can_edit, can_approve, scope)
SELECT r.id, 'requests_personales', false, false, false, 'BRANCH'
FROM public.roles r
WHERE NOT EXISTS (
  SELECT 1 FROM public.role_permissions rp
  WHERE rp.role_id = r.id AND rp.module_key = 'requests_personales');

-- Quien HOY resuelve las personales conserva exactamente lo que tenía: se copia
-- desde `requests`, no se inventa. Antes de esta migración `requests` daba las
-- dos cosas juntas, así que copiarlo es dejar a cada quien como estaba.
UPDATE public.role_permissions p
SET can_view    = o.can_view,
    can_edit    = o.can_edit,
    can_approve = o.can_approve,
    scope       = o.scope
FROM public.role_permissions o
WHERE p.module_key = 'requests_personales'
  AND o.module_key = 'requests'
  AND o.role_id    = p.role_id
  AND o.can_approve;          -- sólo quien decidía; el que sólo miraba, no

-- ── Y el operativo se abre a la sala ─────────────────────────────────────
-- Ver, nunca decidir: `can_edit` y `can_approve` quedan en false. Alcance de su
-- propia sucursal.
UPDATE public.role_permissions
SET can_view = true, scope = 'BRANCH'
WHERE module_key = 'requests'
  AND NOT can_approve                      -- no tocar a quien ya decide
  AND role_id IN (
    SELECT id FROM public.roles
    WHERE name IN ('Dependiente de Farmacia', 'Regente de Enfermeria',
                   'Jefe/a de Sala', 'Subjefe/a de Sala', 'Auxiliar de Bodega'));

-- ── SELECT: operativas por `requests`, personales por `requests_personales` ──
DROP POLICY IF EXISTS approval_requests_select ON public.approval_requests;

CREATE POLICY approval_requests_select ON public.approval_requests
FOR SELECT TO authenticated
USING (
  -- Lo propio, siempre. Nadie queda sin ver lo que él mismo mandó.
  employee_id = (SELECT public.auth_employee_id())

  -- Operativas: las ve la sala.
  OR (
    public.es_solicitud_operativa(type)
    AND (SELECT public.auth_has_module_permission('requests', 'can_view'))
    AND (
      (SELECT public.auth_module_scope('requests')) = 'ALL'
      OR EXISTS (
        SELECT 1 FROM public.employees e
        WHERE e.id = approval_requests.employee_id
          AND e.branch_id = (SELECT public.auth_employee_branch_id())
      )
    )
  )

  -- Personales: sólo quien las administra.
  OR (
    NOT public.es_solicitud_operativa(type)
    AND (SELECT public.auth_has_module_permission('requests_personales', 'can_view'))
    AND (
      (SELECT public.auth_module_scope('requests_personales')) = 'ALL'
      OR EXISTS (
        SELECT 1 FROM public.employees e
        WHERE e.id = approval_requests.employee_id
          AND e.branch_id = (SELECT public.auth_employee_branch_id())
      )
    )
  )

  -- El traslado conserva su cascada propia: quien tiene que confirmarlo lo ve
  -- aunque no tenga el módulo de solicitudes.
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

-- ── UPDATE: decidir es otra cosa, y va por `can_approve` ─────────────────
-- Acá está el «que vean no significa que aprueben», escrito donde manda: la
-- sala entera pasa el SELECT de arriba y NINGUNO de ellos pasa éste.
DROP POLICY IF EXISTS approval_requests_update ON public.approval_requests;

CREATE POLICY approval_requests_update ON public.approval_requests
FOR UPDATE TO authenticated
USING (
  (
    public.es_solicitud_operativa(type)
    AND (SELECT public.auth_has_module_permission('requests', 'can_approve'))
    AND (
      (SELECT public.auth_module_scope('requests')) = 'ALL'
      OR EXISTS (
        SELECT 1 FROM public.employees e
        WHERE e.id = approval_requests.employee_id
          AND e.branch_id = (SELECT public.auth_employee_branch_id())
      )
    )
  )
  OR (
    NOT public.es_solicitud_operativa(type)
    AND (SELECT public.auth_has_module_permission('requests_personales', 'can_approve'))
    AND (
      (SELECT public.auth_module_scope('requests_personales')) = 'ALL'
      OR EXISTS (
        SELECT 1 FROM public.employees e
        WHERE e.id = approval_requests.employee_id
          AND e.branch_id = (SELECT public.auth_employee_branch_id())
      )
    )
  )
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
)
WITH CHECK (
  (
    public.es_solicitud_operativa(type)
    AND (SELECT public.auth_has_module_permission('requests', 'can_approve'))
    AND (
      (SELECT public.auth_module_scope('requests')) = 'ALL'
      OR EXISTS (
        SELECT 1 FROM public.employees e
        WHERE e.id = approval_requests.employee_id
          AND e.branch_id = (SELECT public.auth_employee_branch_id())
      )
    )
  )
  OR (
    NOT public.es_solicitud_operativa(type)
    AND (SELECT public.auth_has_module_permission('requests_personales', 'can_approve'))
    AND (
      (SELECT public.auth_module_scope('requests_personales')) = 'ALL'
      OR EXISTS (
        SELECT 1 FROM public.employees e
        WHERE e.id = approval_requests.employee_id
          AND e.branch_id = (SELECT public.auth_employee_branch_id())
      )
    )
  )
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

-- ── INSERT: crear a nombre de otro sigue siendo de quien administra ──────
DROP POLICY IF EXISTS approval_requests_insert ON public.approval_requests;

CREATE POLICY approval_requests_insert ON public.approval_requests
FOR INSERT TO authenticated
WITH CHECK (
  -- La propia. Es como nacen todas las de los widgets.
  employee_id = (SELECT public.auth_employee_id())
  OR (
    public.es_solicitud_operativa(type)
    AND (SELECT public.auth_has_module_permission('requests', 'can_approve'))
    AND (
      (SELECT public.auth_module_scope('requests')) = 'ALL'
      OR EXISTS (
        SELECT 1 FROM public.employees e
        WHERE e.id = approval_requests.employee_id
          AND e.branch_id = (SELECT public.auth_employee_branch_id())
      )
    )
  )
  OR (
    NOT public.es_solicitud_operativa(type)
    AND (SELECT public.auth_has_module_permission('requests_personales', 'can_approve'))
    AND (
      (SELECT public.auth_module_scope('requests_personales')) = 'ALL'
      OR EXISTS (
        SELECT 1 FROM public.employees e
        WHERE e.id = approval_requests.employee_id
          AND e.branch_id = (SELECT public.auth_employee_branch_id())
      )
    )
  )
);

-- ── Min/Max entra al centro, pero sólo para MIRARSE ──────────────────────
-- Su policy exigía `minmax.can_approve` para VER — el mismo defecto que
-- `requests` tenía hasta hoy: mirar y decidir eran el mismo permiso, y por eso
-- las solicitudes de Min/Max eran invisibles para toda la sala.
--
-- Se agrega una vía por `requests.can_view` para que aparezcan en el centro SIN
-- abrirle a nadie el módulo de Min/Max entero. `mmcr_update` NO se toca: decidir
-- sigue siendo de `minmax.can_approve`.
DROP POLICY IF EXISTS mmcr_select ON public.minmax_change_requests;

CREATE POLICY mmcr_select ON public.minmax_change_requests
FOR SELECT TO authenticated
USING (
  requested_by_id = (SELECT public.auth_employee_id())
  OR (
    (SELECT public.auth_has_module_permission('minmax', 'can_approve'))
    AND (
      (SELECT public.auth_module_scope('minmax')) = 'ALL'
      OR erp_sucursal_id = (SELECT public.auth_employee_erp_sucursal_id())
    )
  )
  OR (
    (SELECT public.auth_has_module_permission('requests', 'can_view'))
    AND (
      (SELECT public.auth_module_scope('requests')) = 'ALL'
      OR erp_sucursal_id = (SELECT public.auth_employee_erp_sucursal_id())
    )
  )
);
