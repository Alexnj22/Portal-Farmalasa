SET lock_timeout = '5s';

-- Retirar lo apartado, parte 2 de 3: leer, aplicar y entregar (2026-10-20).

-- ── Lo que hay que saber para retirar ──────────────────────────────────────
-- Lo pagado, separado por dónde está el dinero: efectivo de la caja, otras
-- formas de la caja (tarjeta, transferencia) y en línea (lo que no pasó por la
-- caja). Con eso se decide contado o crédito.
CREATE OR REPLACE FUNCTION public.apartado_para_retirar(p_branch_id bigint, p_apartado jsonb)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_tipo text; v_id bigint; v_branch bigint; v_estado text; v_listo boolean; v_customer bigint;
  v_producto text; v_total numeric; v_pagado numeric; v_codigo text; v_prueba boolean := false;
  v_efectivo numeric := 0; v_otras numeric := 0; v_cliente text; v_aplicado json;
  r public.app_reservas; e public.app_encargos;
BEGIN
  -- Desde el navegador, sólo la sala propia (o quien edita las ofertas).
  IF coalesce(auth.role(), '') <> 'service_role'
     AND NOT (p_branch_id = (SELECT public.auth_employee_branch_id()) OR public.auth_can_edit_any(ARRAY['ofertas_clientes'])) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF p_apartado ? 'reserva_id' THEN
    SELECT * INTO r FROM public.app_reservas WHERE id = (p_apartado->>'reserva_id')::bigint;
    IF NOT FOUND THEN RAISE EXCEPTION 'Esa reserva no existe.'; END IF;
    v_tipo := 'reserva'; v_id := r.id; v_branch := r.branch_id; v_estado := r.estado; v_listo := r.estado = 'lista';
    v_customer := r.customer_id; v_producto := r.producto_nombre; v_codigo := 'R-' || lpad(r.id::text, 6, '0');
    v_total := round(r.precio_unitario * r.cantidad + coalesce(r.costo_envio, 0), 2);
    v_pagado := greatest(coalesce(r.anticipo, 0), CASE WHEN r.pago_estado = 'pagado' THEN v_total ELSE 0 END);
    v_prueba := coalesce(r.pago_prueba, false);
    SELECT coalesce(sum(monto) FILTER (WHERE forma_pago = 'EFECTIVO'), 0), coalesce(sum(monto) FILTER (WHERE forma_pago <> 'EFECTIVO'), 0)
      INTO v_efectivo, v_otras
      FROM public.caja_movimientos_portal WHERE reserva_id = r.id AND tipo_codigo = 'APARTADO' AND anulado_at IS NULL;
    SELECT to_json(a) INTO v_aplicado FROM public.apartado_aplicaciones a WHERE a.reserva_id = r.id;
  ELSE
    SELECT * INTO e FROM public.app_encargos WHERE id = (p_apartado->>'encargo_id')::bigint;
    IF NOT FOUND THEN RAISE EXCEPTION 'Ese encargo no existe.'; END IF;
    v_tipo := 'encargo'; v_id := e.id; v_branch := e.branch_id; v_estado := e.estado; v_listo := e.estado = 'listo';
    v_customer := e.customer_id; v_producto := e.producto_nombre; v_codigo := 'E-' || lpad(e.id::text, 6, '0');
    v_total := round(coalesce(e.anticipo, e.precio_unitario * e.cantidad, 0), 2);
    v_pagado := CASE WHEN e.pago_estado = 'pagado' THEN v_total ELSE 0 END;
    SELECT coalesce(sum(monto) FILTER (WHERE forma_pago = 'EFECTIVO'), 0), coalesce(sum(monto) FILTER (WHERE forma_pago <> 'EFECTIVO'), 0)
      INTO v_efectivo, v_otras
      FROM public.caja_movimientos_portal WHERE encargo_id = e.id AND tipo_codigo = 'APARTADO' AND anulado_at IS NULL;
    SELECT to_json(a) INTO v_aplicado FROM public.apartado_aplicaciones a WHERE a.encargo_id = e.id;
  END IF;
  IF v_branch <> p_branch_id THEN RAISE EXCEPTION 'Eso se retira en otra sala.'; END IF;
  SELECT name INTO v_cliente FROM public.customers WHERE id = v_customer;
  RETURN json_build_object(
    'tipo', v_tipo, 'id', v_id, 'codigo', v_codigo, 'estado', v_estado, 'listo', v_listo, 'prueba', v_prueba,
    'customer_id', v_customer, 'cliente', v_cliente, 'producto', v_producto,
    'total', v_total, 'pagado', round(v_pagado, 2), 'saldo', round(greatest(v_total - v_pagado, 0), 2),
    'efectivo', round(v_efectivo, 2), 'otras_formas', round(v_otras, 2),
    'en_linea', round(greatest(v_pagado - v_efectivo - v_otras, 0), 2),
    'aplicado', v_aplicado);
