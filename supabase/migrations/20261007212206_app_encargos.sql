SET lock_timeout = '5s';

-- Encargos (2026-10-07, pedido del usuario): un producto que no hay en ninguna
-- sucursal se SOLICITA desde la app. Lo ven la sala donde se va a retirar y
-- Bodega; confirman si se puede conseguir, a qué precio y para cuándo; el
-- cliente acepta y paga el anticipo (política del plan: 100 % en encargos);
-- se pide; al llegar se le avisa y lo retira.
--
--   solicitado → confirmado (precio y fecha) → aceptado (pagado) → pedido → listo → entregado
--   solicitado → rechazado (con motivo)          cualquiera abierto → cancelado
CREATE TABLE public.app_encargos (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    customer_id     bigint NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
    branch_id       bigint NOT NULL REFERENCES public.branches(id),
    product_id      integer NOT NULL REFERENCES public.products(id),
    producto_nombre text NOT NULL CHECK (length(producto_nombre) <= 200),
    factor          integer NOT NULL DEFAULT 1,
    cantidad        integer NOT NULL CHECK (cantidad BETWEEN 1 AND 20),
    nota_cliente    text CHECK (nota_cliente IS NULL OR length(nota_cliente) <= 300),
    precio_unitario numeric(12,2),
    anticipo        numeric(12,2),
    fecha_estimada  date,
    nota_sucursal   text CHECK (nota_sucursal IS NULL OR length(nota_sucursal) <= 300),
    estado          text NOT NULL DEFAULT 'solicitado'
                    CHECK (estado IN ('solicitado', 'confirmado', 'rechazado', 'aceptado', 'pedido', 'listo', 'entregado', 'cancelado')),
    pago_estado     text NOT NULL DEFAULT 'pendiente' CHECK (pago_estado IN ('pendiente', 'pagado', 'devuelto')),
    pagado_at       timestamptz,
    respondido_por  uuid,
    respondido_at   timestamptz,
    cerrado_at      timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    CHECK (estado <> 'confirmado' OR (precio_unitario IS NOT NULL AND fecha_estimada IS NOT NULL))
);
CREATE INDEX app_encargos_cliente_idx ON public.app_encargos (customer_id);
CREATE INDEX app_encargos_sala_idx ON public.app_encargos (branch_id, estado);
CREATE INDEX app_encargos_producto_idx ON public.app_encargos (product_id);

ALTER TABLE public.app_encargos ENABLE ROW LEVEL SECURITY;
-- La sala ve los suyos; Bodega y quien maneja ofertas para clientes, todos.
CREATE POLICY app_encargos_select ON public.app_encargos FOR SELECT TO authenticated USING (
  branch_id = (SELECT public.auth_employee_branch_id())
  OR (SELECT public.auth_employee_branch_id()) IN (SELECT id FROM public.branches WHERE type = 'BODEGA')
  OR (SELECT public.auth_can_edit_any(ARRAY['ofertas_clientes'])));

-- El pago en línea de un encargo usa el mismo circuito de Wompi.
ALTER TABLE public.app_reservas_pagos ADD COLUMN encargo_id bigint REFERENCES public.app_encargos(id);
CREATE INDEX app_reservas_pagos_encargo_idx ON public.app_reservas_pagos (encargo_id) WHERE encargo_id IS NOT NULL;
ALTER TABLE public.app_reservas_pagos DROP CONSTRAINT app_reservas_pagos_de_algo;
ALTER TABLE public.app_reservas_pagos ADD CONSTRAINT app_reservas_pagos_de_algo
  CHECK (reserva_id IS NOT NULL OR pedido IS NOT NULL OR encargo_id IS NOT NULL);

-- Quién puede responder un encargo: la sala del retiro, Bodega, o quien
-- maneja ofertas para clientes.
CREATE FUNCTION public.encargo_puede_manejar(p_branch_id bigint)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions AS $$
  SELECT p_branch_id = public.auth_employee_branch_id()
      OR public.auth_employee_branch_id() IN (SELECT id FROM public.branches WHERE type = 'BODEGA')
      OR public.auth_can_edit_any(ARRAY['ofertas_clientes']);
