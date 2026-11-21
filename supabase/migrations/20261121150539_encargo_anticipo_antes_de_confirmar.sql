-- Anticipo de un encargo ANTES de que Bodega confirme (2026-11-21, pedido del usuario).
--
-- Un producto sin existencia en ninguna sucursal, pero con precio en el
-- catálogo, se encarga. Hasta hoy el dinero sólo podía entrar después de que
-- Bodega confirmara precio y fecha: si el cliente dejaba un anticipo antes, no
-- había cómo darle ingreso. Ahora:
--   · se cobra con el precio de la viñeta como REFERENCIA, sin mínimo y hasta
--     el total de referencia; el papel dice que el precio puede cambiar;
--   · al confirmar Bodega, el encargo pasa solo a «aceptado» (el cliente ya se
--     comprometió). Si el precio subió, la diferencia se cobra al retirar;
--   · si bajó y el cliente dejó de más: pagado en efectivo → se le devuelve en
--     efectivo al retirar (el vale del anticipo saca todo lo que entró y la
--     factura cuenta el total nuevo: el cajón cuadra con la devolución); con
--     otra forma de pago → la diferencia pasa a saldo a favor al confirmar;
--   · si Bodega no lo consigue, o el cliente desiste antes, lo pagado queda a
--     su favor (y desde ahí se puede pedir la devolución en efectivo).
-- Medido antes de decidir: de los últimos 12 encargos confirmados, Bodega dio
-- un precio entre 0 % y 22 % MENOR que la viñeta.
SET lock_timeout = '5s';

-- ── 1. Cotizar: el encargo sin confirmar se cobra contra el precio de referencia ──
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
        RAISE EXCEPTION 'En un pedido, lo que se pide a otra sucursal se aparta aparte.';
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
    -- El precio queda fijo sólo si es uno de la venta para esa presentación
    -- (viñeta a Mayoreo Plus, 2026-11-03): `precio_de_apartado_valido`.
    IF NOT public.precio_de_apartado_valido((p_apartado->>'producto_id')::bigint, v_factor, v_precio) THEN
      RAISE EXCEPTION 'Ese precio no es uno de la venta para esa presentación.';
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
      IF v_desde = p_branch_id THEN RAISE EXCEPTION 'El traslado tiene que venir de otra sucursal.'; END IF;
      SELECT name INTO v_desde_nombre FROM public.branches WHERE id = v_desde;
      IF v_desde_nombre IS NULL THEN RAISE EXCEPTION 'Esa sucursal no existe.'; END IF;
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
        RAISE EXCEPTION 'En esta sucursal hay % unidades y se piden %: se encarga, no se aparta.', v_disp, v_cant * v_factor;
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
    IF r.branch_id <> p_branch_id THEN RAISE EXCEPTION 'Esa reserva es de otra sucursal.'; END IF;
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
    IF e.branch_id <> p_branch_id THEN RAISE EXCEPTION 'Ese encargo es de otra sucursal.'; END IF;
    IF e.estado NOT IN ('solicitado', 'confirmado') THEN RAISE EXCEPTION 'Ese encargo ya no está por cobrar.'; END IF;
    IF e.pago_estado <> 'pendiente' THEN RAISE EXCEPTION 'Ese encargo ya tiene un pago.'; END IF;
    -- El resto de una reserva (2026-10-22) se paga con la reserva: cobrarlo acá sería cobrar dos veces.
    IF e.reserva_id IS NOT NULL THEN
      RAISE EXCEPTION 'Ese encargo es el resto de la reserva R-%: se cobra con la reserva.', lpad(e.reserva_id::text, 6, '0');
    END IF;
    SELECT name INTO v_cliente FROM public.customers WHERE id = e.customer_id;
    IF e.estado = 'solicitado' THEN
      -- Antes de que Bodega confirme (2026-11-21): contra el precio de la
      -- viñeta, como referencia. Sin mínimo y hasta ese total; el precio final
      -- lo pone Bodega y la diferencia se arregla al confirmar o al retirar.
      IF e.product_id IS NULL THEN
        RAISE EXCEPTION 'No está en el catálogo: espera a que Bodega confirme el precio.';
      END IF;
      v_precio := (SELECT round(min(pp.vineta), 2) FROM public.product_precios pp
                    WHERE pp.product_id = e.product_id AND pp.activo
                      AND pp.factor = greatest(coalesce(e.factor, 1), 1) AND pp.vineta > 0);
      IF v_precio IS NULL THEN
        RAISE EXCEPTION 'No tiene precio en el catálogo: espera a que Bodega confirme el precio.';
      END IF;
      v_total := round(v_precio * e.cantidad, 2);
      RETURN json_build_object('tipo', 'encargo', 'total', v_total, 'minimo', 0.01, 'maximo', v_total,
        'cliente', v_cliente, 'detalle', e.producto_nombre, 'codigo', 'E-' || lpad(e.id::text, 6, '0'),
        'por_confirmar', true, 'precio', v_precio);
    END IF;
    -- Desde el 2026-11-18 admite un adelanto: lo que falte queda a cargo de
    -- quien lo cobra (`apartado_aplicar`) y se cobra al retirar.
    RETURN json_build_object('tipo', 'encargo', 'total', round(e.anticipo, 2), 'minimo', 0.01,
      'maximo', round(e.anticipo, 2), 'cliente', v_cliente, 'detalle', e.producto_nombre,
      'codigo', 'E-' || lpad(e.id::text, 6, '0'));
  END IF;
  RAISE EXCEPTION 'No se sabe qué se está apartando.';
END $function$;

