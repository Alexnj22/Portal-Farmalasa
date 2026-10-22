-- Apartar lo que hay en OTRA sala (2026-10-21, pedido del usuario).
--
-- «Si no hay existencias en la sucursal, sugiere solicitarlo de un solo, dice
-- dónde hay, y al confirmar se le imprime la reserva.» Hasta hoy, sin
-- existencia en la sala el portal sólo ofrecía ENCARGAR (Compras confirma el
-- precio), aunque el producto estuviera en la sala de al lado.
--
-- Ahora la reserva puede nacer «en camino»: `traslado_desde` dice de qué sala
-- viene, se cobra el anticipo igual (precio del catálogo, mínimo 50 %) y queda
-- PENDIENTE —sin plazo— hasta que el traslado llega y la sala la marca lista;
-- ahí empieza a correr el plazo (`reserva_cambiar_estado`). La pantalla manda
-- la solicitud de traslado en el mismo acto. Una reserva de sucursal pendiente
-- no la vence `reservas_vencer` (sólo vence las de la app), así que esperar el
-- traslado no la cae.
SET lock_timeout = '5s';

ALTER TABLE public.app_reservas
  ADD COLUMN IF NOT EXISTS traslado_desde bigint REFERENCES public.branches(id);
CREATE INDEX IF NOT EXISTS app_reservas_traslado_desde ON public.app_reservas (traslado_desde) WHERE traslado_desde IS NOT NULL;

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
    IF EXISTS (SELECT 1 FROM public.producto_insumo WHERE product_id = (p_apartado->>'producto_id')::bigint) THEN
      RAISE EXCEPTION 'Es un insumo: se encarga, no se aparta.';
    END IF;
    IF v_desde IS NOT NULL THEN
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
    RETURN json_build_object('tipo', 'reserva', 'total', v_total, 'minimo', round(v_total * 0.5, 2), 'maximo', v_total,
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
  v_desde bigint := nullif(p_apartado->>'traslado_desde', '')::bigint;
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
