SET lock_timeout = '5s';

-- Lo que ya viene en camino a una sala, de un producto, y nadie apartó todavía.
-- Unidades base: lo despachado si ya salió, lo pedido si todavía no.
CREATE OR REPLACE FUNCTION public.traslados_en_camino_a_sala(p_branch_id bigint, p_producto_id bigint)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  -- plpgsql y no sql: con `SET` una sql nace con plan genérico (CLAUDE.md, trampa 4).
  RETURN (SELECT coalesce(json_agg(json_build_object(
           'id', t.id, 'origen', t.origen, 'origen_branch_id', t.origen_branch_id,
           'unidades', t.unidades, 'estado', t.estado, 'pedido_at', t.created_at) ORDER BY t.created_at), '[]'::json)
    FROM (
      SELECT ar.id, ar.created_at,
             coalesce(nullif(ar.metadata->>'origen_branch_name', ''), 'otra sala') AS origen,
             nullif(ar.metadata->>'origen_branch_id', '')::bigint AS origen_branch_id,
             CASE WHEN ar.status = 'APPROVED' AND ar.metadata ? 'erp_traslado' THEN 'enviado' ELSE 'pedido' END AS estado,
             floor(CASE WHEN ar.status = 'APPROVED' AND ar.metadata ? 'erp_traslado'
                        THEN public.traslado_enviada_del_renglon(ar.metadata, x.n::integer - 1)
                        ELSE coalesce((x.it->>'cantidad')::numeric, 0) END
                   * greatest(coalesce((x.it->>'factor')::numeric, 1), 1)) AS unidades
        FROM public.approval_requests ar
        CROSS JOIN LATERAL (
          SELECT it, n FROM jsonb_array_elements(coalesce(ar.metadata->'items', '[]'::jsonb)) WITH ORDINALITY AS e(it, n)
           WHERE it->>'erp_product_id' = p_producto_id::text ORDER BY n LIMIT 1) x
       WHERE ar.type = 'INVENTORY_TRANSFER_REQUEST'
         AND ar.status IN ('PENDING', 'APPROVED')
         AND ar.metadata->>'branch_id' = p_branch_id::text
         AND NOT (ar.metadata ? 'erp_recibido')
         AND ar.created_at > now() - interval '30 days'
         -- Tomado por una reserva abierta: no se ofrece dos veces.
         AND NOT EXISTS (SELECT 1 FROM public.app_reservas r
                          WHERE r.id::text = ar.metadata->>'reserva_id' AND r.estado IN ('en_revision', 'pendiente', 'lista'))
    ) t
   WHERE t.unidades > 0);
