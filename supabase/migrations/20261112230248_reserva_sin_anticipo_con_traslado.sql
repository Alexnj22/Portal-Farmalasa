-- Reserva sin anticipo TAMBIÉN pidiendo a otra sala (2026-11-12, pedido del
-- usuario): «ya habíamos hablado que sin anticipo sí se puede y queda a
-- responsabilidad de la persona». El freno de 20261105181147 se quita.
--
-- Con traslado la reserva nace como la de `apartado_aplicar` modo 'nueva':
-- PENDIENTE, sin plazo y con `traslado_desde`; el plazo lo pone
-- `app_reservas_guardas` al marcarla lista, con los días de una reserva sin
-- pagar (`reserva_dias_retiro('pendiente', 0)`). El traslado lo pide la
-- pantalla con `reserva_id`, igual que con anticipo.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.apartado_sin_anticipo(p_branch_id bigint, p_apartado jsonb)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_emp uuid := public.auth_employee_id();
  v_modo text := p_apartado->>'modo';
  v_cliente bigint := nullif(p_apartado->>'customer_id', '')::bigint;
  v_desde bigint := nullif(p_apartado->>'traslado_desde', '')::bigint;
  v_cot json; v_pedido text; v_id bigint; v_ids bigint[] := '{}'; l jsonb;
  v_vence timestamptz; v_pend boolean; v_codigo text; c record;
BEGIN
  IF v_emp IS NULL OR NOT (SELECT public.auth_can_edit_any(ARRAY['reservas']))
     OR NOT public.reserva_puede_manejar(p_branch_id) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.branches b WHERE b.id = p_branch_id AND coalesce(b.type, 'FARMACIA') = 'FARMACIA') THEN
    RAISE EXCEPTION 'Se aparta en una sala de venta.';
  END IF;
  IF v_modo IS DISTINCT FROM 'nueva' AND v_modo IS DISTINCT FROM 'pedido' THEN
    RAISE EXCEPTION 'Sin anticipo se aparta un producto o un pedido nuevo.';
  END IF;

  -- Las mismas validaciones que con anticipo: cliente, precio, existencia, traslados en camino.
  v_cot := public.apartado_cotizar(p_branch_id, p_apartado);

  IF v_modo = 'pedido' THEN
    v_pedido := public.apartado_codigo_de_pedido();
    FOR l IN SELECT * FROM jsonb_array_elements(p_apartado->'lineas') LOOP
      v_ids := v_ids || public.apartado_crear_reserva(p_branch_id, v_cliente, l, 0, NULL, v_emp, v_pedido, true);
    END LOOP;
    v_codigo := v_pedido;
  ELSIF v_desde IS NOT NULL THEN
    INSERT INTO public.app_reservas (customer_id, branch_id, origen, producto_id, producto_nombre, cantidad, factor,
        precio_unitario, precio_normal, estado, terminos_version, anticipo, pendiente_at, traslado_desde,
        pago_estado, pago_metodo)
    VALUES (v_cliente, p_branch_id, 'sucursal', (p_apartado->>'producto_id')::bigint,
        left(btrim(p_apartado->>'producto_nombre'), 200), (p_apartado->>'cantidad')::integer,
        greatest(coalesce((p_apartado->>'factor')::integer, 1), 1),
        round((p_apartado->>'precio')::numeric, 2), round((p_apartado->>'precio')::numeric, 2),
        'pendiente', 'sucursal-v3', 0, now(), v_desde, 'pendiente', 'al_retirar')
    RETURNING id INTO v_id;
    v_ids := ARRAY[v_id];
    v_codigo := 'R-' || lpad(v_id::text, 6, '0');
  ELSE
    v_id := public.apartado_crear_reserva(p_branch_id, v_cliente, p_apartado, 0, NULL, v_emp, NULL, true);
    v_ids := ARRAY[v_id];
    v_codigo := 'R-' || lpad(v_id::text, 6, '0');
  END IF;

  UPDATE public.app_reservas SET responsable_id = v_emp, responsable_at = now() WHERE id = ANY (v_ids);
  SELECT min(vence_at), bool_or(estado = 'pendiente') INTO v_vence, v_pend FROM public.app_reservas WHERE id = ANY (v_ids);
  SELECT name, phone INTO c FROM public.customers WHERE id = v_cliente;

  INSERT INTO public.audit_logs (action, target_id, details, branch_id, user_id, source)
  VALUES ('RESERVA_SIN_ANTICIPO', v_codigo,
          jsonb_build_object('reservas', to_jsonb(v_ids), 'total', (v_cot->>'total')::numeric, 'responsable', v_emp,
                             'traslado_desde', v_desde),
          p_branch_id, v_emp, 'ADMIN_PANEL');

  RETURN json_build_object('codigo', v_codigo, 'id', v_ids[1], 'ids', to_json(v_ids), 'pedido', v_pedido,
    'total', (v_cot->>'total')::numeric, 'vence_at', CASE WHEN v_pend THEN NULL ELSE v_vence END,
    'cliente', c.name, 'telefono', c.phone, 'detalle', v_cot->>'detalle', 'traslado_desde', v_desde);
END $function$;