-- ── 2. Aplicar: el anticipo del encargo sin confirmar queda abonado, sin cambiar de estado ──
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
    -- Un adelanto (2026-11-18) queda a cargo de quien lo cobra, como la reserva sin anticipo.
    IF round(p_monto, 2) < v_total - 0.004 AND p_employee IS NULL THEN
      RAISE EXCEPTION 'Un adelanto queda a cargo de quien lo cobra, y no se sabe quién cobra.';
    END IF;
    IF coalesce((v_cot->>'por_confirmar')::boolean, false) THEN
      -- Sin confirmar (2026-11-21): queda abonado y sigue esperando a Bodega.
      -- `anticipo` (el total) lo pone Bodega al confirmar; hasta entonces es
      -- un adelanto contra el precio de referencia.
      UPDATE public.app_encargos
         SET pago_estado = 'anticipo', abonado = round(p_monto, 2), pagado_at = now(), updated_at = now(),
             responsable_id = CASE WHEN round(p_monto, 2) < v_total - 0.004 THEN p_employee END,
             responsable_at = CASE WHEN round(p_monto, 2) < v_total - 0.004 THEN now() END
       WHERE id = v_id AND estado = 'solicitado' AND pago_estado = 'pendiente';
      IF NOT FOUND THEN RAISE EXCEPTION 'Ese encargo ya cambió: vuelve a abrirlo.'; END IF;
      UPDATE public.caja_movimientos_portal SET encargo_id = v_id, apartado_previo = jsonb_build_object('modo', 'encargo', 'por_confirmar', true)
       WHERE id = p_movimiento;
      RETURN json_build_object('tipo', 'encargo', 'id', v_id, 'codigo', 'E-' || lpad(v_id::text, 6, '0'),
        'total', v_total, 'anticipo', round(p_monto, 2), 'saldo', round(greatest(v_total - p_monto, 0), 2),
        'por_confirmar', true);
    END IF;
    UPDATE public.app_encargos
       SET pago_estado = CASE WHEN round(p_monto, 2) < v_total - 0.004 THEN 'anticipo' ELSE 'pagado' END,
           abonado = round(p_monto, 2), pagado_at = now(), estado = 'aceptado', updated_at = now(),
           responsable_id = CASE WHEN round(p_monto, 2) < v_total - 0.004 THEN p_employee END,
           responsable_at = CASE WHEN round(p_monto, 2) < v_total - 0.004 THEN now() END
     WHERE id = v_id AND estado = 'confirmado' AND pago_estado = 'pendiente';
    IF NOT FOUND THEN RAISE EXCEPTION 'Ese encargo ya está pagado.'; END IF;
    UPDATE public.caja_movimientos_portal SET encargo_id = v_id, apartado_previo = jsonb_build_object('modo', 'encargo')
     WHERE id = p_movimiento;
    RETURN json_build_object('tipo', 'encargo', 'id', v_id, 'codigo', 'E-' || lpad(v_id::text, 6, '0'),
      'total', v_total, 'anticipo', round(p_monto, 2), 'saldo', round(greatest(v_total - p_monto, 0), 2));
  END IF;
END $function$;