$$;
REVOKE EXECUTE ON FUNCTION public.encargo_puede_manejar(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.encargo_puede_manejar(bigint) TO authenticated, service_role;

-- La lista del portal (abiertos o de los últimos 30 días).
CREATE FUNCTION public.encargos_de_sucursal(p_branch_id bigint, p_abiertos boolean DEFAULT true)
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, extensions AS $$
BEGIN
  IF p_branch_id IS NOT NULL AND NOT (p_branch_id = public.auth_employee_branch_id()
       OR public.auth_employee_branch_id() IN (SELECT id FROM public.branches WHERE type = 'BODEGA')
       OR public.auth_can_edit_any(ARRAY['ofertas_clientes'])) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF p_branch_id IS NULL AND NOT (public.auth_employee_branch_id() IN (SELECT id FROM public.branches WHERE type = 'BODEGA')
       OR public.auth_can_edit_any(ARRAY['ofertas_clientes'])) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  RETURN coalesce((
    SELECT json_agg(json_build_object(
      'id', e.id, 'codigo', 'E-' || lpad(e.id::text, 6, '0'), 'estado', e.estado, 'pago_estado', e.pago_estado,
      'branch_id', e.branch_id, 'sala', b.name, 'cliente', c.name, 'telefono', c.phone,
      'product_id', e.product_id, 'producto', e.producto_nombre, 'cantidad', e.cantidad, 'nota_cliente', e.nota_cliente,
      'precio_unitario', e.precio_unitario, 'anticipo', e.anticipo, 'fecha_estimada', e.fecha_estimada, 'nota_sucursal', e.nota_sucursal,
      'devolutivo', p.devolutivo,
      'vendido_antes', EXISTS (SELECT 1 FROM public.sales_invoice_items ii WHERE ii.erp_product_id = e.product_id LIMIT 1),
      'creado', e.created_at)
      ORDER BY (e.estado = 'solicitado') DESC, (e.estado = 'aceptado') DESC, e.created_at DESC)
      FROM public.app_encargos e
      JOIN public.branches b ON b.id = e.branch_id
      JOIN public.customers c ON c.id = e.customer_id
      JOIN public.products p ON p.id = e.product_id
     WHERE (p_branch_id IS NULL OR e.branch_id = p_branch_id)
       AND (CASE WHEN p_abiertos THEN e.estado IN ('solicitado', 'confirmado', 'aceptado', 'pedido', 'listo')
                 ELSE e.created_at > now() - interval '30 days' END)), '[]'::json);
END $$;
REVOKE EXECUTE ON FUNCTION public.encargos_de_sucursal(bigint, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.encargos_de_sucursal(bigint, boolean) TO authenticated, service_role;

-- Responder y avanzar un encargo desde el portal.
CREATE FUNCTION public.encargo_responder(p_id bigint, p_accion text, p_precio numeric DEFAULT NULL,
                                         p_fecha date DEFAULT NULL, p_nota text DEFAULT NULL)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE
  e public.app_encargos;
  v_emp uuid := public.auth_employee_id();
BEGIN
  SELECT * INTO e FROM public.app_encargos WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NO_EXISTE'; END IF;
  IF NOT public.encargo_puede_manejar(e.branch_id) THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501'; END IF;
  IF p_accion = 'confirmar' AND e.estado = 'solicitado' THEN
    IF p_precio IS NULL OR p_precio <= 0 OR p_fecha IS NULL OR p_fecha < (now() AT TIME ZONE 'America/El_Salvador')::date THEN
      RAISE EXCEPTION 'Falta el precio o una fecha estimada válida.';
    END IF;
    UPDATE public.app_encargos SET estado = 'confirmado', precio_unitario = round(p_precio, 2),
           anticipo = round(p_precio * cantidad, 2), fecha_estimada = p_fecha, nota_sucursal = nullif(trim(p_nota), ''),
           respondido_por = v_emp, respondido_at = now(), updated_at = now() WHERE id = p_id;
  ELSIF p_accion = 'rechazar' AND e.estado IN ('solicitado', 'confirmado') THEN
    UPDATE public.app_encargos SET estado = 'rechazado', nota_sucursal = coalesce(nullif(trim(p_nota), ''), 'No lo podemos conseguir por ahora.'),
           respondido_por = v_emp, respondido_at = now(), cerrado_at = now(), updated_at = now() WHERE id = p_id;
  ELSIF p_accion = 'pedido' AND e.estado = 'aceptado' THEN
    UPDATE public.app_encargos SET estado = 'pedido', updated_at = now() WHERE id = p_id;
  ELSIF p_accion = 'listo' AND e.estado IN ('aceptado', 'pedido') THEN
    UPDATE public.app_encargos SET estado = 'listo', updated_at = now() WHERE id = p_id;
  ELSIF p_accion = 'entregado' AND e.estado = 'listo' THEN
    UPDATE public.app_encargos SET estado = 'entregado', cerrado_at = now(), updated_at = now() WHERE id = p_id;
  ELSE
    RAISE EXCEPTION 'TRANSICION_INVALIDA: % → %', e.estado, p_accion;
  END IF;
  INSERT INTO public.audit_logs (user_id, action, target_id, details, branch_id, source)
  VALUES (v_emp, 'ENCARGO_' || upper(p_accion), p_id::text,
          jsonb_build_object('antes', e.estado, 'precio', p_precio, 'fecha', p_fecha, 'nota', p_nota), e.branch_id, 'portal');
  RETURN json_build_object('ok', true, 'id', p_id);
END $$;
REVOKE EXECUTE ON FUNCTION public.encargo_responder(bigint, text, numeric, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.encargo_responder(bigint, text, numeric, date, text) TO authenticated, service_role;

-- Aviso a la sala del retiro y a Bodega al llegar una solicitud.
CREATE FUNCTION public.app_encargos_avisar()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE v_dest uuid[]; v_cliente text;
BEGIN
  SELECT array_agg(e.id) INTO v_dest FROM public.employees e
   WHERE e.status = 'ACTIVO' AND (e.branch_id = NEW.branch_id OR e.branch_id IN (SELECT id FROM public.branches WHERE type = 'BODEGA'));
  SELECT initcap(split_part(name, ' ', 1)) INTO v_cliente FROM public.customers WHERE id = NEW.customer_id;
  IF v_dest IS NOT NULL THEN
    PERFORM public.notify_employees(v_dest, 'ENCARGO_APP',
      'Encargo de la app · E-' || lpad(NEW.id::text, 6, '0'),
      format('%s pide %s × %s. Confirmen si se puede conseguir, el precio y para cuándo.', coalesce(v_cliente, 'Un cliente'), NEW.cantidad, NEW.producto_nombre),
      '/', jsonb_build_object('encargo', NEW.id, 'check_key', 'encargo_app:' || NEW.id), true, NEW.branch_id::integer);
  END IF;
  RETURN NULL;
END $$;
REVOKE EXECUTE ON FUNCTION public.app_encargos_avisar() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER app_encargos_avisar AFTER INSERT ON public.app_encargos FOR EACH ROW EXECUTE FUNCTION public.app_encargos_avisar();

-- Confirmar el pago: también de un encargo (pasa a «aceptado»). Partiendo de la viva.
CREATE OR REPLACE FUNCTION public.app_reserva_pago_confirmar(p_identificador text, p_id_transaccion text, p_monto numeric, p_es_real boolean, p_codigo text, p_forma text, p_detalle jsonb)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  p public.app_reservas_pagos;
  r public.app_reservas;
  v_ids bigint[];
BEGIN
  SELECT * INTO p FROM public.app_reservas_pagos WHERE identificador = p_identificador FOR UPDATE;
  IF NOT FOUND THEN RETURN json_build_object('ok', false, 'motivo', 'sin_pago'); END IF;
  IF p.estado = 'aprobado' THEN
    RETURN json_build_object('ok', true, 'ya', true, 'reserva_id', p.reserva_id, 'pedido', p.pedido, 'encargo_id', p.encargo_id);
  END IF;
  IF EXISTS (SELECT 1 FROM public.app_reservas_pagos WHERE id_transaccion = p_id_transaccion AND id <> p.id) THEN
    RETURN json_build_object('ok', false, 'motivo', 'tx_usada');
  END IF;
  IF round(p_monto, 2) <> p.monto THEN
    RETURN json_build_object('ok', false, 'motivo', 'monto', 'esperado', p.monto, 'recibido', p_monto);
  END IF;

  UPDATE public.app_reservas_pagos
     SET estado = 'aprobado', id_transaccion = p_id_transaccion, es_real = p_es_real,
         codigo_autorizacion = p_codigo, forma_pago = p_forma, detalle = p_detalle, pagado_at = now()
   WHERE id = p.id;

  -- Un encargo: pagado el anticipo, queda ACEPTADO para que se pida.
  IF p.encargo_id IS NOT NULL THEN
    UPDATE public.app_encargos SET pago_estado = 'pagado', pagado_at = now(), updated_at = now(),
           estado = CASE WHEN estado = 'confirmado' THEN 'aceptado' ELSE estado END
     WHERE id = p.encargo_id;
    INSERT INTO public.audit_logs (action, target_id, details, source)
    VALUES ('ENCARGO_PAGADO_EN_LINEA', p.encargo_id::text,
            jsonb_build_object('monto', p.monto, 'transaccion', p_id_transaccion, 'es_real', p_es_real), 'SYSTEM');
    RETURN json_build_object('ok', true, 'encargo_id', p.encargo_id);
  END IF;

  SELECT array_agg(id) INTO v_ids FROM public.app_reservas
   WHERE (p.pedido IS NOT NULL AND pedido = p.pedido) OR (p.pedido IS NULL AND id = p.reserva_id);

  FOR r IN SELECT * FROM public.app_reservas WHERE id = ANY (v_ids) FOR UPDATE LOOP
    UPDATE public.app_reservas
       SET pago_estado = 'pagado', pago_metodo = 'en_linea', pagado_at = now(), updated_at = now(),
           vence_at = CASE WHEN estado = 'lista' THEN lista_at + interval '7 days' ELSE vence_at END,
           estado = CASE WHEN estado IN ('vencida', 'cancelada') THEN 'pendiente' ELSE estado END,
           cerrada_at = CASE WHEN estado IN ('vencida', 'cancelada') THEN NULL ELSE cerrada_at END
     WHERE id = r.id;
    INSERT INTO public.audit_logs (action, target_id, details, branch_id, source)
    VALUES ('RESERVA_PAGADA_EN_LINEA', r.id::text,
            jsonb_build_object('monto', p.monto, 'transaccion', p_id_transaccion, 'es_real', p_es_real,
                               'estado_antes', r.estado, 'forma', p_forma, 'pedido', p.pedido),
            r.branch_id, 'SYSTEM');
  END LOOP;
  RETURN json_build_object('ok', true, 'reserva_id', p.reserva_id, 'pedido', p.pedido, 'reservas', coalesce(array_length(v_ids, 1), 0));
END;
$function$;
