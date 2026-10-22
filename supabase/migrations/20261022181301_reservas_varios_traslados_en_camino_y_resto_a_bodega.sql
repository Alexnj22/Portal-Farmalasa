SET lock_timeout = '5s';

-- Los traslados en camino que pide un apartado: `traslados_en_camino` (lista)
-- o `traslado_request_id` (uno, la forma del 2026-10-22 de la mañana).
CREATE OR REPLACE FUNCTION public.apartado_traslados_pedidos(p_apartado jsonb)
 RETURNS uuid[]
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT coalesce(array_agg(DISTINCT v::uuid), '{}'::uuid[])
    FROM (SELECT jsonb_array_elements_text(CASE WHEN jsonb_typeof(p_apartado->'traslados_en_camino') = 'array'
                                                THEN p_apartado->'traslados_en_camino' ELSE '[]'::jsonb END) v
          UNION ALL
          SELECT nullif(p_apartado->>'traslado_request_id', '')) t
   WHERE v IS NOT NULL;
$function$;
REVOKE EXECUTE ON FUNCTION public.apartado_traslados_pedidos(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apartado_traslados_pedidos(jsonb) TO service_role;

-- Amarra una reserva recién creada a los traslados que ya venían. Con el
-- `reserva_id` en cada traslado, `reserva_seguir_traslado` suma lo que llega
-- y la pasa a lista. Si no alcanzan y se pidió, el resto se encarga a Bodega
-- con la reserva —el mismo encargo que `reserva_encargar_a_bodega`—, y su
-- precio se confirma con `reserva_precio_de_bodega`.
CREATE OR REPLACE FUNCTION public.reserva_amarrar_traslados(p_reserva bigint, p_requests uuid[], p_resto boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  r public.app_reservas; v_viene json; v_vienen numeric := 0; v_salieron numeric := 0; v_todos_salieron boolean := true;
  v_origenes text; v_primero json; v_falta integer; v_enc bigint; v_n integer := 0;
BEGIN
  SELECT * INTO r FROM public.app_reservas WHERE id = p_reserva FOR UPDATE;
  -- Bajo el candado de los traslados: dos ventanillas no pueden tomar el mismo.
  PERFORM 1 FROM public.approval_requests WHERE id = ANY (p_requests) ORDER BY id FOR UPDATE;
  FOR v_viene IN SELECT x FROM json_array_elements(public.traslados_en_camino_a_sala(r.branch_id, r.producto_id)) x
                  WHERE (x->>'id')::uuid = ANY (p_requests) LOOP
    v_n := v_n + 1;
    v_primero := coalesce(v_primero, v_viene);
    v_vienen := v_vienen + (v_viene->>'unidades')::numeric;
    IF v_viene->>'estado' = 'enviado' THEN v_salieron := v_salieron + (v_viene->>'unidades')::numeric; ELSE v_todos_salieron := false; END IF;
    v_origenes := coalesce(v_origenes || ' y ', '') || (v_viene->>'origen');
  END LOOP;
  IF v_n <> cardinality(p_requests) THEN
    RAISE EXCEPTION 'Uno de esos traslados ya no está en camino para apartar: vuelve a revisarlo.';
  END IF;
  v_falta := r.cantidad - floor(v_vienen / greatest(r.factor, 1))::integer;
  IF v_falta > 0 AND NOT p_resto THEN
    RAISE EXCEPTION 'Vienen % y se piden %: encarga el resto a Bodega o pide menos.', floor(v_vienen / greatest(r.factor, 1)), r.cantidad;
  END IF;
  IF v_falta > 20 THEN RAISE EXCEPTION 'Bodega encarga hasta 20 por pedido y faltan %.', v_falta; END IF;

  UPDATE public.app_reservas
     SET traslado_request_id = (v_primero->>'id')::uuid,
         traslado_desde = coalesce((v_primero->>'origen_branch_id')::bigint, traslado_desde),
         traslado_estado = CASE WHEN v_falta > 0 THEN 'bodega' WHEN v_todos_salieron THEN 'enviado' ELSE 'pedido' END,
         traslado_por_llegar = floor(v_salieron / greatest(r.factor, 1))::integer,
         traslado_nota = left(format('Viene de %s.', v_origenes), 300),
         updated_at = now()
   WHERE id = p_reserva;
  UPDATE public.approval_requests
     SET metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('reserva_id', p_reserva)
   WHERE id = ANY (p_requests);

  IF v_falta > 0 THEN
    INSERT INTO public.app_encargos (customer_id, branch_id, product_id, producto_nombre, factor, cantidad, nota_cliente, estado, pago_estado, reserva_id)
    VALUES (r.customer_id, r.branch_id, r.producto_id, r.producto_nombre, r.factor, v_falta,
            left('Para la reserva R-' || lpad(p_reserva::text, 6, '0')
                 || format(' (reservado a $%s c/u)', to_char(r.precio_unitario, 'FM999990.00')), 300),
            'solicitado', 'pendiente', p_reserva)
    RETURNING id INTO v_enc;
    UPDATE public.app_reservas
       SET traslado_nota = left(format('Viene de %s; encargado a Bodega: %s (E-%s).', v_origenes, v_falta, lpad(v_enc::text, 6, '0')), 300)
     WHERE id = p_reserva;
  END IF;
END $function$;
REVOKE EXECUTE ON FUNCTION public.reserva_amarrar_traslados(bigint, uuid[], boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserva_amarrar_traslados(bigint, uuid[], boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.reserva_seguir_traslado()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  m jsonb := coalesce(NEW.metadata, '{}'::jsonb);
  it jsonb; v_i integer;
  v_id bigint;
  r public.app_reservas;
  v_origen text := coalesce(nullif(m->>'origen_branch_name', ''), 'la otra sala');
  v_pedida numeric; v_enviada numeric; v_unid integer; v_motivo text;
BEGIN
  v_id := CASE WHEN m->>'reserva_id' ~ '^[0-9]{1,12}$' THEN (m->>'reserva_id')::bigint END;
  IF v_id IS NULL THEN RETURN NULL; END IF;
  -- Un fallo acá nunca puede trabar el traslado: es su consecuencia, no su condición.
  BEGIN
    SELECT * INTO r FROM public.app_reservas WHERE id = v_id FOR UPDATE;
    IF NOT FOUND OR r.origen <> 'sucursal' OR r.branch_id::text IS DISTINCT FROM (m->>'branch_id') THEN
      RETURN NULL;
    END IF;
    -- El renglón de ESE producto (2026-10-22): un traslado pedido desde
    -- Inventario y amarrado después puede traer más de un producto.
    SELECT x.it, (x.n - 1)::integer INTO it, v_i
      FROM jsonb_array_elements(coalesce(m->'items', '[]'::jsonb)) WITH ORDINALITY AS x(it, n)
     WHERE x.it->>'erp_product_id' = r.producto_id::text
     ORDER BY x.n LIMIT 1;
    IF it IS NULL THEN RETURN NULL; END IF;
    v_pedida := coalesce((it->>'cantidad')::numeric, 0);

    IF TG_OP = 'INSERT' THEN
      IF r.estado = 'pendiente' THEN
        UPDATE public.app_reservas
           SET traslado_request_id = NEW.id, traslado_estado = 'pedido',
               traslado_desde = coalesce(nullif(m->>'origen_branch_id', '')::bigint, traslado_desde),
               traslado_nota = left(format('Pedida a %s.', v_origen), 300), updated_at = now()
         WHERE id = v_id;
      END IF;
      RETURN NULL;
    END IF;

    -- Llegó: cuenta aunque ya no sea el traslado vigente — lo que llega, llegó.
    IF (NEW.metadata ? 'erp_recibido') AND NOT (coalesce(OLD.metadata, '{}'::jsonb) ? 'erp_recibido') AND NEW.status = 'APPROVED' THEN
      v_enviada := public.traslado_enviada_del_renglon(m, v_i);
      v_unid := floor(v_enviada * greatest(coalesce((it->>'factor')::numeric, 1), 1) / greatest(r.factor, 1));
      PERFORM public.reserva_sumar_llegada(v_id, v_unid, v_origen);
      RETURN NULL;
    END IF;

    -- Desde el 2026-10-22 una reserva puede esperar VARIOS traslados (los que
    -- ya venían en camino): cuenta el cambio de cualquiera que la nombre.
    IF NEW.status IS DISTINCT FROM OLD.status AND r.estado = 'pendiente' THEN
      IF NEW.status = 'APPROVED' THEN
        v_enviada := public.traslado_enviada_del_renglon(m, v_i);
        v_unid := floor(v_enviada * greatest(coalesce((it->>'factor')::numeric, 1), 1) / greatest(r.factor, 1));
        IF v_enviada <= 0 THEN
          UPDATE public.app_reservas SET traslado_estado = 'rechazado',
                 traslado_nota = left(format('%s no tenía para mandar.', v_origen), 300), updated_at = now() WHERE id = v_id;
          PERFORM public.reserva_avisar_sala(v_id, 'El traslado no sale',
            format('%s no tenía %s para mandar. Pídelo a otra sala o a Bodega, o habla con el cliente.', v_origen, r.producto_nombre), 'reserva_sin_traslado');
        ELSIF v_enviada < v_pedida THEN
          UPDATE public.app_reservas SET traslado_estado = 'parcial', traslado_por_llegar = traslado_por_llegar + v_unid,
                 traslado_nota = left(format('%s manda %s de %s.', v_origen, v_enviada, v_pedida), 300), updated_at = now() WHERE id = v_id;
          PERFORM public.reserva_avisar_sala(v_id, 'Viene sólo una parte',
            format('%s manda %s de %s × %s. Pide el resto a otra sala o a Bodega, o habla con el cliente.', v_origen, v_enviada, v_pedida, r.producto_nombre),
            'reserva_parcial');
        ELSE
          -- Con el resto encargado a Bodega, la reserva sigue esperando a Bodega.
          UPDATE public.app_reservas SET traslado_estado = CASE WHEN traslado_estado = 'bodega' THEN 'bodega' ELSE 'enviado' END,
                 traslado_por_llegar = traslado_por_llegar + v_unid,
                 traslado_nota = left(format('%s lo mandó.', v_origen), 300), updated_at = now() WHERE id = v_id;
        END IF;
      ELSIF NEW.status IN ('REJECTED', 'CANCELLED') THEN
        v_motivo := nullif(btrim(coalesce(m->>'rejection_reason', NEW.approver_note, '')), '');
        UPDATE public.app_reservas SET traslado_estado = 'rechazado',
               traslado_nota = left(format('%s no lo manda%s.', v_origen, coalesce(': ' || lower(v_motivo), '')), 300), updated_at = now()
         WHERE id = v_id;
        PERFORM public.reserva_avisar_sala(v_id, 'El traslado no sale',
          format('%s no manda %s%s. Pídelo a otra sala o a Bodega, o habla con el cliente.', v_origen, r.producto_nombre,
                 coalesce(' (' || lower(v_motivo) || ')', '')), 'reserva_sin_traslado');
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'reserva_seguir_traslado: solicitud % reserva % (%)', NEW.id, v_id, SQLERRM;
  END;
  RETURN NULL;
END $function$;

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
BEGIN
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
BEGIN
  IF p_monto < (v_cot->>'minimo')::numeric - 0.004 OR p_monto > (v_cot->>'maximo')::numeric + 0.004 THEN
    RAISE EXCEPTION 'El cobro va de % a %.', to_char((v_cot->>'minimo')::numeric, 'FM$999,990.00'),
      to_char((v_cot->>'maximo')::numeric, 'FM$999,990.00');
  END IF;

  IF v_modo = 'nueva' THEN
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

  IF v_modo = 'nueva' THEN
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

DROP FUNCTION public.reserva_amarrar_traslado(bigint, uuid);