END $function$;
REVOKE ALL ON FUNCTION public.apartado_para_retirar(bigint, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apartado_para_retirar(bigint, jsonb) TO authenticated, service_role;

-- Marca retirada la reserva o entregado el encargo. Interna.
CREATE OR REPLACE FUNCTION public.apartado_marcar_entregado(p_apartado jsonb, p_employee uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v_branch bigint;
BEGIN
  IF p_apartado ? 'reserva_id' THEN
    UPDATE public.app_reservas
       SET estado = 'retirada', cerrada_at = now(), cerrada_por = p_employee, updated_at = now(),
           pago_estado = CASE WHEN pago_estado IN ('pendiente', 'anticipo') THEN 'pagado' ELSE pago_estado END,
           pagado_at = coalesce(pagado_at, now())
     WHERE id = (p_apartado->>'reserva_id')::bigint AND estado = 'lista'
    RETURNING branch_id INTO v_branch;
    IF NOT FOUND THEN RAISE EXCEPTION 'Esa reserva no está lista para retirar.'; END IF;
    INSERT INTO public.audit_logs (user_id, action, target_id, details, branch_id, source)
    VALUES (p_employee, 'RESERVA_RETIRADA', p_apartado->>'reserva_id', jsonb_build_object('por', 'retiro'), v_branch, 'ADMIN_PANEL');
  ELSE
    UPDATE public.app_encargos SET estado = 'entregado', cerrado_at = now(), updated_at = now()
     WHERE id = (p_apartado->>'encargo_id')::bigint AND estado = 'listo'
    RETURNING branch_id INTO v_branch;
    IF NOT FOUND THEN RAISE EXCEPTION 'Ese encargo no está listo para entregar.'; END IF;
    INSERT INTO public.audit_logs (user_id, action, target_id, details, branch_id, source)
    VALUES (p_employee, 'ENCARGO_ENTREGADO', p_apartado->>'encargo_id', jsonb_build_object('por', 'retiro'), v_branch, 'ADMIN_PANEL');
  END IF;
END $function$;
REVOKE ALL ON FUNCTION public.apartado_marcar_entregado(jsonb, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apartado_marcar_entregado(jsonb, uuid) TO service_role;

-- ── Registrar la aplicación y entregar ─────────────────────────────────────
-- La llaman `operar-caja` (el vale) y `creditos-erp` (el abono al crédito),
-- las dos con `p_entregar`: con la factura hecha, el producto sale. Lo que
-- falte de un crédito se cobra después, como cualquier crédito.
CREATE OR REPLACE FUNCTION public.apartado_aplicacion_registrar(p_branch_id bigint, p_apartado jsonb, p_modo text,
    p_monto numeric, p_credito text, p_movimiento bigint, p_employee uuid, p_entregar boolean)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v_id bigint;
BEGIN
  INSERT INTO public.apartado_aplicaciones (reserva_id, encargo_id, branch_id, modo, monto, credito_erp, movimiento_id, creado_por)
  VALUES ((p_apartado->>'reserva_id')::bigint, (p_apartado->>'encargo_id')::bigint, p_branch_id, p_modo,
          round(p_monto, 2), p_credito, p_movimiento, p_employee)
  RETURNING id INTO v_id;
  IF p_movimiento IS NOT NULL THEN
    UPDATE public.caja_movimientos_portal
       SET reserva_id = (p_apartado->>'reserva_id')::bigint, encargo_id = (p_apartado->>'encargo_id')::bigint
     WHERE id = p_movimiento;
  END IF;
  IF p_entregar THEN PERFORM public.apartado_marcar_entregado(p_apartado, p_employee); END IF;
  RETURN json_build_object('id', v_id);
END $function$;
REVOKE ALL ON FUNCTION public.apartado_aplicacion_registrar(bigint, jsonb, text, numeric, text, bigint, uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apartado_aplicacion_registrar(bigint, jsonb, text, numeric, text, bigint, uuid, boolean) TO service_role;

-- ── Entregar desde la sala ─────────────────────────────────────────────────
-- Lo que no tiene anticipo se entrega sin más (se factura como cualquier
-- venta). Lo que tiene anticipo exige que ya esté aplicado: si no, el dinero
-- se contaría dos veces o el crédito quedaría debiendo lo que ya se pagó.
CREATE OR REPLACE FUNCTION public.apartado_entregar(p_branch_id bigint, p_apartado jsonb)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v json := public.apartado_para_retirar(p_branch_id, p_apartado);
BEGIN
  IF NOT (p_branch_id = (SELECT public.auth_employee_branch_id()) OR public.auth_can_edit_any(ARRAY['ofertas_clientes'])) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF (v->>'pagado')::numeric > 0.004 AND (v->'aplicado') IS NULL AND NOT (v->>'prueba')::boolean THEN
    RAISE EXCEPTION 'Primero se aplica el anticipo a la factura: usa «Retirar».';
  END IF;
  PERFORM public.apartado_marcar_entregado(p_apartado, public.auth_employee_id());
  RETURN json_build_object('ok', true);
END $function$;
REVOKE ALL ON FUNCTION public.apartado_entregar(bigint, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apartado_entregar(bigint, jsonb) TO authenticated, service_role;
