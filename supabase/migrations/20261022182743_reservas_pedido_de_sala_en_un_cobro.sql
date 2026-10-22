SET lock_timeout = '5s';

-- El código de un pedido, con el mismo alfabeto que el carrito de la app
-- (sin 0/O, 1/I/L): se dicta por teléfono y se escanea.
CREATE OR REPLACE FUNCTION public.apartado_codigo_de_pedido()
 RETURNS text
 LANGUAGE plpgsql
 VOLATILE
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v text; abc text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
BEGIN
  LOOP
    v := 'P-' || (SELECT string_agg(substr(abc, 1 + floor(random() * length(abc))::int, 1), '') FROM generate_series(1, 6));
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.app_reservas WHERE pedido = v);
  END LOOP;
  RETURN v;
END $function$;
REVOKE EXECUTE ON FUNCTION public.apartado_codigo_de_pedido() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apartado_codigo_de_pedido() TO service_role;

-- Un renglón de un pedido de sala como reserva: la misma fila que un apartado
-- 'nueva' de caja (lista si hay en la sala; pendiente si viene en camino, y
-- amarrada a esos traslados), con el código del pedido.
CREATE OR REPLACE FUNCTION public.apartado_crear_reserva(p_branch_id bigint, p_customer_id bigint, p_linea jsonb, p_anticipo numeric,
    p_metodo text, p_employee uuid, p_pedido text, p_sin_pagar boolean)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_reqs uuid[] := public.apartado_traslados_pedidos(p_linea);
  v_viene boolean := cardinality(public.apartado_traslados_pedidos(p_linea)) > 0;
  v_total numeric := round((p_linea->>'precio')::numeric * (p_linea->>'cantidad')::integer, 2);
  v_id bigint;
BEGIN
  INSERT INTO public.app_reservas (customer_id, branch_id, origen, producto_id, producto_nombre, cantidad, factor,
      precio_unitario, precio_normal, estado, terminos_version, anticipo, lista_at, vence_at, preparada_por,
      pendiente_at, pedido, pago_estado, pago_metodo, pagado_at)
  VALUES (p_customer_id, p_branch_id, 'sucursal', (p_linea->>'producto_id')::bigint,
      left(btrim(p_linea->>'producto_nombre'), 200), (p_linea->>'cantidad')::integer,
      greatest(coalesce((p_linea->>'factor')::integer, 1), 1),
      round((p_linea->>'precio')::numeric, 2), round((p_linea->>'precio')::numeric, 2),
      CASE WHEN v_viene THEN 'pendiente' ELSE 'lista' END, CASE WHEN p_sin_pagar THEN 'sucursal-v3' ELSE 'sucursal-v2' END,
      round(coalesce(p_anticipo, 0), 2),
      CASE WHEN NOT v_viene THEN now() END,
      CASE WHEN NOT v_viene THEN now() + make_interval(days => (SELECT CASE WHEN p_sin_pagar THEN p.dias_sin_pagar ELSE p.dias_apartado END
                                                                  FROM public.reserva_plazos() p)) END,
      CASE WHEN NOT v_viene THEN p_employee END,
      CASE WHEN v_viene THEN now() END, p_pedido,
      CASE WHEN p_sin_pagar OR coalesce(p_anticipo, 0) <= 0 THEN 'pendiente'
           WHEN round(p_anticipo, 2) >= v_total - 0.004 THEN 'pagado' ELSE 'anticipo' END,
      CASE WHEN p_sin_pagar THEN NULL ELSE p_metodo END, CASE WHEN p_sin_pagar THEN NULL ELSE now() END)
  RETURNING id INTO v_id;
  IF v_viene THEN
    PERFORM public.reserva_amarrar_traslados(v_id, v_reqs, coalesce((p_linea->>'encargar_resto')::boolean, false));
  END IF;
  RETURN v_id;
