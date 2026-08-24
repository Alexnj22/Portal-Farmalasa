-- El portal le PIDE el dato a la sala, con el campo para contestarlo.
--
-- Regla del usuario, 2026-08-24: «el portal envía una solicitud a la sucursal
-- donde se emitió el documento del contribuyente que tiene el correo incorrecto,
-- con el campo de agregar el correo nuevo ya confirmado. Cuando lo confirman y
-- lo envían, el portal ya tiene el nuevo correo válido para editarlo, y
-- finalizar el proceso.»
--
-- La versión anterior sólo AVISABA y mandaba a la pantalla de Clientes. Eso
-- tiene dos defectos: las salas no tienen `clientes.can_edit` —o sea que el
-- aviso les pedía algo que el portal no les deja hacer— y el aviso no deja
-- rastro de si alguien contestó. Un pedido sin campo de respuesta no es un
-- pedido: es una notificación con forma de tarea.
--
-- Acá la sala escribe el correo, confirma, y el portal hace el resto: lo
-- escribe en la ficha del sistema de origen y vuelve a transmitir el documento.
-- La sala nunca necesita permiso sobre clientes, porque no edita la ficha —
-- contesta una pregunta sobre SU venta.
--
-- ── Por qué tabla propia y no `approval_requests` ────────────────────────
-- Las solicitudes del portal son «alguien pide, un jefe aprueba o rechaza».
-- Esto es al revés y con otra forma: el portal pregunta y la sala responde con
-- un VALOR. Meterlo en el flujo de aprobaciones obligaría a que aprobar
-- signifique dos cosas distintas según el tipo, que es exactamente cómo se
-- rompe un modelo de permisos.

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.dte_datos_pedidos (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id     bigint NOT NULL REFERENCES public.sales_invoices(id) ON DELETE CASCADE,
  customer_id    bigint NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  branch_id      bigint NOT NULL REFERENCES public.branches(id),
  campo          text   NOT NULL DEFAULT 'email',
  motivo_mh      text,
  valor_actual   text,
  correlativo    text,
  estado         text   NOT NULL DEFAULT 'PENDIENTE',
  valor_nuevo    text,
  respondido_por uuid REFERENCES public.employees(id),
  respondido_at  timestamptz,
  aplicado_at    timestamptz,
  nota           text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_datos_pedidos_estado
    CHECK (estado IN ('PENDIENTE','APLICADO','CANCELADO')),
  CONSTRAINT chk_datos_pedidos_campo
    CHECK (campo IN ('email'))
);

-- Un solo pedido vivo por cliente y campo: la corrida vuelve a detectar el caso
-- cada noche hasta que se resuelva, y sin esto la sala vería el mismo pedido
-- repetido una vez por noche.
CREATE UNIQUE INDEX IF NOT EXISTS uq_datos_pedidos_vivo
  ON public.dte_datos_pedidos (customer_id, campo) WHERE estado = 'PENDIENTE';
CREATE INDEX IF NOT EXISTS idx_datos_pedidos_branch  ON public.dte_datos_pedidos (branch_id);
CREATE INDEX IF NOT EXISTS idx_datos_pedidos_invoice ON public.dte_datos_pedidos (invoice_id);
CREATE INDEX IF NOT EXISTS idx_datos_pedidos_cliente ON public.dte_datos_pedidos (customer_id);
CREATE INDEX IF NOT EXISTS idx_datos_pedidos_resp    ON public.dte_datos_pedidos (respondido_por);

ALTER TABLE public.dte_datos_pedidos ENABLE ROW LEVEL SECURITY;

-- La sala NO lee esta tabla directo: lo hace por `datos_pedidos_de_mi_sala()`,
-- que filtra por su sucursal del lado del servidor. Acá sólo se abre la lectura
-- a quien mira Facturación, para poder auditar los pedidos desde el módulo.
-- El `(SELECT ...)` alrededor de la función auth no es opcional: sin él Postgres
-- la evalúa POR FILA (incidente 2026-07-08).
DROP POLICY IF EXISTS datos_pedidos_read ON public.dte_datos_pedidos;
CREATE POLICY datos_pedidos_read ON public.dte_datos_pedidos
  FOR SELECT TO authenticated
  USING ((SELECT public.auth_has_module_permission('facturacion','can_view')));

-- Sin policy de INSERT/UPDATE/DELETE a propósito: lo crea el circuito
-- (service_role) y lo cierra la Edge Function que escribe en el sistema de
-- origen. Nadie contesta un pedido escribiendo la tabla a mano — si se pudiera,
-- el correo quedaría "respondido" en el portal y sin escribir donde importa.