-- ── 3. Bodega responde un encargo que ya tiene anticipo ──
CREATE OR REPLACE FUNCTION public.encargo_responder(p_id bigint, p_accion text, p_precio numeric DEFAULT NULL::numeric, p_fecha date DEFAULT NULL::date, p_nota text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  e public.app_encargos;
  v_emp uuid := public.auth_employee_id();
  v_hoy date := (now() AT TIME ZONE 'America/El_Salvador')::date;
  v_con_pago boolean; v_total numeric; v_abonado numeric; v_efectivo boolean; v_cobro record;
  v_excedente numeric := 0; v_saldo bigint; v_metodo text; v_cod text := 'E-' || lpad(p_id::text, 6, '0');
BEGIN
  SELECT * INTO e FROM public.app_encargos WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NO_EXISTE'; END IF;
  IF NOT public.encargo_puede_manejar(e.branch_id) THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501'; END IF;
  -- Precio y fecha (o el rechazo) los decide Compras o administración, no la sala.
  IF p_accion IN ('confirmar', 'rechazar')
     AND NOT ((SELECT public.auth_employee_branch_id()) IN (SELECT id FROM public.branches WHERE type = 'BODEGA')
              OR public.auth_can_edit_any(ARRAY['ofertas_clientes'])) THEN
    RAISE EXCEPTION 'El precio de un encargo lo confirma Compras o administración.' USING ERRCODE = '42501';
  END IF;
  -- Un anticipo dejado antes de la confirmación (2026-11-21).
  v_con_pago := e.reserva_id IS NULL AND e.pago_estado = 'anticipo' AND coalesce(e.abonado, 0) > 0;
  IF v_con_pago THEN
    SELECT bool_and(m.forma_pago = 'EFECTIVO') AS efectivo,
           (array_agg(m.registrado_por ORDER BY m.id))[1] AS por,
           (array_agg(m.forma_pago ORDER BY m.id DESC))[1] AS forma
      INTO v_cobro
      FROM public.caja_movimientos_portal m
     WHERE m.encargo_id = e.id AND m.tipo_codigo = 'APARTADO' AND m.anulado_at IS NULL;
    v_efectivo := coalesce(v_cobro.efectivo, false);
    v_metodo := CASE lower(coalesce(v_cobro.forma, 'efectivo')) WHEN 'tarjeta' THEN 'tarjeta' WHEN 'transferencia' THEN 'transferencia' ELSE 'efectivo' END;
  END IF;

  IF p_accion = 'confirmar' AND e.estado = 'solicitado' THEN
    IF p_precio IS NULL OR p_precio <= 0 OR p_fecha IS NULL OR p_fecha < (now() AT TIME ZONE 'America/El_Salvador')::date THEN
      RAISE EXCEPTION 'Falta el precio o una fecha estimada válida.';
    END IF;
    IF v_con_pago THEN
      -- El cliente ya dejó dinero: el encargo queda ACEPTADO con el precio de
      -- Bodega. Si subió, falta la diferencia al retirar. Si bajó y pagó de
      -- más: en efectivo se le devuelve al retirar (queda `abonado` mayor que
      -- el total); con otra forma de pago, la diferencia pasa a saldo a favor.
      v_total := round(p_precio * e.cantidad, 2);
      v_abonado := round(e.abonado, 2);
      IF v_abonado > v_total + 0.004 AND NOT v_efectivo THEN
        v_excedente := round(v_abonado - v_total, 2);
        INSERT INTO public.app_reservas (customer_id, branch_id, origen, producto_id, producto_nombre, cantidad, factor,
            precio_unitario, precio_normal, estado, terminos_version, anticipo, pago_estado, pago_metodo, pagado_at,
            cerrada_at, cerrada_por, saldo_favor, saldo_favor_vence, saldo_favor_origen)
        VALUES (e.customer_id, e.branch_id, 'sucursal', e.product_id,
            left('Encargo ' || v_cod || ' · diferencia de precio · ' || e.producto_nombre, 200),
            1, greatest(coalesce(e.factor, 1), 1), 0, 0, 'cancelada', 'encargo', v_excedente, 'anticipo', v_metodo,
            coalesce(e.pagado_at, now()), now(), v_emp, v_excedente, v_hoy + public.saldo_favor_dias(), 'anticipo')
        RETURNING id INTO v_saldo;
        v_abonado := v_total;
        INSERT INTO public.app_cliente_avisos (customer_id, tipo, ref, titulo, cuerpo, url)
        VALUES (e.customer_id, 'reserva', 'base:encargo_diferencia:' || p_id, 'Tu encargo salió más barato',
                'Conseguimos ' || coalesce(e.producto_nombre, 'tu encargo') || ' a menos de lo que dejaste. La diferencia ($'
                  || to_char(v_excedente, 'FM999990.00') || ') queda a tu favor por ' || public.saldo_favor_dias()
                  || ' días, para otra compra en cualquier sucursal.',
                '/reservas')
        ON CONFLICT (customer_id, tipo, ref) DO NOTHING;
      END IF;
      UPDATE public.app_encargos
         SET estado = 'aceptado', precio_unitario = round(p_precio, 2), anticipo = v_total, fecha_estimada = p_fecha,
             nota_sucursal = nullif(trim(p_nota), ''), respondido_por = v_emp, respondido_at = now(), updated_at = now(),
             abonado = v_abonado,
             pago_estado = CASE WHEN v_abonado >= v_total - 0.004 THEN 'pagado' ELSE 'anticipo' END,
             -- Lo que falta queda a cargo de quien cobró el anticipo, como todo adelanto.
             responsable_id = CASE WHEN v_abonado >= v_total - 0.004 THEN NULL ELSE coalesce(responsable_id, v_cobro.por) END,
             responsable_at = CASE WHEN v_abonado >= v_total - 0.004 THEN NULL ELSE coalesce(responsable_at, now()) END
       WHERE id = p_id;
    ELSE
      UPDATE public.app_encargos SET estado = 'confirmado', precio_unitario = round(p_precio, 2),
             anticipo = round(p_precio * cantidad, 2), fecha_estimada = p_fecha, nota_sucursal = nullif(trim(p_nota), ''),
             respondido_por = v_emp, respondido_at = now(), updated_at = now() WHERE id = p_id;
    END IF;
  ELSIF p_accion = 'rechazar' AND e.estado IN ('solicitado', 'confirmado') THEN
    -- Un producto que no tenemos se rechaza con motivo escrito: es lo que se le dice al cliente.
    IF e.producto_nuevo AND coalesce(trim(p_nota), '') = '' THEN
      RAISE EXCEPTION 'Escribe el motivo: es lo que se le dice al cliente.';
    END IF;
    IF v_con_pago THEN
      -- Lo que dejó queda a su favor (2026-11-21); desde ahí se puede pedir la
      -- devolución en efectivo, como cualquier saldo a favor.
      INSERT INTO public.app_reservas (customer_id, branch_id, origen, producto_id, producto_nombre, cantidad, factor,
          precio_unitario, precio_normal, estado, terminos_version, anticipo, pago_estado, pago_metodo, pagado_at,
          cerrada_at, cerrada_por, saldo_favor, saldo_favor_vence, saldo_favor_origen)
      VALUES (e.customer_id, e.branch_id, 'sucursal', e.product_id,
          left('Encargo ' || v_cod || ' · ' || e.producto_nombre, 200),
          1, greatest(coalesce(e.factor, 1), 1), 0, 0, 'cancelada', 'encargo', round(e.abonado, 2), 'anticipo', v_metodo,
          coalesce(e.pagado_at, now()), now(), v_emp, round(e.abonado, 2), v_hoy + public.saldo_favor_dias(), 'anticipo')
      RETURNING id INTO v_saldo;
      INSERT INTO public.app_cliente_avisos (customer_id, tipo, ref, titulo, cuerpo, url)
      VALUES (e.customer_id, 'reserva', 'base:encargo_saldo:' || p_id, 'Tu encargo quedó como saldo a favor',
              'No conseguimos ' || coalesce(e.producto_nombre, 'tu encargo') || '. Lo que dejaste ($'
                || to_char(e.abonado, 'FM999990.00') || ') queda a tu favor por ' || public.saldo_favor_dias()
                || ' días, para otra compra en cualquier sucursal.',
              '/reservas')
      ON CONFLICT (customer_id, tipo, ref) DO NOTHING;
    END IF;
    UPDATE public.app_encargos SET estado = 'rechazado', nota_sucursal = coalesce(nullif(trim(p_nota), ''), 'No lo podemos conseguir por ahora.'),
           respondido_por = v_emp, respondido_at = now(), cerrado_at = now(), updated_at = now(),
           saldo_reserva_id = coalesce(v_saldo, saldo_reserva_id) WHERE id = p_id;
  ELSIF p_accion = 'pedido' AND e.estado = 'aceptado' THEN
    UPDATE public.app_encargos SET estado = 'pedido', updated_at = now() WHERE id = p_id;
  ELSIF p_accion = 'listo' AND e.estado IN ('aceptado', 'pedido') THEN
    IF e.product_id IS NULL THEN
      RAISE EXCEPTION 'Es un producto nuevo: primero vincúlalo al producto ya creado en el catálogo.';
    END IF;
    UPDATE public.app_encargos SET estado = 'listo', listo_at = now(), updated_at = now() WHERE id = p_id;
  ELSIF p_accion = 'entregado' AND e.estado = 'listo' THEN
    IF e.pago_estado = 'anticipo' THEN
      RAISE EXCEPTION 'Este encargo tiene un adelanto: usa «Retirar» para cobrar lo que falta.' USING ERRCODE = 'P0001';
    END IF;
    IF e.pago_estado = 'pagado' AND NOT EXISTS (SELECT 1 FROM public.apartado_aplicaciones a WHERE a.encargo_id = e.id) THEN
      RAISE EXCEPTION 'Este encargo está pagado: usa «Retirar» para aplicar el pago a la factura.' USING ERRCODE = 'P0001';
    END IF;
    UPDATE public.app_encargos SET estado = 'entregado', cerrado_at = now(), updated_at = now() WHERE id = p_id;
  ELSE
    RAISE EXCEPTION 'TRANSICION_INVALIDA: % → %', e.estado, p_accion;
  END IF;
  INSERT INTO public.audit_logs (user_id, action, target_id, details, branch_id, source)
  VALUES (v_emp, 'ENCARGO_' || upper(p_accion), p_id::text,
          jsonb_build_object('antes', e.estado, 'precio', p_precio, 'fecha', p_fecha, 'nota', p_nota,
                             'abonado', CASE WHEN v_con_pago THEN e.abonado END,
                             'a_favor', CASE WHEN v_saldo IS NOT NULL THEN 'R-' || lpad(v_saldo::text, 6, '0') END),
          e.branch_id, 'ADMIN_PANEL');
  RETURN json_build_object('ok', true, 'id', p_id);
END $function$;

-- ── 4. La sala se entera: el aviso también cubre el encargo que ya tenía anticipo ──
CREATE OR REPLACE FUNCTION public.app_encargos_seguir()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE r public.app_reservas; v_dest uuid[]; v_cod text := 'E-' || lpad(NEW.id::text, 6, '0'); v_cliente text;
  v_falta numeric; v_devolver numeric;
BEGIN
  IF NEW.estado IS NOT DISTINCT FROM OLD.estado THEN RETURN NULL; END IF;
  BEGIN
    IF NEW.reserva_id IS NOT NULL THEN
      SELECT * INTO r FROM public.app_reservas WHERE id = NEW.reserva_id FOR UPDATE;
      IF NOT FOUND OR r.estado <> 'pendiente' THEN RETURN NULL; END IF;
      IF NEW.estado = 'confirmado' THEN
        IF round(NEW.precio_unitario, 2) = round(r.precio_unitario, 2) THEN
          -- Mismo precio: no hay nada que preguntarle al cliente.
          UPDATE public.app_encargos SET estado = 'aceptado', updated_at = now() WHERE id = NEW.id;
          UPDATE public.app_reservas SET traslado_estado = 'bodega',
                 traslado_nota = format('Bodega lo consigue para el %s (%s).', to_char(NEW.fecha_estimada, 'DD/MM'), v_cod), updated_at = now()
           WHERE id = r.id;
          PERFORM public.reserva_avisar_sala(r.id, 'Bodega lo consigue',
            format('%s × %s llega aprox. el %s, al mismo precio. Avísale al cliente.', NEW.cantidad, NEW.producto_nombre,
                   to_char(NEW.fecha_estimada, 'DD/MM')), 'reserva_bodega_si');
        ELSE
          UPDATE public.app_reservas SET traslado_estado = 'precio',
                 traslado_nota = left(format('Bodega lo consigue a $%s c/u (reservado a $%s), para el %s. Pregúntale al cliente.',
                   to_char(NEW.precio_unitario, 'FM999990.00'), to_char(r.precio_unitario, 'FM999990.00'), to_char(NEW.fecha_estimada, 'DD/MM')), 300),
                 updated_at = now()
           WHERE id = r.id;
          PERFORM public.reserva_avisar_sala(r.id, 'Bodega lo consigue a otro precio',
            format('%s × %s: $%s c/u en vez de $%s, para el %s. Pregúntale al cliente si lo acepta.', NEW.cantidad, NEW.producto_nombre,
                   to_char(NEW.precio_unitario, 'FM999990.00'), to_char(r.precio_unitario, 'FM999990.00'), to_char(NEW.fecha_estimada, 'DD/MM')),
            'reserva_bodega_precio');
        END IF;
      ELSIF NEW.estado = 'rechazado' THEN
        UPDATE public.app_reservas SET traslado_estado = 'sin_existencia',
               traslado_nota = left('Bodega no lo consigue: ' || coalesce(NEW.nota_sucursal, 'sin motivo') || '.', 300), updated_at = now()
         WHERE id = r.id;
        PERFORM public.reserva_avisar_sala(r.id, 'Bodega no lo consigue',
          format('%s × %s: %s. Habla con el cliente: lo que llegó, una alternativa, o cancelar (lo pagado queda a su favor).',
                 NEW.cantidad, NEW.producto_nombre, coalesce(lower(NEW.nota_sucursal), 'no se consigue')), 'reserva_bodega_no');
      ELSIF NEW.estado = 'listo' THEN
        -- Llegó a la sala: cuenta como llegada y el encargo se cierra (lo cobra la reserva).
        UPDATE public.app_encargos SET estado = 'entregado', cerrado_at = now(), updated_at = now() WHERE id = NEW.id;
        PERFORM public.reserva_sumar_llegada(r.id, floor(NEW.cantidad * greatest(NEW.factor, 1)::numeric / greatest(r.factor, 1))::integer, 'Bodega');
      END IF;
      RETURN NULL;
    END IF;

    -- Encargo suelto: la sala se entera de lo que respondió Bodega. Con un
    -- anticipo ya dejado (2026-11-21) pasa directo a «aceptado» y el aviso
    -- dice qué queda: lo que falta, lo que se devuelve o que ya está pagado.
    IF OLD.estado = 'solicitado' AND NEW.estado IN ('confirmado', 'rechazado', 'aceptado') THEN
      v_dest := public.destinatarios_de_reservas(NEW.branch_id);
      IF v_dest IS NULL THEN RETURN NULL; END IF;
      SELECT initcap(split_part(name, ' ', 1)) INTO v_cliente FROM public.customers WHERE id = NEW.customer_id;
      v_falta := round(greatest(coalesce(NEW.anticipo, 0) - coalesce(NEW.abonado, 0), 0), 2);
      v_devolver := round(greatest(coalesce(NEW.abonado, 0) - coalesce(NEW.anticipo, 0), 0), 2);
      PERFORM public.notify_employees(v_dest, 'ENCARGO_APP',
        CASE NEW.estado WHEN 'rechazado' THEN 'Bodega no consigue el encargo · ' ELSE 'Bodega confirmó el encargo · ' END || v_cod,
        CASE NEW.estado
          WHEN 'confirmado' THEN format('%s × %s para %s: $%s c/u, llega aprox. el %s. Avísale al cliente; se cobra en «Por cobrar».',
                                        NEW.cantidad, NEW.producto_nombre, coalesce(v_cliente, 'el cliente'),
                                        to_char(NEW.precio_unitario, 'FM999990.00'), to_char(NEW.fecha_estimada, 'DD/MM'))
          WHEN 'aceptado' THEN format('%s × %s para %s: $%s c/u, llega aprox. el %s. Ya dejó anticipo: %s',
                                      NEW.cantidad, NEW.producto_nombre, coalesce(v_cliente, 'el cliente'),
                                      to_char(NEW.precio_unitario, 'FM999990.00'), to_char(NEW.fecha_estimada, 'DD/MM'),
                                      CASE WHEN v_falta > 0.004 THEN 'faltan $' || to_char(v_falta, 'FM999990.00') || ' al retirar.'
                                           WHEN v_devolver > 0.004 THEN 'al retirar se le devuelven $' || to_char(v_devolver, 'FM999990.00') || ' en efectivo.'
                                           ELSE 'ya está pagado.' END)
          ELSE format('%s × %s para %s: %s. Avísale al cliente%s', NEW.cantidad, NEW.producto_nombre,
                      coalesce(v_cliente, 'el cliente'), coalesce(lower(NEW.nota_sucursal), 'no se puede conseguir'),
                      CASE WHEN NEW.saldo_reserva_id IS NOT NULL AND OLD.saldo_reserva_id IS NULL
                           THEN '; lo que dejó quedó a su favor.' ELSE '.' END)
        END,
        '/', jsonb_build_object('encargo', NEW.id, 'check_key', 'encargo_resp:' || NEW.id), true, NEW.branch_id::integer);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'app_encargos_seguir: encargo % (%)', NEW.id, SQLERRM;
  END;
  RETURN NULL;
END $function$;

-- ── 5. Pasar a saldo a favor: también antes de confirmar, y con lo pagado de más ──
CREATE OR REPLACE FUNCTION public.encargo_pasar_a_saldo(p_id bigint, p_motivo text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  e public.app_encargos; v_emp uuid := public.auth_employee_id();
  v_hoy date := (now() AT TIME ZONE 'America/El_Salvador')::date;
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), ''); v_metodo text; v_id bigint;
BEGIN
  SELECT * INTO e FROM public.app_encargos WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ese encargo no existe.'; END IF;
  IF NOT public.encargo_puede_manejar(e.branch_id) THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501'; END IF;
  IF v_motivo IS NULL OR length(v_motivo) < 3 THEN RAISE EXCEPTION 'Escribe el motivo (por ejemplo, qué dijo el cliente al llamarlo).'; END IF;
  -- Un adelanto (2026-11-18): lo que pasa a favor es lo abonado, no el total.
  -- Y lo pagado de más en efectivo (2026-11-21), que se iba a devolver al retirar.
  IF e.pago_estado = 'anticipo' OR coalesce(e.abonado, 0) > coalesce(e.anticipo, 0) THEN e.anticipo := coalesce(e.abonado, 0); END IF;
  -- Antes de que Bodega confirme (2026-11-21) también: el cliente desistió.
  IF NOT (e.estado IN ('aceptado', 'pedido', 'listo') OR (e.estado = 'solicitado' AND e.pago_estado = 'anticipo'))
     OR e.pago_estado NOT IN ('pagado', 'anticipo') THEN
    RAISE EXCEPTION 'Sólo un encargo pagado y sin entregar pasa a saldo a favor.';
  END IF;
  IF e.reserva_id IS NOT NULL THEN
    RAISE EXCEPTION 'Ese encargo es el resto de la reserva R-%: se resuelve desde la reserva.', lpad(e.reserva_id::text, 6, '0');
  END IF;
  IF EXISTS (SELECT 1 FROM public.apartado_aplicaciones a WHERE a.encargo_id = e.id) THEN
    RAISE EXCEPTION 'El pago de ese encargo ya se aplicó a una factura.';
  END IF;
  IF e.product_id IS NULL THEN
    RAISE EXCEPTION 'Es un producto nuevo: primero vincúlalo al producto del catálogo.';
  END IF;
  v_metodo := CASE
    WHEN EXISTS (SELECT 1 FROM public.app_reservas_pagos pg WHERE pg.encargo_id = e.id AND pg.pagado_at IS NOT NULL) THEN 'en_linea'
    ELSE coalesce((SELECT CASE lower(m.forma_pago) WHEN 'tarjeta' THEN 'tarjeta' WHEN 'transferencia' THEN 'transferencia' ELSE 'efectivo' END
                     FROM public.caja_movimientos_portal m WHERE m.encargo_id = e.id AND m.anulado_at IS NULL ORDER BY m.id DESC LIMIT 1),
                  'efectivo') END;
  INSERT INTO public.app_reservas (customer_id, branch_id, origen, producto_id, producto_nombre, cantidad, factor,
      precio_unitario, precio_normal, estado, terminos_version, anticipo, pago_estado, pago_metodo, pagado_at,
      cerrada_at, cerrada_por, saldo_favor, saldo_favor_vence, saldo_favor_origen)
  VALUES (e.customer_id, e.branch_id, 'sucursal', e.product_id,
      left('Encargo E-' || lpad(e.id::text, 6, '0') || ' · ' || e.producto_nombre, 200),
      1, greatest(coalesce(e.factor, 1), 1), 0, 0, 'cancelada', 'encargo', e.anticipo, 'anticipo', v_metodo, coalesce(e.pagado_at, now()),
      now(), v_emp, e.anticipo, v_hoy + public.saldo_favor_dias(), 'anticipo')
  RETURNING id INTO v_id;
  UPDATE public.app_encargos
     SET estado = 'cancelado', cerrado_at = now(), saldo_reserva_id = v_id, updated_at = now(),
         nota_sucursal = left(coalesce(nota_sucursal || ' · ', '') || 'A saldo a favor: ' || v_motivo, 300)
   WHERE id = p_id;
  INSERT INTO public.app_cliente_avisos (customer_id, tipo, ref, titulo, cuerpo, url)
  VALUES (e.customer_id, 'reserva', 'base:encargo_saldo:' || p_id, 'Tu encargo quedó como saldo a favor',
          'Lo que pagaste por ' || coalesce(e.producto_nombre, 'tu encargo') || ' ($' || to_char(e.anticipo, 'FM999990.00')
            || ') queda a tu favor por ' || public.saldo_favor_dias() || ' días, para otra compra en cualquier sucursal.',
          '/reservas')
  ON CONFLICT (customer_id, tipo, ref) DO NOTHING;
  INSERT INTO public.audit_logs (user_id, action, target_id, details, branch_id, source)
  VALUES (v_emp, 'ENCARGO_A_SALDO_A_FAVOR', p_id::text,
          jsonb_build_object('monto', e.anticipo, 'reserva_saldo', v_id, 'antes', e.estado, 'motivo', v_motivo), e.branch_id, 'ADMIN_PANEL');
  RETURN json_build_object('ok', true, 'saldo', e.anticipo, 'reserva', 'R-' || lpad(v_id::text, 6, '0'));
