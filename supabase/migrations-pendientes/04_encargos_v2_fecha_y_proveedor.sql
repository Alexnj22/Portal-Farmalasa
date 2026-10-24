-- Reservas v2 · 04 — encargos: la fecha estimada que cambia y el proveedor que no entrega.
--
-- QUÉ CAMBIA (las dos funciones son nuevas y rechazan antes de `reglas_v2_desde()`):
--   · `encargo_cambiar_fecha(id, fecha, motivo)` — cláusula 4.4: «La fecha
--     estimada depende del proveedor y no es una fecha garantizada. Si cambia,
--     la Empresa se lo informa al Cliente». La cambia Compras o administración
--     (quien la puso con `encargo_responder`); el cliente recibe el aviso en la
--     app (`base:encargo_fecha:…`, lo manda `avisos-clientes` en «pendientes») y
--     la sala uno para avisarle por WhatsApp o llamada si no tiene la app.
--   · `encargo_proveedor_no_entrego(id, eleccion, motivo)` — cláusula 4.6: «Si
--     el proveedor no entrega el producto, el Cliente elige entre la devolución
--     completa de lo pagado o aplicarlo a otro producto». Es un DERECHO del
--     cliente, no una excepción: por eso la devolución NO pasa por la
--     autorización de administración (la de la cláusula 8.4 es para el saldo a
--     favor común). Lo hace la sala con el cliente enfrente:
--       'saldo'      → lo pagado queda como saldo a favor (para otro producto);
--       'devolucion' → el mismo saldo, ya marcado «devolución autorizada» con
--                      el motivo «El proveedor no entregó»: aparece en
--                      Reservas con «Entregar en efectivo» y sale como vale de
--                      caja (`reserva_devolucion_entregada`, sin cambios).
--     El encargo queda 'cancelado' con su saldo ligado, como en
--     `encargo_pasar_a_saldo` (de la que esto copia el armado del saldo).
--
-- CÓMO SE VERIFICÓ: branch de pruebas, `execute_sql`, transacción que se deshace.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.encargo_cambiar_fecha(p_id bigint, p_fecha date, p_motivo text DEFAULT NULL)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE e public.app_encargos; v_emp uuid := public.auth_employee_id(); v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
        v_cod text; v_dest uuid[]; v_cliente text;
BEGIN
  IF NOT public.reservas_v2_rige() THEN RAISE EXCEPTION 'Esta acción empieza a regir con el reglamento nuevo.'; END IF;
  SELECT * INTO e FROM public.app_encargos WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ese encargo no existe.'; END IF;
  IF NOT public.encargo_puede_manejar(e.branch_id) THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501'; END IF;
  IF NOT ((SELECT public.auth_employee_branch_id()) IN (SELECT id FROM public.branches WHERE type = 'BODEGA')
          OR public.auth_can_edit_any(ARRAY['ofertas_clientes'])) THEN
    RAISE EXCEPTION 'La fecha de un encargo la cambia Compras o administración.' USING ERRCODE = '42501';
  END IF;
  IF e.estado NOT IN ('confirmado', 'aceptado', 'pedido') THEN
    RAISE EXCEPTION 'Sólo cambia la fecha de un encargo confirmado que todavía no llegó.';
  END IF;
  IF p_fecha IS NULL OR p_fecha < (now() AT TIME ZONE 'America/El_Salvador')::date THEN
    RAISE EXCEPTION 'Escribe una fecha estimada válida.';
  END IF;
  IF p_fecha = e.fecha_estimada THEN RAISE EXCEPTION 'Es la misma fecha que ya tenía.'; END IF;
  UPDATE public.app_encargos SET fecha_estimada = p_fecha, updated_at = now() WHERE id = p_id;
  v_cod := 'E-' || lpad(p_id::text, 6, '0');
  INSERT INTO public.app_cliente_avisos (customer_id, tipo, ref, titulo, cuerpo, url)
  VALUES (e.customer_id, 'reserva', 'base:encargo_fecha:' || p_id || ':' || p_fecha, 'Tu encargo ' || v_cod || ' cambió de fecha',
          coalesce(e.producto_nombre, 'Lo que encargaste') || ' llega aprox. el ' || to_char(p_fecha, 'DD/MM/YYYY')
            || coalesce(' (' || v_motivo || ')', '') || '. Te avisamos cuando esté en la sucursal.',
          '/reservas')
  ON CONFLICT (customer_id, tipo, ref) DO NOTHING;
  v_dest := public.destinatarios_de_reservas(e.branch_id);
  IF v_dest IS NOT NULL THEN
    SELECT initcap(split_part(name, ' ', 1)) INTO v_cliente FROM public.customers WHERE id = e.customer_id;
    PERFORM public.notify_employees(v_dest, 'ENCARGO_APP', 'Cambió la fecha del encargo · ' || v_cod,
      format('%s × %s para %s llega aprox. el %s (antes el %s). Si no tiene la app, avísale y registra el aviso.',
             e.cantidad, e.producto_nombre, coalesce(v_cliente, 'el cliente'), to_char(p_fecha, 'DD/MM'),
             coalesce(to_char(e.fecha_estimada, 'DD/MM'), '—')),
      '/reservas', jsonb_build_object('encargo', p_id, 'check_key', 'encargo_fecha:' || p_id || ':' || p_fecha), true, e.branch_id::integer);
  END IF;
  INSERT INTO public.audit_logs (user_id, action, target_id, details, branch_id, source)
  VALUES (v_emp, 'ENCARGO_FECHA_CAMBIADA', p_id::text,
          jsonb_build_object('antes', e.fecha_estimada, 'ahora', p_fecha, 'motivo', v_motivo), e.branch_id, 'ADMIN_PANEL');
  RETURN json_build_object('ok', true, 'fecha_estimada', p_fecha);