END $function$;
REVOKE EXECUTE ON FUNCTION public.apartado_crear_reserva(bigint, bigint, jsonb, numeric, text, uuid, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apartado_crear_reserva(bigint, bigint, jsonb, numeric, text, uuid, text, boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.apartado_cotizar(p_branch_id bigint, p_apartado jsonb)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_modo text := p_apartado->>'modo';
  v_cant integer; v_factor integer; v_precio numeric; v_total numeric; v_disp numeric;
  v_desde bigint := nullif(p_apartado->>'traslado_desde', '')::bigint; v_desde_nombre text;
  v_reqs uuid[] := public.apartado_traslados_pedidos(p_apartado); v_viene json; v_vienen numeric := 0; v_falta integer;
  v_resto boolean := coalesce((p_apartado->>'encargar_resto')::boolean, false);
  r public.app_reservas; e public.app_encargos; v_cliente text; k record;
  l jsonb; v_c json; v_baja boolean := false; v_todos uuid[] := '{}';
BEGIN
  -- Un PEDIDO de sala (2026-10-22): varios productos, un solo cobro. Cada
  -- renglón es una reserva 'nueva' y se valida como tal; un traslado en camino
  -- no puede servir a dos renglones. Lo que se pide a otra sala va aparte.
  IF v_modo = 'pedido' THEN
    IF jsonb_typeof(p_apartado->'lineas') IS DISTINCT FROM 'array'
       OR jsonb_array_length(p_apartado->'lineas') NOT BETWEEN 2 AND 10 THEN
      RAISE EXCEPTION 'Un pedido lleva de 2 a 10 productos.';
    END IF;
    IF (SELECT count(DISTINCT x->>'producto_id') FROM jsonb_array_elements(p_apartado->'lineas') x)
       < jsonb_array_length(p_apartado->'lineas') THEN
      RAISE EXCEPTION 'Un producto va una sola vez en el pedido: súmale la cantidad.';
    END IF;
    v_total := 0;
    FOR l IN SELECT * FROM jsonb_array_elements(p_apartado->'lineas') LOOP
      IF nullif(l->>'traslado_desde', '') IS NOT NULL THEN
        RAISE EXCEPTION 'En un pedido, lo que se pide a otra sala se aparta aparte.';
      END IF;
      IF public.apartado_traslados_pedidos(l) && v_todos THEN
        RAISE EXCEPTION 'Un mismo traslado no puede apartarse para dos productos.';
      END IF;
      v_todos := v_todos || public.apartado_traslados_pedidos(l);
      v_c := public.apartado_cotizar(p_branch_id, l || jsonb_build_object('modo', 'nueva', 'customer_id', p_apartado->'customer_id'));
      v_total := v_total + (v_c->>'total')::numeric;
      v_baja := v_baja OR coalesce((v_c->>'baja_rotacion')::boolean, false);
      v_cliente := v_c->>'cliente';
      v_desde_nombre := CASE WHEN v_c->>'traslado_desde' IS NULL THEN v_desde_nombre
                             ELSE coalesce(v_desde_nombre || ' y ', '') || (v_c->>'traslado_desde') END;
    END LOOP;
    RETURN json_build_object('tipo', 'reserva', 'total', round(v_total, 2), 'minimo', 0.01, 'maximo', round(v_total, 2),
      'baja_rotacion', v_baja, 'cliente', v_cliente, 'traslado_desde', v_desde_nombre,
      'detalle', jsonb_array_length(p_apartado->'lineas') || ' productos');
  END IF;

  IF v_modo = 'nueva' THEN
    v_cant := (p_apartado->>'cantidad')::integer;
    v_factor := greatest(coalesce((p_apartado->>'factor')::integer, 1), 1);
    v_precio := round((p_apartado->>'precio')::numeric, 2);
    SELECT name INTO v_cliente FROM public.customers WHERE id = (p_apartado->>'customer_id')::bigint;
    IF v_cliente IS NULL THEN RAISE EXCEPTION 'Elige el cliente del listado.'; END IF;
    IF v_cant IS NULL OR v_cant < 1 OR v_cant > 999 THEN RAISE EXCEPTION 'La cantidad va de 1 a 999.'; END IF;
    -- El precio queda fijo sólo si es el del catálogo para esa presentación.
    IF v_precio IS NULL OR NOT EXISTS (SELECT 1 FROM public.product_precios pp
        WHERE pp.product_id = (p_apartado->>'producto_id')::bigint AND pp.activo AND pp.factor = v_factor
          AND round(pp.vineta, 2) = v_precio) THEN
      RAISE EXCEPTION 'Ese precio no es el del catálogo para esa presentación.';
    END IF;
    IF cardinality(v_reqs) > 0 THEN
      -- Ya viene en camino (2026-10-22): mandan esos traslados, que tienen que
      -- ser a esta sala, de este producto, seguir abiertos y no estar tomados
      -- por otra reserva. Lo que no alcanzan se encarga a Bodega con la reserva.
      FOR v_viene IN SELECT x FROM json_array_elements(public.traslados_en_camino_a_sala(p_branch_id, (p_apartado->>'producto_id')::bigint)) x
                      WHERE (x->>'id')::uuid = ANY (v_reqs) LOOP
        v_vienen := v_vienen + (v_viene->>'unidades')::numeric;
        v_desde_nombre := coalesce(v_desde_nombre || ' y ', '') || (v_viene->>'origen');
      END LOOP;
      IF (SELECT count(*) FROM json_array_elements(public.traslados_en_camino_a_sala(p_branch_id, (p_apartado->>'producto_id')::bigint)) x
           WHERE (x->>'id')::uuid = ANY (v_reqs)) <> cardinality(v_reqs) THEN
        RAISE EXCEPTION 'Uno de esos traslados ya no está en camino para apartar: vuelve a revisarlo.';
      END IF;
      v_falta := v_cant - floor(v_vienen / v_factor)::integer;
      IF v_falta > 0 AND NOT v_resto THEN
        RAISE EXCEPTION 'Vienen % y se piden %: encarga el resto a Bodega o pide menos.', floor(v_vienen / v_factor), v_cant;
      END IF;
      IF v_falta > 20 THEN RAISE EXCEPTION 'Bodega encarga hasta 20 por pedido y faltan %.', v_falta; END IF;
    ELSIF v_desde IS NOT NULL THEN
      -- Viene de otra sala: la existencia que manda es la de ESA sala.
      IF v_desde = p_branch_id THEN RAISE EXCEPTION 'El traslado tiene que venir de otra sala.'; END IF;
      SELECT name INTO v_desde_nombre FROM public.branches WHERE id = v_desde;
      IF v_desde_nombre IS NULL THEN RAISE EXCEPTION 'Esa sala no existe.'; END IF;
      SELECT coalesce(max((x->>'disponibles')::numeric), 0) INTO v_disp
        FROM json_array_elements(public.app_existencias_netas(ARRAY[(p_apartado->>'producto_id')::int])) x
       WHERE (x->>'branch_id')::bigint = v_desde;
      IF v_disp < v_cant * v_factor THEN
        RAISE EXCEPTION 'En % hay % unidades y se piden %.', v_desde_nombre, v_disp, v_cant * v_factor;
      END IF;
    ELSE
      SELECT coalesce(max((x->>'disponibles')::numeric), 0) INTO v_disp
        FROM json_array_elements(public.app_existencias_netas(ARRAY[(p_apartado->>'producto_id')::int])) x
       WHERE (x->>'branch_id')::bigint = p_branch_id;
      IF v_disp < v_cant * v_factor THEN
        RAISE EXCEPTION 'En esta sala hay % unidades y se piden %: se encarga, no se aparta.', v_disp, v_cant * v_factor;
      END IF;
    END IF;
    v_total := round(v_precio * v_cant, 2);
    -- Reglamento v2, cláusula 4.2 (2026-10-22): un apartado —con existencia en
    -- la sala o traído de otra— no tiene monto mínimo; la pantalla sugiere 50 %
    -- y 100 %, y con muy baja rotación propone el 100 %. Sólo el encargo se
    -- paga completo.
    RETURN json_build_object('tipo', 'reserva', 'total', v_total, 'minimo', 0.01, 'maximo', v_total,
      'baja_rotacion', public.producto_baja_rotacion((p_apartado->>'producto_id')::bigint, p_branch_id),
      'cliente', v_cliente, 'detalle', (p_apartado->>'producto_nombre'), 'traslado_desde', v_desde_nombre);

  ELSIF v_modo = 'reserva' THEN
    SELECT * INTO r FROM public.app_reservas WHERE id = (p_apartado->>'reserva_id')::bigint;
    IF NOT FOUND THEN RAISE EXCEPTION 'Esa reserva no existe.'; END IF;
    IF r.branch_id <> p_branch_id THEN RAISE EXCEPTION 'Esa reserva es de otra sala.'; END IF;
    -- Una reserva de la app se paga en la app o al retirarla, nunca con un
    -- anticipo de caja: mezclar las dos formas es lo que cobraba dos veces.
    IF r.origen IS DISTINCT FROM 'sucursal' THEN RAISE EXCEPTION 'Esa reserva es de la app: se paga en la app o al retirarla.'; END IF;
    IF r.estado NOT IN ('pendiente', 'lista') THEN RAISE EXCEPTION 'Esa reserva ya no está abierta.'; END IF;
    -- Cuánto falta: lo dice `reserva_cuenta` (descuenta anticipo y pago en línea).
    SELECT * INTO k FROM public.reserva_cuenta(r.id);
    IF k.falta_pagar <= 0.004 THEN RAISE EXCEPTION 'Esa reserva ya está pagada.'; END IF;
    SELECT name INTO v_cliente FROM public.customers WHERE id = r.customer_id;
    RETURN json_build_object('tipo', 'reserva', 'total', k.total, 'minimo', 0.01,
      'maximo', k.falta_pagar, 'cliente', v_cliente, 'detalle', r.producto_nombre,
      'codigo', 'R-' || lpad(r.id::text, 6, '0'));

  ELSIF v_modo = 'encargo' THEN
    SELECT * INTO e FROM public.app_encargos WHERE id = (p_apartado->>'encargo_id')::bigint;
    IF NOT FOUND THEN RAISE EXCEPTION 'Ese encargo no existe.'; END IF;
    IF e.branch_id <> p_branch_id THEN RAISE EXCEPTION 'Ese encargo es de otra sala.'; END IF;
    IF e.estado <> 'confirmado' THEN RAISE EXCEPTION 'Ese encargo todavía no tiene el precio confirmado.'; END IF;
    IF e.pago_estado <> 'pendiente' THEN RAISE EXCEPTION 'Ese encargo ya está pagado.'; END IF;
    -- El resto de una reserva (2026-10-22) se paga con la reserva: cobrarlo acá sería cobrar dos veces.
    IF e.reserva_id IS NOT NULL THEN
      RAISE EXCEPTION 'Ese encargo es el resto de la reserva R-%: se cobra con la reserva.', lpad(e.reserva_id::text, 6, '0');
    END IF;
    SELECT name INTO v_cliente FROM public.customers WHERE id = e.customer_id;
    -- El encargo se paga completo: lo que no tenemos se pide para esa persona.
    RETURN json_build_object('tipo', 'encargo', 'total', round(e.anticipo, 2), 'minimo', round(e.anticipo, 2),
      'maximo', round(e.anticipo, 2), 'cliente', v_cliente, 'detalle', e.producto_nombre,
      'codigo', 'E-' || lpad(e.id::text, 6, '0'));
  END IF;
  RAISE EXCEPTION 'No se sabe qué se está apartando.';
END $function$;

CREATE OR REPLACE FUNCTION public.apartado_aplicar(p_branch_id bigint, p_apartado jsonb, p_movimiento bigint, p_monto numeric, p_forma text, p_employee uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_cot json := public.apartado_cotizar(p_branch_id, p_apartado);
  v_modo text := p_apartado->>'modo';
  v_metodo text := lower(coalesce(p_forma, 'EFECTIVO'));
  v_reqs uuid[] := public.apartado_traslados_pedidos(p_apartado);
  v_desde bigint := coalesce(
    (SELECT nullif(ar.metadata->>'origen_branch_id', '')::bigint FROM public.approval_requests ar WHERE ar.id = v_reqs[1]),
    nullif(p_apartado->>'traslado_desde', '')::bigint);
  v_id bigint; v_total numeric := (v_cot->>'total')::numeric; v_anticipo numeric; v_vence timestamptz;
  r public.app_reservas; k record;
  v_pedido text; l jsonb; v_lt numeric; v_parte numeric; v_resto numeric; v_i integer := 0; v_n integer;
  v_reparto jsonb := '[]'::jsonb; v_primera bigint; v_vence_min timestamptz; v_pendiente boolean := false;
BEGIN
  IF p_monto < (v_cot->>'minimo')::numeric - 0.004 OR p_monto > (v_cot->>'maximo')::numeric + 0.004 THEN
    RAISE EXCEPTION 'El cobro va de % a %.', to_char((v_cot->>'minimo')::numeric, 'FM$999,990.00'),
      to_char((v_cot->>'maximo')::numeric, 'FM$999,990.00');
  END IF;

  IF v_modo = 'pedido' THEN
    -- Un pedido de sala: una reserva por renglón con el mismo código P-, y el
    -- cobro repartido en proporción a cada total (el último se lleva el
    -- redondeo). El reparto queda en el movimiento: lo leen retirar, deshacer y
    -- corregir el monto.
    v_pedido := public.apartado_codigo_de_pedido();
    v_n := jsonb_array_length(p_apartado->'lineas'); v_resto := round(p_monto, 2);
    FOR l IN SELECT * FROM jsonb_array_elements(p_apartado->'lineas') LOOP
      v_i := v_i + 1;
      v_lt := round((l->>'precio')::numeric * (l->>'cantidad')::integer, 2);
      v_parte := CASE WHEN v_i = v_n THEN v_resto ELSE least(round(p_monto * v_lt / nullif(v_total, 0), 2), v_resto) END;
      v_resto := round(v_resto - v_parte, 2);
      v_id := public.apartado_crear_reserva(p_branch_id, (p_apartado->>'customer_id')::bigint, l, v_parte, v_metodo, p_employee, v_pedido, false);
      v_primera := coalesce(v_primera, v_id);
      v_reparto := v_reparto || jsonb_build_array(jsonb_build_object('reserva_id', v_id, 'monto', v_parte));
      SELECT vence_at, estado = 'pendiente' OR v_pendiente INTO v_vence, v_pendiente FROM public.app_reservas WHERE id = v_id;
      v_vence_min := least(v_vence_min, v_vence);
    END LOOP;
    UPDATE public.caja_movimientos_portal
       SET reserva_id = v_primera, apartado_previo = jsonb_build_object('modo', 'pedido', 'pedido', v_pedido, 'reparto', v_reparto)
     WHERE id = p_movimiento;
    RETURN json_build_object('tipo', 'reserva', 'id', v_primera, 'codigo', v_pedido, 'pedido', v_pedido,
      'total', v_total, 'anticipo', round(p_monto, 2), 'saldo', round(v_total - p_monto, 2),
      'vence_at', CASE WHEN v_pendiente THEN NULL ELSE v_vence_min END, 'reparto', v_reparto,
      'traslado_desde', v_cot->>'traslado_desde');

  ELSIF v_modo = 'nueva' THEN
    -- Con traslado nace PENDIENTE y sin plazo: el plazo empieza cuando llega y la sala la marca lista.
    INSERT INTO public.app_reservas (customer_id, branch_id, origen, producto_id, producto_nombre, cantidad, factor,
        precio_unitario, precio_normal, estado, terminos_version, anticipo, lista_at, vence_at, preparada_por,
        pendiente_at, traslado_desde, pago_estado, pago_metodo, pagado_at)
    VALUES ((p_apartado->>'customer_id')::bigint, p_branch_id, 'sucursal', (p_apartado->>'producto_id')::bigint,
        left(btrim(p_apartado->>'producto_nombre'), 200), (p_apartado->>'cantidad')::integer,
        greatest(coalesce((p_apartado->>'factor')::integer, 1), 1),
        round((p_apartado->>'precio')::numeric, 2), round((p_apartado->>'precio')::numeric, 2),
        CASE WHEN v_desde IS NULL THEN 'lista' ELSE 'pendiente' END, 'sucursal-v2',
        round(p_monto, 2),
        CASE WHEN v_desde IS NULL THEN now() END,
        CASE WHEN v_desde IS NULL THEN now() + make_interval(days => (SELECT p.dias_apartado FROM public.reserva_plazos() p)) END,
        CASE WHEN v_desde IS NULL THEN p_employee END,
        CASE WHEN v_desde IS NOT NULL THEN now() END, v_desde,
        CASE WHEN round(p_monto, 2) >= v_total - 0.004 THEN 'pagado' ELSE 'anticipo' END, v_metodo, now())
    RETURNING id, anticipo, vence_at INTO v_id, v_anticipo, v_vence;
    IF cardinality(v_reqs) > 0 THEN
      PERFORM public.reserva_amarrar_traslados(v_id, v_reqs, coalesce((p_apartado->>'encargar_resto')::boolean, false));
    END IF;
    UPDATE public.caja_movimientos_portal SET reserva_id = v_id, apartado_previo = jsonb_build_object('modo', 'nueva')
     WHERE id = p_movimiento;
    RETURN json_build_object('tipo', 'reserva', 'id', v_id, 'codigo', 'R-' || lpad(v_id::text, 6, '0'),
      'total', v_total, 'anticipo', v_anticipo, 'saldo', round(v_total - v_anticipo, 2), 'vence_at', v_vence,
      'traslado_desde', v_cot->>'traslado_desde');

  ELSIF v_modo = 'reserva' THEN
    v_id := (p_apartado->>'reserva_id')::bigint;
    SELECT * INTO r FROM public.app_reservas WHERE id = v_id FOR UPDATE;
    -- Bajo el candado se vuelve a preguntar cuánto falta: entre cotizar y
    -- cobrar pudo entrar otro cobro (de caja o en línea).
    SELECT * INTO k FROM public.reserva_cuenta(v_id);
    IF NOT FOUND OR r.origen IS DISTINCT FROM 'sucursal' OR r.estado NOT IN ('pendiente', 'lista')
       OR round(p_monto, 2) > k.falta_pagar + 0.004 THEN
      RAISE EXCEPTION 'Esa reserva ya cambió: vuelve a abrirla.';
    END IF;
    UPDATE public.app_reservas
       SET anticipo = round(coalesce(anticipo, 0) + p_monto, 2),
           pago_estado = CASE WHEN round(coalesce(anticipo, 0) + p_monto, 2) >= k.total - 0.004 THEN 'pagado' ELSE 'anticipo' END,
           pago_metodo = coalesce(pago_metodo, v_metodo),
           pagado_at = now(), updated_at = now()
     WHERE id = v_id
    RETURNING anticipo, vence_at INTO v_anticipo, v_vence;
    UPDATE public.caja_movimientos_portal
       SET reserva_id = v_id,
           apartado_previo = jsonb_build_object('modo', 'reserva', 'anticipo', coalesce(r.anticipo, 0),
             'pago_estado', r.pago_estado, 'pago_metodo', r.pago_metodo, 'pagado_at', r.pagado_at)
     WHERE id = p_movimiento;
    RETURN json_build_object('tipo', 'reserva', 'id', v_id, 'codigo', 'R-' || lpad(v_id::text, 6, '0'),
      'total', k.total, 'anticipo', v_anticipo, 'saldo', round(greatest(k.total - v_anticipo, 0), 2), 'vence_at', v_vence);

  ELSE
    v_id := (p_apartado->>'encargo_id')::bigint;
    UPDATE public.app_encargos SET pago_estado = 'pagado', pagado_at = now(), estado = 'aceptado', updated_at = now()
     WHERE id = v_id AND estado = 'confirmado' AND pago_estado = 'pendiente';
    IF NOT FOUND THEN RAISE EXCEPTION 'Ese encargo ya está pagado.'; END IF;
    UPDATE public.caja_movimientos_portal SET encargo_id = v_id, apartado_previo = jsonb_build_object('modo', 'encargo')
     WHERE id = p_movimiento;
    RETURN json_build_object('tipo', 'encargo', 'id', v_id, 'codigo', 'E-' || lpad(v_id::text, 6, '0'),
      'total', v_total, 'anticipo', v_total, 'saldo', 0);
  END IF;
END $function$;

CREATE OR REPLACE FUNCTION public.apartado_enlace_preparar(p_branch_id bigint, p_apartado jsonb, p_monto numeric, p_employee uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_cot json := public.apartado_cotizar(p_branch_id, p_apartado);
  v_modo text := p_apartado->>'modo';
  v_reqs uuid[] := public.apartado_traslados_pedidos(p_apartado);
  v_desde bigint := coalesce(
    (SELECT nullif(ar.metadata->>'origen_branch_id', '')::bigint FROM public.approval_requests ar WHERE ar.id = v_reqs[1]),
    nullif(p_apartado->>'traslado_desde', '')::bigint);
  v_monto numeric := round(p_monto, 2);
  v_reserva bigint; v_encargo bigint; v_cliente bigint; v_codigo text; v_ident text; v_vence timestamptz;
  c record;
BEGIN
  IF v_monto IS NULL OR v_monto < (v_cot->>'minimo')::numeric - 0.004 OR v_monto > (v_cot->>'maximo')::numeric + 0.004 THEN
    RAISE EXCEPTION 'El cobro va de % a %.', to_char((v_cot->>'minimo')::numeric, 'FM$999,990.00'),
      to_char((v_cot->>'maximo')::numeric, 'FM$999,990.00');
  END IF;

  IF v_modo = 'pedido' THEN
    RAISE EXCEPTION 'Un pedido de varios productos se cobra en caja: el enlace de pago es para uno solo.';
  ELSIF v_modo = 'nueva' THEN
    v_cliente := (p_apartado->>'customer_id')::bigint;
    INSERT INTO public.app_reservas (customer_id, branch_id, origen, producto_id, producto_nombre, cantidad, factor,
        precio_unitario, precio_normal, estado, terminos_version, anticipo, lista_at, vence_at, preparada_por,
        pendiente_at, traslado_desde, pago_estado)
    VALUES (v_cliente, p_branch_id, 'sucursal', (p_apartado->>'producto_id')::bigint,
        left(btrim(p_apartado->>'producto_nombre'), 200), (p_apartado->>'cantidad')::integer,
        greatest(coalesce((p_apartado->>'factor')::integer, 1), 1),
        round((p_apartado->>'precio')::numeric, 2), round((p_apartado->>'precio')::numeric, 2),
        CASE WHEN v_desde IS NULL THEN 'lista' ELSE 'pendiente' END, 'sucursal-v3', 0,
        CASE WHEN v_desde IS NULL THEN now() END,
        CASE WHEN v_desde IS NULL THEN now() + make_interval(days => (SELECT p.dias_sin_pagar FROM public.reserva_plazos() p)) END,
        CASE WHEN v_desde IS NULL THEN p_employee END,
        CASE WHEN v_desde IS NOT NULL THEN now() END, v_desde, 'pendiente')
    RETURNING id, vence_at INTO v_reserva, v_vence;
    IF cardinality(v_reqs) > 0 THEN
      PERFORM public.reserva_amarrar_traslados(v_reserva, v_reqs, coalesce((p_apartado->>'encargar_resto')::boolean, false));
    END IF;
    v_codigo := 'R-' || lpad(v_reserva::text, 6, '0');
  ELSIF v_modo = 'reserva' THEN
    v_reserva := (p_apartado->>'reserva_id')::bigint;
    SELECT customer_id, vence_at INTO v_cliente, v_vence FROM public.app_reservas WHERE id = v_reserva;
    v_codigo := 'R-' || lpad(v_reserva::text, 6, '0');
  ELSIF v_modo = 'encargo' THEN
    v_encargo := (p_apartado->>'encargo_id')::bigint;
    SELECT customer_id INTO v_cliente FROM public.app_encargos WHERE id = v_encargo;
    v_codigo := 'E-' || lpad(v_encargo::text, 6, '0');
  ELSE
    RAISE EXCEPTION 'No se sabe qué se está apartando.';
  END IF;

  -- «AP-»: la vuelta del navegador sabe que quien paga puede no tener la app.
  v_ident := 'AP-' || v_codigo || '-' || to_hex((extract(epoch FROM clock_timestamp()) * 1000)::bigint);
  INSERT INTO public.app_reservas_pagos (reserva_id, encargo_id, identificador, monto, customer_id, es_anticipo, creado_por)
  VALUES (v_reserva, v_encargo, v_ident, v_monto, v_cliente, v_encargo IS NULL, p_employee);

  SELECT name, phone INTO c FROM public.customers WHERE id = v_cliente;
  INSERT INTO public.audit_logs (action, target_id, details, branch_id, user_id, source)
  VALUES ('APARTADO_ENLACE_DE_PAGO', v_codigo,
          jsonb_build_object('monto', v_monto, 'identificador', v_ident, 'modo', v_modo, 'traslado_desde', v_desde),
          p_branch_id, p_employee, 'ADMIN_PANEL');
  RETURN json_build_object('identificador', v_ident, 'codigo', v_codigo, 'monto', v_monto,
    'reserva_id', v_reserva, 'encargo_id', v_encargo, 'nueva', v_modo = 'nueva', 'vence_at', v_vence,
    'cliente', c.name, 'telefono', c.phone, 'detalle', v_cot->>'detalle', 'total', (v_cot->>'total')::numeric);
END $function$;

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
  r public.app_reservas; e public.app_encargos; k record;
BEGIN
  -- Desde el navegador, sólo quien maneja las reservas de esa sala.
  IF coalesce(auth.role(), '') <> 'service_role' AND NOT public.reserva_puede_manejar(p_branch_id) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF p_apartado ? 'reserva_id' THEN
    SELECT * INTO r FROM public.app_reservas WHERE id = (p_apartado->>'reserva_id')::bigint;
    IF NOT FOUND THEN RAISE EXCEPTION 'Esa reserva no existe.'; END IF;
    v_tipo := 'reserva'; v_id := r.id; v_branch := r.branch_id; v_estado := r.estado; v_listo := r.estado = 'lista';
    v_customer := r.customer_id; v_producto := r.producto_nombre; v_codigo := 'R-' || lpad(r.id::text, 6, '0');
    SELECT * INTO k FROM public.reserva_cuenta(r.id);
    v_total := k.total; v_pagado := k.pagado;
    v_prueba := coalesce(r.pago_prueba, false);
    -- Un cobro de PEDIDO (2026-10-22) se reparte entre sus renglones: lo de
    -- esta reserva es su parte del reparto, no el movimiento entero.
    SELECT coalesce(sum(t.monto) FILTER (WHERE t.forma_pago = 'EFECTIVO'), 0), coalesce(sum(t.monto) FILTER (WHERE t.forma_pago <> 'EFECTIVO'), 0)
      INTO v_efectivo, v_otras
      FROM (SELECT m.forma_pago, m.monto FROM public.caja_movimientos_portal m
             WHERE m.reserva_id = r.id AND m.tipo_codigo = 'APARTADO' AND m.anulado_at IS NULL
               AND coalesce(m.apartado_previo->>'modo', '') <> 'pedido'
            UNION ALL
            SELECT m.forma_pago, (x->>'monto')::numeric FROM public.caja_movimientos_portal m
              CROSS JOIN LATERAL jsonb_array_elements(m.apartado_previo->'reparto') x
             WHERE r.pedido IS NOT NULL AND m.apartado_previo->>'modo' = 'pedido' AND m.apartado_previo->>'pedido' = r.pedido
               AND m.tipo_codigo = 'APARTADO' AND m.anulado_at IS NULL AND (x->>'reserva_id')::bigint = r.id) t;
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

CREATE OR REPLACE FUNCTION public.apartado_deshacer(p_movimiento bigint, p_anular boolean DEFAULT true)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  m public.caja_movimientos_portal%ROWTYPE; r public.app_reservas; k record;
  v_prev jsonb; v_nuevo numeric; v_en_linea boolean; v_familia boolean; x jsonb;
BEGIN
  SELECT * INTO m FROM public.caja_movimientos_portal WHERE id = p_movimiento FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  IF m.tipo_codigo IS DISTINCT FROM 'APARTADO' THEN RETURN; END IF;
  v_prev := m.apartado_previo;
  -- Un cobro de PEDIDO (2026-10-22): cada renglón se deshace con SU parte.
  -- Si el cobro lo creó y nadie más lo tocó, se borra; si no, se le resta.
  IF v_prev->>'modo' = 'pedido' THEN
    FOR x IN SELECT * FROM jsonb_array_elements(v_prev->'reparto') LOOP
      SELECT * INTO r FROM public.app_reservas WHERE id = (x->>'reserva_id')::bigint FOR UPDATE;
      CONTINUE WHEN NOT FOUND;
      v_familia := EXISTS (SELECT 1 FROM public.app_reservas y WHERE y.ajuste_de = r.id)
                OR EXISTS (SELECT 1 FROM public.app_encargos e WHERE e.reserva_id = r.id AND e.estado NOT IN ('solicitado', 'cancelado'));
      IF NOT v_familia AND r.estado IN ('pendiente', 'lista')
         AND NOT EXISTS (SELECT 1 FROM public.caja_movimientos_portal y
                          WHERE y.reserva_id = r.id AND y.id <> m.id AND y.anulado_at IS NULL AND y.tipo_codigo = 'APARTADO')
         AND NOT EXISTS (SELECT 1 FROM public.apartado_aplicaciones a WHERE a.reserva_id = r.id) THEN
        -- El resto encargado a Bodega todavía sin responder se va con la reserva.
        DELETE FROM public.app_encargos e WHERE e.reserva_id = r.id AND e.estado = 'solicitado';
        DELETE FROM public.app_reservas WHERE id = r.id;
      ELSIF v_familia THEN
        PERFORM public.reserva_quitar_de_familia(r.id, (x->>'monto')::numeric, format('Se anuló el cobro %s que lo originó.', m.id));
      ELSE
        SELECT * INTO k FROM public.reserva_cuenta(r.id);
        v_nuevo := greatest(round(coalesce(r.anticipo, 0) - (x->>'monto')::numeric, 2), 0);
        UPDATE public.app_reservas
           SET anticipo = v_nuevo,
               pago_estado = CASE WHEN v_nuevo > 0 AND v_nuevo >= k.total - 0.004 THEN 'pagado' WHEN v_nuevo > 0 THEN 'anticipo' ELSE 'pendiente' END,
               updated_at = now()
         WHERE id = r.id;
      END IF;
    END LOOP;
    UPDATE public.caja_movimientos_portal SET reserva_id = NULL WHERE id = m.id;
  ELSIF m.reserva_id IS NOT NULL THEN
    SELECT * INTO r FROM public.app_reservas WHERE id = m.reserva_id FOR UPDATE;
    IF FOUND THEN
      v_familia := EXISTS (SELECT 1 FROM public.app_reservas x WHERE x.ajuste_de = r.id)
                OR EXISTS (SELECT 1 FROM public.app_encargos e WHERE e.reserva_id = r.id);
      IF NOT v_familia AND r.origen = 'sucursal' AND r.estado IN ('pendiente', 'lista')
         AND (v_prev->>'modo' = 'nueva' OR (v_prev IS NULL AND r.created_at >= m.created_at))
         AND NOT EXISTS (SELECT 1 FROM public.caja_movimientos_portal x
                          WHERE x.reserva_id = r.id AND x.id <> m.id AND x.anulado_at IS NULL AND x.tipo_codigo = 'APARTADO')
         AND NOT EXISTS (SELECT 1 FROM public.apartado_aplicaciones a WHERE a.reserva_id = r.id) THEN
        UPDATE public.caja_movimientos_portal SET reserva_id = NULL WHERE id = m.id;
        DELETE FROM public.app_reservas WHERE id = r.id;
      ELSIF v_familia THEN
        PERFORM public.reserva_quitar_de_familia(r.id, m.monto,
          format('Se anuló el cobro %s que lo originó.', m.id));
      ELSE
        SELECT * INTO k FROM public.reserva_cuenta(r.id);
        v_nuevo := greatest(round(coalesce(r.anticipo, 0) - m.monto, 2), 0);
        v_en_linea := r.pago_estado = 'pagado' AND r.pago_metodo = 'en_linea';
        UPDATE public.app_reservas
           SET anticipo = v_nuevo,
               pago_estado = CASE
                 WHEN v_en_linea THEN pago_estado
                 WHEN v_nuevo > 0 AND v_nuevo >= k.total - 0.004 THEN 'pagado'
                 WHEN v_nuevo > 0 THEN 'anticipo'
                 ELSE coalesce(nullif(v_prev->>'pago_estado', 'anticipo'), 'pendiente') END,
               pago_metodo = CASE WHEN v_en_linea OR v_nuevo > 0 OR v_prev IS NULL OR NOT (v_prev ? 'pago_metodo') THEN pago_metodo
                                  ELSE coalesce(v_prev->>'pago_metodo', pago_metodo) END,
               pagado_at = CASE WHEN v_en_linea OR v_nuevo > 0 THEN pagado_at
                                ELSE (v_prev->>'pagado_at')::timestamptz END,
               updated_at = now()
         WHERE id = r.id;
      END IF;
    END IF;
  END IF;
  IF m.encargo_id IS NOT NULL THEN
    UPDATE public.app_encargos
       SET pago_estado = 'pendiente', pagado_at = NULL, updated_at = now(),
           estado = CASE WHEN estado = 'aceptado' THEN 'confirmado' ELSE estado END
     WHERE id = m.encargo_id AND pago_estado = 'pagado';
  END IF;
  IF p_anular THEN
    UPDATE public.caja_movimientos_portal
       SET anulado_at = now(), anulado_motivo = 'La caja no aceptó el cobro', clave_envio = NULL, reserva_id = NULL, encargo_id = NULL, updated_at = now()
     WHERE id = p_movimiento;
  END IF;
END $function$;

CREATE OR REPLACE FUNCTION public.apartado_cambiar_monto(p_movimiento bigint, p_antes numeric, p_nuevo numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE m public.caja_movimientos_portal%ROWTYPE; r public.app_reservas; k record; v_nuevo numeric;
  x jsonb; v_reparto jsonb := '[]'::jsonb; v_parte numeric; v_resto numeric; v_i integer := 0; v_n integer;
BEGIN
  SELECT * INTO m FROM public.caja_movimientos_portal WHERE id = p_movimiento FOR UPDATE;
  IF NOT FOUND OR m.reserva_id IS NULL OR m.tipo_codigo IS DISTINCT FROM 'APARTADO' THEN RETURN; END IF;
  -- Un cobro de PEDIDO (2026-10-22): el monto nuevo se reparte otra vez en
  -- proporción a lo que cada renglón tenía, y cada uno se ajusta con su parte.
  IF m.apartado_previo->>'modo' = 'pedido' THEN
    v_n := jsonb_array_length(m.apartado_previo->'reparto'); v_resto := round(p_nuevo, 2);
    FOR x IN SELECT * FROM jsonb_array_elements(m.apartado_previo->'reparto') LOOP
      v_i := v_i + 1;
      v_parte := CASE WHEN v_i = v_n THEN v_resto
                      ELSE least(round(p_nuevo * (x->>'monto')::numeric / nullif(p_antes, 0), 2), v_resto) END;
      v_resto := round(v_resto - v_parte, 2);
      SELECT * INTO r FROM public.app_reservas WHERE id = (x->>'reserva_id')::bigint FOR UPDATE;
      IF FOUND THEN
        SELECT * INTO k FROM public.reserva_cuenta(r.id);
        v_nuevo := greatest(round(coalesce(r.anticipo, 0) + (v_parte - (x->>'monto')::numeric), 2), 0);
        UPDATE public.app_reservas
           SET anticipo = v_nuevo,
               pago_estado = CASE WHEN v_nuevo > 0 AND v_nuevo >= k.total - 0.004 THEN 'pagado' WHEN v_nuevo > 0 THEN 'anticipo' ELSE 'pendiente' END,
               updated_at = now()
         WHERE id = r.id;
      END IF;
      v_reparto := v_reparto || jsonb_build_array(jsonb_build_object('reserva_id', (x->>'reserva_id')::bigint, 'monto', v_parte));
    END LOOP;
    UPDATE public.caja_movimientos_portal SET apartado_previo = apartado_previo || jsonb_build_object('reparto', v_reparto) WHERE id = m.id;
    RETURN;
  END IF;
  SELECT * INTO r FROM public.app_reservas WHERE id = m.reserva_id FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  IF p_nuevo < p_antes AND EXISTS (SELECT 1 FROM public.app_reservas x WHERE x.ajuste_de = r.id) THEN
    PERFORM public.reserva_quitar_de_familia(r.id, round(p_antes - p_nuevo, 2),
      format('Se corrigió a la baja el cobro %s que lo originó.', m.id));
    RETURN;
  END IF;
  SELECT * INTO k FROM public.reserva_cuenta(r.id);
  v_nuevo := greatest(round(coalesce(r.anticipo, 0) + (p_nuevo - p_antes), 2), 0);
  UPDATE public.app_reservas
     SET anticipo = v_nuevo,
         pago_estado = CASE WHEN pago_estado = 'pagado' AND pago_metodo = 'en_linea' THEN pago_estado
                            WHEN v_nuevo > 0 AND v_nuevo >= k.total - 0.004 THEN 'pagado'
                            WHEN v_nuevo > 0 THEN 'anticipo'
                            ELSE coalesce(nullif(m.apartado_previo->>'pago_estado', 'anticipo'), 'pendiente') END,
         updated_at = now()
   WHERE id = r.id;
END $function$;