END $function$;

-- ── 6. El proveedor no entregó: también devuelve lo pagado de más ──
CREATE OR REPLACE FUNCTION public.encargo_proveedor_no_entrego(p_id bigint, p_eleccion text, p_motivo text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  e public.app_encargos; v_emp uuid := public.auth_employee_id();
  v_hoy date := (now() AT TIME ZONE 'America/El_Salvador')::date;
  v_motivo text := 'El proveedor no entregó' || coalesce(': ' || nullif(btrim(coalesce(p_motivo, '')), ''), '');
  v_metodo text; v_id bigint; v_dev boolean := p_eleccion = 'devolucion'; v_cod text := 'E-' || lpad(p_id::text, 6, '0');
  v_dest uuid[]; v_cliente text; v_sala text;
BEGIN
  IF NOT public.reservas_v2_rige() THEN RAISE EXCEPTION 'Esta acción empieza a regir con el reglamento nuevo.'; END IF;
  IF p_eleccion NOT IN ('devolucion', 'saldo') THEN RAISE EXCEPTION 'Indica qué eligió el cliente: devolución o saldo a favor.'; END IF;
  SELECT * INTO e FROM public.app_encargos WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ese encargo no existe.'; END IF;
  IF NOT public.encargo_puede_manejar(e.branch_id) THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501'; END IF;
  -- Un adelanto (2026-11-18): se devuelve o queda a favor lo abonado, no el total.
  -- Y lo pagado de más en efectivo (2026-11-21), que se iba a devolver al retirar.
  IF e.pago_estado = 'anticipo' OR coalesce(e.abonado, 0) > coalesce(e.anticipo, 0) THEN e.anticipo := coalesce(e.abonado, 0); END IF;
  IF e.estado NOT IN ('aceptado', 'pedido') OR e.pago_estado NOT IN ('pagado', 'anticipo') THEN
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
  IF coalesce(e.product_id, e.sugerido_product_id) IS NULL THEN
    RAISE EXCEPTION 'Es un producto nuevo sin vincular: vincúlalo al catálogo antes de resolverlo.';
  END IF;
  INSERT INTO public.app_reservas (customer_id, branch_id, origen, producto_id, producto_nombre, cantidad, factor,
      precio_unitario, precio_normal, estado, terminos_version, anticipo, pago_estado, pago_metodo, pagado_at,
      cerrada_at, cerrada_por, saldo_favor, saldo_favor_vence, saldo_favor_origen,
      devolucion_pedida_at, devolucion_pedida_por, devolucion_pedida_motivo)
  VALUES (e.customer_id, e.branch_id, 'sucursal', coalesce(e.product_id, e.sugerido_product_id),
      left('Encargo ' || v_cod || ' · ' || e.producto_nombre, 200),
      1, greatest(coalesce(e.factor, 1), 1), 0, 0, 'cancelada', 'encargo', e.anticipo, 'anticipo', v_metodo, coalesce(e.pagado_at, now()),
      now(), v_emp, e.anticipo, v_hoy + public.saldo_favor_dias(), 'anticipo',
      CASE WHEN v_dev THEN now() END, CASE WHEN v_dev THEN v_emp END, CASE WHEN v_dev THEN left(v_motivo, 300) END)
  RETURNING id INTO v_id;
  IF v_dev THEN
    SELECT initcap(split_part(name, ' ', 1)) INTO v_cliente FROM public.customers WHERE id = e.customer_id;
    SELECT name INTO v_sala FROM public.branches WHERE id = e.branch_id;
    SELECT array_agg(DISTINCT em.id) INTO v_dest
      FROM public.employees em
      JOIN public.role_permissions rp ON rp.role_id IN (em.role_id, em.secondary_role_id)
       AND rp.module_key = 'dash_reservas_devolver_saldo' AND (rp.can_view OR rp.can_edit)
     WHERE em.status = 'ACTIVO';
    IF v_dest IS NOT NULL THEN
      PERFORM public.notify_employees(v_dest, 'RESERVA_APP', 'Devolución en efectivo por autorizar · R-' || lpad(v_id::text, 6, '0'),
        format('%s pide devolver $%s a %s: %s', coalesce(v_sala, 'Una sucursal'), to_char(e.anticipo, 'FM999990.00'),
               coalesce(v_cliente, 'un cliente'), left(v_motivo || ' (encargo ' || v_cod || ')', 160)),
        '/reservas', jsonb_build_object('codigo', 'R-' || lpad(v_id::text, 6, '0'), 'check_key', 'devolucion_pedida:' || v_id), true, e.branch_id::integer);
    END IF;
    INSERT INTO public.audit_logs (user_id, action, target_id, details, branch_id, source)
    VALUES (v_emp, 'SALDO_DEVOLUCION_PEDIDA', v_id::text, jsonb_build_object('monto', e.anticipo, 'motivo', v_motivo, 'encargo', p_id), e.branch_id, 'ADMIN_PANEL');
  END IF;
  UPDATE public.app_encargos
     SET estado = 'cancelado', cerrado_at = now(), saldo_reserva_id = v_id, updated_at = now(),
         nota_sucursal = left(coalesce(nota_sucursal || ' · ', '') || v_motivo
                              || CASE WHEN v_dev THEN ' · devolución completa' ELSE ' · a saldo a favor' END, 300)
   WHERE id = p_id;
  INSERT INTO public.app_cliente_avisos (customer_id, tipo, ref, titulo, cuerpo, url)
  VALUES (e.customer_id, 'reserva', 'base:encargo_no_entregado:' || p_id, 'El proveedor no entregó tu encargo ' || v_cod,
          CASE WHEN v_dev
               THEN 'Pediste la devolución de lo que pagaste ($' || to_char(e.anticipo, 'FM999990.00') || '). Te avisamos cuando esté lista para recogerla en la sucursal; mientras tanto queda a tu favor.'
               ELSE 'Lo que pagaste ($' || to_char(e.anticipo, 'FM999990.00') || ') queda a tu favor por ' || public.saldo_favor_dias()
                    || ' días, para otro producto en cualquier sucursal.' END,
          '/reservas')
  ON CONFLICT (customer_id, tipo, ref) DO NOTHING;
  INSERT INTO public.audit_logs (user_id, action, target_id, details, branch_id, source)
  VALUES (v_emp, 'ENCARGO_PROVEEDOR_NO_ENTREGO', p_id::text,
          jsonb_build_object('eleccion', p_eleccion, 'monto', e.anticipo, 'reserva_saldo', v_id, 'antes', e.estado, 'motivo', v_motivo),
          e.branch_id, 'ADMIN_PANEL');
  RETURN json_build_object('ok', true, 'eleccion', p_eleccion, 'monto', e.anticipo, 'reserva', 'R-' || lpad(v_id::text, 6, '0'), 'reserva_id', v_id);
END $function$;

-- ── 7. Retirar: cuánto se le devuelve en efectivo ──
CREATE OR REPLACE FUNCTION public.apartado_para_retirar(p_branch_id bigint, p_apartado jsonb)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_tipo text; v_id bigint; v_branch bigint; v_estado text; v_listo boolean; v_customer bigint;
  v_producto text; v_total numeric; v_pagado numeric; v_codigo text; v_prueba boolean := false;
  v_efectivo numeric := 0; v_otras numeric := 0; v_cliente text; v_aplicado json; v_devolver numeric := 0;
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
    v_pagado := CASE WHEN e.pago_estado = 'pagado' THEN v_total
                     WHEN e.pago_estado = 'anticipo' THEN least(coalesce(e.abonado, 0), v_total) ELSE 0 END;
    -- Bodega lo confirmó más barato que el anticipo en efectivo (2026-11-21):
    -- la diferencia se le devuelve al retirar. El vale del anticipo saca todo
    -- el efectivo que entró y la factura cuenta el total nuevo.
    v_devolver := CASE WHEN e.pago_estado = 'pagado' THEN round(greatest(coalesce(e.abonado, 0) - v_total, 0), 2) ELSE 0 END;
    SELECT coalesce(sum(monto) FILTER (WHERE forma_pago = 'EFECTIVO'), 0), coalesce(sum(monto) FILTER (WHERE forma_pago <> 'EFECTIVO'), 0)
      INTO v_efectivo, v_otras
      FROM public.caja_movimientos_portal WHERE encargo_id = e.id AND tipo_codigo = 'APARTADO' AND anulado_at IS NULL;
    SELECT to_json(a) INTO v_aplicado FROM public.apartado_aplicaciones a WHERE a.encargo_id = e.id;
  END IF;
  IF v_branch <> p_branch_id THEN RAISE EXCEPTION 'Eso se retira en otra sucursal.'; END IF;
  SELECT name INTO v_cliente FROM public.customers WHERE id = v_customer;
  RETURN json_build_object(
    'tipo', v_tipo, 'id', v_id, 'codigo', v_codigo, 'estado', v_estado, 'listo', v_listo, 'prueba', v_prueba,
    'customer_id', v_customer, 'cliente', v_cliente, 'producto', v_producto,
    'total', v_total, 'pagado', round(v_pagado, 2), 'saldo', round(greatest(v_total - v_pagado, 0), 2),
    'efectivo', round(v_efectivo, 2), 'otras_formas', round(v_otras, 2),
    'en_linea', round(greatest(v_pagado - v_efectivo - v_otras, 0), 2),
    'a_devolver', v_devolver,
    'aplicado', v_aplicado);
END $function$;

-- ── 8. La lista de encargos: el precio de referencia y lo que se devuelve ──
-- jsonb-agg: los `jsonb_agg` son los avisos y los pasos de UN encargo (un puñado de filas), como en la definición viva.
CREATE OR REPLACE FUNCTION public.encargos_de_sucursal(p_branch_id bigint, p_abiertos boolean DEFAULT true)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_v2 boolean := public.reservas_v2_rige();
  v_compras boolean := (SELECT public.auth_employee_branch_id()) IN (SELECT id FROM public.branches WHERE type = 'BODEGA')
                       OR public.auth_can_edit_any(ARRAY['ofertas_clientes']);
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
      'tiene_app', EXISTS (SELECT 1 FROM public.app_cliente_sesiones s
                            WHERE s.customer_id = e.customer_id AND s.revocada_at IS NULL
                              AND s.push_token IS NOT NULL AND s.acepta_avisos),
      'product_id', e.product_id, 'producto', e.producto_nombre, 'cantidad', e.cantidad, 'nota_cliente', e.nota_cliente,
      'precio_unitario', e.precio_unitario, 'anticipo', e.anticipo, 'fecha_estimada', e.fecha_estimada, 'nota_sucursal', e.nota_sucursal,
      'devolutivo', p.devolutivo,
      'vendido_antes', e.product_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.sales_invoice_items ii WHERE ii.erp_product_id = e.product_id LIMIT 1),
      'producto_nuevo', e.producto_nuevo, 'srs', e.srs, 'foto_url', e.foto_url,
      'producto_catalogo', p.nombre, 'vinculado_at', e.vinculado_at,
      'reserva_id', e.reserva_id, 'reserva', CASE WHEN e.reserva_id IS NOT NULL THEN 'R-' || lpad(e.reserva_id::text, 6, '0') END,
      'sugerido_product_id', e.sugerido_product_id, 'sugerido', ps.nombre,
      'listo_at', e.listo_at, 'prorrogado_at', e.prorrogado_at, 'prorroga', public.prorroga_de('encargo', e.id), 'aviso_sin_retirar_at', e.aviso_sin_retirar_at,
      'retirar_hasta', public.encargo_retirar_hasta(e),
      'abonado', e.abonado,
      'responsable', CASE WHEN e.responsable_id IS NOT NULL THEN (SELECT jsonb_build_object('id', er.id, 'name', er.name,
        'first_names', er.first_names, 'last_names', er.last_names, 'at', e.responsable_at) FROM public.employees er WHERE er.id = e.responsable_id) END,
      'creado', e.created_at)::jsonb
      || jsonb_build_object(
      'prorrogable', public.encargo_prorrogable(e),
      'nivel', pr.j, 'prioridad', coalesce((pr.j->>'prioridad')::boolean, false),
      'puede_cambiar_fecha', v_v2 AND v_compras AND e.estado IN ('confirmado', 'aceptado', 'pedido'),
      'puede_no_entrego', v_v2 AND e.estado IN ('aceptado', 'pedido') AND e.pago_estado IN ('pagado', 'anticipo') AND e.reserva_id IS NULL
                          AND NOT EXISTS (SELECT 1 FROM public.apartado_aplicaciones a WHERE a.encargo_id = e.id),
      'registrar_llamada', v_v2 AND e.estado IN ('confirmado', 'listo'),
      -- Sin confirmar (2026-11-21): la viñeta, con la que se cobra un anticipo antes de que Bodega responda.
      'precio_referencia', CASE WHEN e.estado = 'solicitado' AND e.product_id IS NOT NULL THEN
                              (SELECT round(min(pp.vineta), 2) FROM public.product_precios pp
                                WHERE pp.product_id = e.product_id AND pp.activo
                                  AND pp.factor = greatest(coalesce(e.factor, 1), 1) AND pp.vineta > 0) END,
      -- Pagado de más en efectivo: se devuelve al retirar.
      'a_devolver', CASE WHEN e.pago_estado = 'pagado' THEN round(greatest(coalesce(e.abonado, 0) - coalesce(e.anticipo, 0), 0), 2) ELSE 0 END,
      'avisos', CASE WHEN v_v2 THEN (SELECT jsonb_agg(jsonb_build_object('canal', l.canal, 'at', l.created_at, 'por_id', l.employee_id,
                                                        'por', em.name, 'por_nombres', em.first_names, 'por_apellidos', em.last_names, 'contesto', l.contesto, 'respuesta', l.respuesta) ORDER BY l.created_at DESC)
                                       FROM public.reserva_avisos_log l LEFT JOIN public.employees em ON em.id = l.employee_id
                                      WHERE l.encargo_id = e.id) END,
      'aviso_app', CASE WHEN v_v2 THEN (SELECT jsonb_build_object('at', a.created_at, 'leido_at', a.leido_at)
                                          FROM public.app_cliente_avisos a
                                         WHERE a.customer_id = e.customer_id AND a.tipo = 'encargo' AND a.ref = 'encargo:' || e.id || ':listo') END,
      'pasos', (SELECT jsonb_agg(jsonb_build_object('paso', x.paso, 'at', x.at, 'por_id', x.por, 'por', em.name,
                                                    'por_nombres', em.first_names, 'por_apellidos', em.last_names) ORDER BY x.orden)
                  FROM (
                    -- 1 · Se encargó: en la sala (bitácora) o, si no hay, el cliente desde la app / el resto de una reserva.
                    SELECT 1 AS orden, 'encargado' AS paso,
                           coalesce(cr.at, e.created_at) AS at, cr.por
                      FROM (SELECT NULL::int) uno
                      LEFT JOIN LATERAL (SELECT al.created_at AS at, al.user_id AS por FROM public.audit_logs al
                                          WHERE al.target_id = e.id::text AND al.action IN ('ENCARGO_EN_SUCURSAL', 'ENCARGO_NUEVO_EN_SUCURSAL')
                                          ORDER BY al.created_at LIMIT 1) cr ON true
                    UNION ALL
                    -- 2 · Compras confirmó precio y fecha.
                    SELECT 2, 'confirmado', e.respondido_at, e.respondido_por
                     WHERE e.respondido_at IS NOT NULL AND e.estado <> 'rechazado'
                    UNION ALL
                    -- 3 · Se cobró: el movimiento de caja (quién lo registró) o, sin él, el pago en línea.
                    SELECT 3, 'cobrado', coalesce(cj.at, e.pagado_at), cj.por
                      FROM (SELECT NULL::int) uno
                      LEFT JOIN LATERAL (SELECT m.registrado_at AS at, m.registrado_por AS por FROM public.caja_movimientos_portal m
                                          WHERE m.encargo_id = e.id AND m.anulado_at IS NULL
                                            AND m.tipo_codigo IS DISTINCT FROM 'APLICA_ANTICIPO'
                                          ORDER BY m.registrado_at LIMIT 1) cj ON true
                     WHERE e.pago_estado IN ('pagado', 'anticipo') AND e.reserva_id IS NULL
                    UNION ALL
                    -- 4 · Compras le hizo el pedido al proveedor.
                    SELECT 4, 'pedido', al.created_at, al.user_id
                      FROM (SELECT a2.created_at, a2.user_id FROM public.audit_logs a2
                             WHERE a2.target_id = e.id::text AND a2.action = 'ENCARGO_PEDIDO'
                             ORDER BY a2.created_at DESC LIMIT 1) al
                    UNION ALL
                    -- 5 · Llegó a la sala.
                    SELECT 5, 'llego', coalesce(ll.at, e.listo_at), ll.por
                      FROM (SELECT NULL::int) uno
                      LEFT JOIN LATERAL (SELECT al.created_at AS at, al.user_id AS por FROM public.audit_logs al
                                          WHERE al.target_id = e.id::text AND al.action = 'ENCARGO_LISTO'
                                          ORDER BY al.created_at DESC LIMIT 1) ll ON true
                     WHERE e.listo_at IS NOT NULL
                  ) x
                  LEFT JOIN public.employees em ON em.id = x.por))
      ORDER BY (e.estado = 'solicitado') DESC, (e.estado = 'aceptado') DESC,
               coalesce((pr.j->>'prioridad')::boolean, false) DESC, e.created_at DESC)
      FROM public.app_encargos e
      JOIN public.branches b ON b.id = e.branch_id
      JOIN public.customers c ON c.id = e.customer_id
      LEFT JOIN public.products p ON p.id = e.product_id
      LEFT JOIN public.products ps ON ps.id = e.sugerido_product_id AND e.product_id IS NULL
      LEFT JOIN LATERAL (SELECT CASE WHEN v_v2 AND e.estado IN ('solicitado', 'confirmado', 'aceptado', 'pedido', 'listo')
                                     THEN public.reserva_prioridad(e.customer_id) END AS j) pr ON true
     WHERE (p_branch_id IS NULL OR e.branch_id = p_branch_id)
       AND (CASE WHEN p_abiertos THEN e.estado IN ('solicitado', 'confirmado', 'aceptado', 'pedido', 'listo')
                 ELSE e.created_at > now() - interval '30 days' END)), '[]'::json);
END $function$;