END $$;
REVOKE EXECUTE ON FUNCTION public.encargo_cambiar_fecha(bigint, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.encargo_cambiar_fecha(bigint, date, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.encargo_proveedor_no_entrego(p_id bigint, p_eleccion text, p_motivo text DEFAULT NULL)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE
  e public.app_encargos; v_emp uuid := public.auth_employee_id();
  v_hoy date := (now() AT TIME ZONE 'America/El_Salvador')::date;
  v_motivo text := 'El proveedor no entregó' || coalesce(': ' || nullif(btrim(coalesce(p_motivo, '')), ''), '');
  v_metodo text; v_id bigint; v_dev boolean := p_eleccion = 'devolucion'; v_cod text := 'E-' || lpad(p_id::text, 6, '0');
BEGIN
  IF NOT public.reservas_v2_rige() THEN RAISE EXCEPTION 'Esta acción empieza a regir con el reglamento nuevo.'; END IF;
  IF p_eleccion NOT IN ('devolucion', 'saldo') THEN RAISE EXCEPTION 'Indica qué eligió el cliente: devolución o saldo a favor.'; END IF;
  SELECT * INTO e FROM public.app_encargos WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ese encargo no existe.'; END IF;
  IF NOT public.encargo_puede_manejar(e.branch_id) THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501'; END IF;
  IF e.estado NOT IN ('aceptado', 'pedido') OR e.pago_estado <> 'pagado' THEN
    RAISE EXCEPTION 'Sólo un encargo pagado que todavía no llegó.';
  END IF;
  IF e.reserva_id IS NOT NULL THEN
    RAISE EXCEPTION 'Ese encargo es el resto de la reserva R-%: se resuelve desde la reserva.', lpad(e.reserva_id::text, 6, '0');
  END IF;
  IF EXISTS (SELECT 1 FROM public.apartado_aplicaciones a WHERE a.encargo_id = e.id) THEN
    RAISE EXCEPTION 'El pago de ese encargo ya se aplicó a una factura.';
  END IF;
  v_metodo := CASE
    WHEN EXISTS (SELECT 1 FROM public.app_reservas_pagos pg WHERE pg.encargo_id = e.id AND pg.pagado_at IS NOT NULL) THEN 'en_linea'
    ELSE coalesce((SELECT CASE lower(m.forma_pago) WHEN 'tarjeta' THEN 'tarjeta' WHEN 'transferencia' THEN 'transferencia' ELSE 'efectivo' END
                     FROM public.caja_movimientos_portal m WHERE m.encargo_id = e.id AND m.anulado_at IS NULL ORDER BY m.id DESC LIMIT 1),
                  'efectivo') END;
  -- El saldo, armado igual que `encargo_pasar_a_saldo`. La fila de saldo
  -- exige un producto: el del catálogo, o el sugerido de un producto nuevo.
  IF coalesce(e.product_id, e.sugerido_product_id) IS NULL THEN
    RAISE EXCEPTION 'Es un producto nuevo sin vincular: vincúlalo al catálogo antes de resolverlo.';
  END IF;
  INSERT INTO public.app_reservas (customer_id, branch_id, origen, producto_id, producto_nombre, cantidad, factor,
      precio_unitario, precio_normal, estado, terminos_version, anticipo, pago_estado, pago_metodo, pagado_at,
      cerrada_at, cerrada_por, saldo_favor, saldo_favor_vence, saldo_favor_origen,
      devolucion_pedida_at, devolucion_pedida_por, devolucion_pedida_motivo,
      saldo_favor_inicial, saldo_favor_devuelto_at, saldo_favor_devuelto_por, saldo_favor_devuelto_monto, saldo_favor_devuelto_motivo)
  VALUES (e.customer_id, e.branch_id, 'sucursal', coalesce(e.product_id, e.sugerido_product_id),
      left('Encargo ' || v_cod || ' · ' || e.producto_nombre, 200),
      1, greatest(coalesce(e.factor, 1), 1), 0, 0, 'cancelada', 'encargo', e.anticipo, 'anticipo', v_metodo, coalesce(e.pagado_at, now()),
      now(), v_emp, e.anticipo, v_hoy + public.saldo_favor_dias(), 'anticipo',
      CASE WHEN v_dev THEN now() END, CASE WHEN v_dev THEN v_emp END, CASE WHEN v_dev THEN left(v_motivo, 300) END,
      CASE WHEN v_dev THEN e.anticipo END, CASE WHEN v_dev THEN now() END, CASE WHEN v_dev THEN v_emp END,
      CASE WHEN v_dev THEN e.anticipo END, CASE WHEN v_dev THEN left(v_motivo, 300) END)
  RETURNING id INTO v_id;
  IF v_dev THEN
    INSERT INTO public.saldo_favor_movimientos (reserva_id, tipo, monto, saldo_despues, branch_id, employee_id, nota)
    VALUES (v_id, 'devolucion', e.anticipo, 0, e.branch_id, v_emp, left(v_motivo || ' (devolución completa, cláusula 4.6)', 300));
  END IF;
  UPDATE public.app_encargos
     SET estado = 'cancelado', cerrado_at = now(), saldo_reserva_id = v_id, updated_at = now(),
         nota_sucursal = left(coalesce(nota_sucursal || ' · ', '') || v_motivo
                              || CASE WHEN v_dev THEN ' · devolución completa' ELSE ' · a saldo a favor' END, 300)
   WHERE id = p_id;
  INSERT INTO public.app_cliente_avisos (customer_id, tipo, ref, titulo, cuerpo, url)
  VALUES (e.customer_id, 'reserva', 'base:encargo_no_entregado:' || p_id, 'El proveedor no entregó tu encargo ' || v_cod,
          CASE WHEN v_dev
               THEN 'Te devolvemos lo que pagaste ($' || to_char(e.anticipo, 'FM999990.00') || ') en la sucursal: pásalo a recoger.'
               ELSE 'Lo que pagaste ($' || to_char(e.anticipo, 'FM999990.00') || ') queda a tu favor por ' || public.saldo_favor_dias()
                    || ' días, para otro producto en cualquier sucursal.' END,
          '/reservas')
  ON CONFLICT (customer_id, tipo, ref) DO NOTHING;
  INSERT INTO public.audit_logs (user_id, action, target_id, details, branch_id, source)
  VALUES (v_emp, 'ENCARGO_PROVEEDOR_NO_ENTREGO', p_id::text,
          jsonb_build_object('eleccion', p_eleccion, 'monto', e.anticipo, 'reserva_saldo', v_id, 'antes', e.estado, 'motivo', v_motivo),
          e.branch_id, 'ADMIN_PANEL');
  RETURN json_build_object('ok', true, 'eleccion', p_eleccion, 'monto', e.anticipo, 'reserva', 'R-' || lpad(v_id::text, 6, '0'), 'reserva_id', v_id);
END $$;
REVOKE EXECUTE ON FUNCTION public.encargo_proveedor_no_entrego(bigint, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.encargo_proveedor_no_entrego(bigint, text, text) TO authenticated, service_role;