COMMENT ON TABLE public.dte_datos_pedidos IS
  'Datos que el portal le pide a la sala para destrabar un documento ante Hacienda. La sala responde con un valor; la Edge Function lo escribe en origen.';


-- ── 1 · El portal pide ─────────────────────────────────────────────────────
-- Crea el pedido y avisa. Reemplaza a `pedir_correo_a_la_sala`, que sólo
-- avisaba: un aviso no se puede contestar y no deja rastro de si alguien lo
-- atendió.
DROP FUNCTION IF EXISTS public.pedir_correo_a_la_sala(bigint, text);

CREATE OR REPLACE FUNCTION public.pedir_dato_a_la_sala(
  p_customer_id bigint,
  p_campo       text DEFAULT 'email',
  p_motivo_mh   text DEFAULT NULL,
  p_valor_actual text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_cliente  text;
  v_invoice  bigint;
  v_branch   bigint;
  v_sala     text;
  v_corr     text;
  v_id       uuid;
  v_avisados integer := 0;
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role'
     AND NOT (SELECT public.auth_has_module_permission('facturacion','can_edit')) THEN
    RAISE EXCEPTION 'FORBIDDEN: sin permiso para pedir datos de facturacion';
  END IF;

  SELECT c.name INTO v_cliente FROM public.customers c WHERE c.id = p_customer_id;
  IF v_cliente IS NULL THEN RAISE EXCEPTION 'CLIENTE_NO_EXISTE'; END IF;

  -- La sucursal donde se EMITIO el documento — no una «sucursal del cliente»,
  -- que no existe: un cliente compra en varias salas y la que puede averiguar
  -- el correo es la que lo tuvo enfrente.
  SELECT si.id, si.branch_id, si.correlativo INTO v_invoice, v_branch, v_corr
    FROM public.sales_invoices si
   WHERE si.customer_id = p_customer_id
     AND length(si.recibido_mh) IS DISTINCT FROM 40
     AND si.estado NOT IN ('NULA','DTE INVALIDADO EN MH')
   ORDER BY si.fecha DESC, si.hora DESC
   LIMIT 1;

  IF v_invoice IS NULL THEN
    RETURN json_build_object('ok', false, 'avisados', 0,
                             'motivo', 'sin documento pendiente que ubique la sala');
  END IF;
  SELECT b.name INTO v_sala FROM public.branches b WHERE b.id = v_branch;

  -- Un solo pedido vivo. Si ya hay uno, no se duplica ni se vuelve a avisar:
  -- la corrida detecta el mismo caso cada noche, y un aviso por persona por
  -- noche sobre lo mismo es como se ensena a no mirar la campana.
  SELECT p.id INTO v_id FROM public.dte_datos_pedidos p
   WHERE p.customer_id = p_customer_id AND p.campo = p_campo AND p.estado = 'PENDIENTE';
  IF v_id IS NOT NULL THEN
    RETURN json_build_object('ok', true, 'pedido_id', v_id, 'avisados', 0,
                             'motivo', 'ya habia un pedido abierto');
  END IF;

  INSERT INTO public.dte_datos_pedidos
      (invoice_id, customer_id, branch_id, campo, motivo_mh, valor_actual, correlativo)
  VALUES (v_invoice, p_customer_id, v_branch, p_campo, p_motivo_mh, p_valor_actual, v_corr)
  RETURNING id INTO v_id;

  INSERT INTO public.notifications (recipient_id, type, title, body, link, metadata, branch_id)
  SELECT e.id, 'DTE_DATO_PEDIDO',
         'Falta el correo de un cliente',
         'La venta ' || coalesce(nullif(btrim(v_corr), ''), 'de ' || v_sala) ||
         ' no se puede completar: el correo de «' || v_cliente || '» no es valido. ' ||
         'Escribi el correo correcto desde Inicio y el portal termina el resto.',
         '/',
         jsonb_build_object('pedido_id', v_id, 'customer_id', p_customer_id,
                            'cliente', v_cliente, 'correlativo', v_corr,
                            'sala', v_sala, 'motivo_mh', p_motivo_mh),
         v_branch
    FROM public.employees e
   WHERE e.branch_id = v_branch AND e.status = 'ACTIVO';

  GET DIAGNOSTICS v_avisados = ROW_COUNT;

  -- Cero destinatarios NO es un exito: el pedido no le llego a nadie y el
  -- documento se queda trabado sin que nadie lo sepa.
  IF v_avisados = 0 THEN
    RETURN json_build_object('ok', false, 'pedido_id', v_id, 'avisados', 0,
                             'sala', v_sala, 'motivo', 'la sala no tiene a nadie activo');
  END IF;

  RETURN json_build_object('ok', true, 'pedido_id', v_id, 'avisados', v_avisados,
                           'sala', v_sala, 'correlativo', v_corr);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.pedir_dato_a_la_sala(bigint, text, text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.pedir_dato_a_la_sala(bigint, text, text, text) TO authenticated, service_role;


-- ── 2 · Lo que ve la sala ──────────────────────────────────────────────────
-- DEFINER y filtrado por la sucursal DEL EMPLEADO, no por un parametro: si la
-- sala pudiera elegir la sucursal, podria contestar el correo de un cliente de
-- otra sala, que es un dato que no tuvo enfrente.
CREATE OR REPLACE FUNCTION public.datos_pedidos_de_mi_sala()
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v json; v_branch bigint; v_todas boolean;
BEGIN
  IF NOT (SELECT public.auth_has_module_permission('dash_dato_pedido','can_view')) THEN
    RAISE EXCEPTION 'FORBIDDEN: sin permiso para ver los datos pedidos';
  END IF;

  SELECT e.branch_id INTO v_branch
    FROM public.employees e WHERE e.id = (SELECT public.auth_employee_id());

  -- Quien mira Facturacion los ve todos: es quien persigue el documento.
  v_todas := (SELECT public.auth_has_module_permission('facturacion','can_view'));

  SELECT coalesce(json_agg(to_json(t) ORDER BY t.created_at), '[]'::json) INTO v
    FROM (
      SELECT p.id, p.campo, p.motivo_mh, p.valor_actual, p.correlativo,
             p.branch_id, p.created_at, c.name AS cliente, b.name AS sala,
             si.fecha, si.total
        FROM public.dte_datos_pedidos p
        JOIN public.customers c ON c.id = p.customer_id
        JOIN public.branches  b ON b.id = p.branch_id
        LEFT JOIN public.sales_invoices si ON si.id = p.invoice_id
       WHERE p.estado = 'PENDIENTE'
         AND (v_todas OR p.branch_id = v_branch)
    ) t;
  RETURN v;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.datos_pedidos_de_mi_sala() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.datos_pedidos_de_mi_sala() TO authenticated, service_role;


-- ── 3 · Cerrar el pedido, una vez escrito en origen ───────────────────────
-- La llama la Edge Function DESPUES de escribir el correo en la ficha del
-- sistema de origen. Nunca antes: un pedido marcado como aplicado sobre una
-- ficha que no cambio es la peor de las dos mentiras — la sala cree que
-- contesto y el documento sigue trabado.
CREATE OR REPLACE FUNCTION public.cerrar_dato_pedido(
  p_id     uuid,
  p_valor  text,
  p_actor  uuid DEFAULT NULL,
  p_nota   text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v_p public.dte_datos_pedidos%ROWTYPE;
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'FORBIDDEN: esto lo cierra el proceso que escribe en origen';
  END IF;

  UPDATE public.dte_datos_pedidos
     SET estado = 'APLICADO', valor_nuevo = p_valor,
         respondido_por = p_actor, respondido_at = now(),
         aplicado_at = now(), nota = p_nota, updated_at = now()
   WHERE id = p_id AND estado = 'PENDIENTE'
   RETURNING * INTO v_p;

  IF NOT FOUND THEN RAISE EXCEPTION 'PEDIDO_NO_ESTA_PENDIENTE'; END IF;

  INSERT INTO public.audit_logs
    (action, target_id, user_id, user_name, source, severity, branch_id, details)
  VALUES ('DTE_DATO_RESPONDIDO', v_p.invoice_id::text, p_actor,
          coalesce((SELECT e.name FROM public.employees e WHERE e.id = p_actor), 'Sistema'),
          'ADMIN_PANEL', 'INFO', v_p.branch_id,
          json_build_object('pedido_id', p_id, 'campo', v_p.campo,
                            'correlativo', v_p.correlativo,
                            'antes', v_p.valor_actual, 'despues', p_valor));

  RETURN json_build_object('ok', true, 'invoice_id', v_p.invoice_id,
                           'customer_id', v_p.customer_id);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.cerrar_dato_pedido(uuid, text, uuid, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.cerrar_dato_pedido(uuid, text, uuid, text) TO service_role;


-- ── 4 · Quien lo ve en Inicio ─────────────────────────────────────────────
-- Los mismos cargos que ya ven las baldosas de sala (`dash_cortes_sala`): son
-- los que estan en el mostrador y pueden averiguar el correo.
INSERT INTO public.role_permissions (role_id, module_key, can_view, can_edit, scope)
SELECT rp.role_id, 'dash_dato_pedido', true, true, rp.scope
  FROM public.role_permissions rp
 WHERE rp.module_key = 'dash_cortes_sala' AND rp.can_view
ON CONFLICT DO NOTHING;