END $function$;
REVOKE EXECUTE ON FUNCTION public.traslados_en_camino_a_sala(bigint, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.traslados_en_camino_a_sala(bigint, bigint) TO service_role;

-- Amarra una reserva recién creada a un traslado que ya venía. Con el
-- `reserva_id` en el traslado, `reserva_seguir_traslado` la pasa a lista
-- cuando llega, igual que si se hubiera pedido desde el diálogo.
CREATE OR REPLACE FUNCTION public.reserva_amarrar_traslado(p_reserva bigint, p_request uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  r public.app_reservas; ar public.approval_requests; v_viene json; v_enviado boolean; v_unid integer;
BEGIN
  SELECT * INTO r FROM public.app_reservas WHERE id = p_reserva;
  -- Bajo el candado del traslado: dos ventanillas no pueden tomar el mismo.
  SELECT * INTO ar FROM public.approval_requests WHERE id = p_request FOR UPDATE;
  SELECT x INTO v_viene FROM json_array_elements(public.traslados_en_camino_a_sala(r.branch_id, r.producto_id)) x
   WHERE x->>'id' = p_request::text;
  IF v_viene IS NULL OR (v_viene->>'unidades')::numeric < r.cantidad * r.factor THEN
    RAISE EXCEPTION 'Ese traslado ya no está en camino para apartar: vuelve a revisarlo.';
  END IF;
  v_enviado := v_viene->>'estado' = 'enviado';
  v_unid := floor((v_viene->>'unidades')::numeric / greatest(r.factor, 1));
  UPDATE public.app_reservas
     SET traslado_request_id = p_request, traslado_desde = coalesce((v_viene->>'origen_branch_id')::bigint, traslado_desde),
         traslado_estado = CASE WHEN v_enviado THEN 'enviado' ELSE 'pedido' END,
         traslado_por_llegar = CASE WHEN v_enviado THEN v_unid ELSE 0 END,
         traslado_nota = left(format(CASE WHEN v_enviado THEN '%s lo mandó.' ELSE 'Pedida a %s.' END, v_viene->>'origen'), 300),
         updated_at = now()
   WHERE id = p_reserva;
  UPDATE public.approval_requests
     SET metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('reserva_id', p_reserva)
   WHERE id = p_request;
END $function$;
REVOKE EXECUTE ON FUNCTION public.reserva_amarrar_traslado(bigint, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserva_amarrar_traslado(bigint, uuid) TO service_role;

-- Varios productos en un mismo encargo: un renglón por producto, todos o ninguno.
CREATE OR REPLACE FUNCTION public.encargos_en_sucursal_crear(p_branch_id bigint, p_customer_id bigint, p_lineas jsonb, p_nota text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE l jsonb; v_out jsonb := '[]'::jsonb; v json;
BEGIN
  IF jsonb_typeof(p_lineas) IS DISTINCT FROM 'array' OR jsonb_array_length(p_lineas) < 1 THEN RAISE EXCEPTION 'Elige el producto.'; END IF;
  IF jsonb_array_length(p_lineas) > 10 THEN RAISE EXCEPTION 'Un encargo lleva hasta 10 productos.'; END IF;
  FOR l IN SELECT * FROM jsonb_array_elements(p_lineas) LOOP
    -- Misma función que un encargo suelto: el permiso y la sala se miran ahí.
    v := public.encargo_en_sucursal_crear(p_branch_id, p_customer_id, (l->>'producto_id')::bigint, l->>'producto_nombre',
           (l->>'factor')::integer, (l->>'cantidad')::integer, p_nota);
    v_out := v_out || jsonb_build_array(v::jsonb || jsonb_build_object('producto_nombre', l->>'producto_nombre', 'cantidad', (l->>'cantidad')::integer));
  END LOOP;
  RETURN v_out::json;
END $function$;
REVOKE EXECUTE ON FUNCTION public.encargos_en_sucursal_crear(bigint, bigint, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.encargos_en_sucursal_crear(bigint, bigint, jsonb, text) TO authenticated, service_role;

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

    IF NEW.status IS DISTINCT FROM OLD.status AND NEW.id = r.traslado_request_id AND r.estado = 'pendiente' THEN
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
          UPDATE public.app_reservas SET traslado_estado = 'enviado', traslado_por_llegar = traslado_por_llegar + v_unid,
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

CREATE OR REPLACE FUNCTION public.apartado_opciones(p_branch_id bigint, p_producto_id bigint, p_factor integer, p_cantidad integer)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_disp numeric := 0;
  v_insumo boolean;
  v_necesita numeric := greatest(coalesce(p_cantidad, 1), 1) * greatest(coalesce(p_factor, 1), 1);
BEGIN
  IF NOT (p_branch_id = (SELECT public.auth_employee_branch_id()) OR public.auth_can_edit_any(ARRAY['ofertas_clientes'])) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  SELECT coalesce(max((e->>'disponibles')::numeric), 0) INTO v_disp
    FROM json_array_elements(public.app_existencias_netas(ARRAY[p_producto_id::int])) e
   WHERE (e->>'branch_id')::bigint = p_branch_id;
  v_insumo := EXISTS (SELECT 1 FROM public.producto_insumo WHERE product_id = p_producto_id);
  RETURN json_build_object(
    'disponibles', v_disp, 'necesita', v_necesita, 'insumo', v_insumo,
    -- Reglamento v2: lo que hay se aparta (insumo o no); sólo se encarga si no hay.
    'en_camino', public.traslados_en_camino_a_sala(p_branch_id, p_producto_id),
    'modo', CASE WHEN v_disp >= v_necesita THEN 'reserva' ELSE 'encargo' END,
    -- Muy baja rotación: el apartado pide el 100 % en vez del 50 %.
    'baja_rotacion', public.producto_baja_rotacion(p_producto_id, p_branch_id),
    'precios', (SELECT coalesce(json_agg(DISTINCT round(pp.vineta, 2)), '[]'::json) FROM public.product_precios pp
                 WHERE pp.product_id = p_producto_id AND pp.activo AND pp.factor = greatest(coalesce(p_factor, 1), 1) AND pp.vineta > 0));
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
  v_req uuid := nullif(p_apartado->>'traslado_request_id', '')::uuid; v_viene json;
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
    IF v_req IS NOT NULL THEN
      -- Ya viene en camino (2026-10-22): lo que manda es ese traslado, que
      -- tiene que ser a esta sala, de este producto, seguir abierto, no estar
      -- tomado por otra reserva y alcanzar. La existencia de origen ya salió.
      SELECT x INTO v_viene
        FROM json_array_elements(public.traslados_en_camino_a_sala(p_branch_id, (p_apartado->>'producto_id')::bigint)) x
       WHERE x->>'id' = v_req::text;
      IF v_viene IS NULL THEN RAISE EXCEPTION 'Ese traslado ya no está en camino para apartar: vuelve a revisarlo.'; END IF;
      IF (v_viene->>'unidades')::numeric < v_cant * v_factor THEN
        RAISE EXCEPTION 'De % vienen % unidades y se piden %.', v_viene->>'origen', v_viene->>'unidades', v_cant * v_factor;
      END IF;
      v_desde_nombre := v_viene->>'origen';
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
  v_req uuid := nullif(p_apartado->>'traslado_request_id', '')::uuid;
  v_desde bigint := coalesce(
    (SELECT nullif(ar.metadata->>'origen_branch_id', '')::bigint FROM public.approval_requests ar WHERE ar.id = v_req),
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
    IF v_req IS NOT NULL THEN PERFORM public.reserva_amarrar_traslado(v_id, v_req); END IF;
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
  v_req uuid := nullif(p_apartado->>'traslado_request_id', '')::uuid;
  v_desde bigint := coalesce(
    (SELECT nullif(ar.metadata->>'origen_branch_id', '')::bigint FROM public.approval_requests ar WHERE ar.id = v_req),
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
    IF v_req IS NOT NULL THEN PERFORM public.reserva_amarrar_traslado(v_reserva, v_req); END IF;
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
