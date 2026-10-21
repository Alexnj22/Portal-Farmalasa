-- Reservas: plazos en un sitio, total único, deshacer sin borrar reservas de
-- la app, saldo a favor que no vuelve si ya se aplicó, y pruebas sin saldo
-- (auditoría 2026-10-21, puntos 2–8). Todo parte de la definición VIVA.
SET lock_timeout = '5s';

-- ── Lo que había antes de que un cobro de caja tocara la reserva ───────────
-- {modo:'nueva'} si el cobro la creó; {modo:'reserva', anticipo, pago_estado,
-- pago_metodo, pagado_at} si abonó a una que ya existía. `apartado_deshacer`
-- lo usa para borrar SÓLO la que nació de ese cobro y devolver el resto a
-- como estaba.
ALTER TABLE public.caja_movimientos_portal ADD COLUMN IF NOT EXISTS apartado_previo jsonb;
COMMENT ON COLUMN public.caja_movimientos_portal.apartado_previo IS
  'Anticipo (APARTADO): qué hizo este cobro con la reserva —{modo:nueva}, o {modo:reserva} con el anticipo y el estado de pago previos— para que deshacerlo no borre ni deje mal una reserva ajena.';

-- ── Los plazos fijos, en UN sitio ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.reserva_plazos(
  OUT dias_pagada integer, OUT dias_apartado integer, OUT horas_sin_foto integer,
  OUT horas_receta_sin_revisar integer, OUT horas_para_preparar integer, OUT dias_saldo_favor integer)
 RETURNS record
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  -- Pagada en línea o apartada en caja: 7 días para retirarla. App sin la
  -- foto de la receta (u «otra foto»): 24 h. Foto sin revisar: 48 h. Sin
  -- preparar: 48 h. Saldo a favor: `saldo_favor_dias()`.
  SELECT 7, 7, 24, 48, 48, public.saldo_favor_dias();
$function$;
REVOKE EXECUTE ON FUNCTION public.reserva_plazos() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reserva_plazos() TO authenticated, service_role;

-- Hasta cuándo vale el estado ACTUAL de una reserva (lo que `reservas_vencer`
-- mira). Es lo que la pantalla muestra, en vez de textos fijos. «lista» vence
-- al terminar el día de `vence_at` en El Salvador.
CREATE OR REPLACE FUNCTION public.reserva_plazo_hasta(r public.app_reservas)
 RETURNS timestamptz
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT CASE
    WHEN r.estado = 'en_revision' AND coalesce(r.receta_estado, 'otra_foto') = 'otra_foto'
      THEN greatest(r.created_at, coalesce(r.receta_revisada_at, r.created_at)) + make_interval(hours => p.horas_sin_foto)
    WHEN r.estado = 'en_revision' AND r.receta_estado = 'pendiente'
      THEN r.receta_subida_at + make_interval(hours => p.horas_receta_sin_revisar)
    WHEN r.estado = 'pendiente' AND r.origen = 'app'
      THEN coalesce(r.pendiente_at, r.created_at) + make_interval(hours => p.horas_para_preparar)
    WHEN r.estado = 'lista' THEN r.vence_at
  END
  FROM public.reserva_plazos() p;
$function$;
REVOKE EXECUTE ON FUNCTION public.reserva_plazo_hasta(public.app_reservas) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reserva_plazo_hasta(public.app_reservas) TO authenticated, service_role;

-- Cuántas horas queda lista al prepararla: pagada, los días de pagada; si no,
-- las del nivel del cliente (`puntos_horas_reserva`, la única regla).
CREATE OR REPLACE FUNCTION public.reserva_horas_al_preparar(r public.app_reservas)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT CASE WHEN r.pago_estado = 'pagado' THEN (SELECT p.dias_pagada * 24 FROM public.reserva_plazos() p)
              ELSE public.puntos_horas_reserva(r.customer_id) END;
$function$;
REVOKE EXECUTE ON FUNCTION public.reserva_horas_al_preparar(public.app_reservas) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reserva_horas_al_preparar(public.app_reservas) TO authenticated, service_role;

-- ── Quién maneja las reservas de una sala ─────────────────────────────────
-- También la sala donde el empleado trabaja HOY según su horario publicado
-- (`empleado_sala_de_hoy`, el canónico), no sólo la de su ficha.
CREATE OR REPLACE FUNCTION public.reserva_puede_manejar(p_branch_id bigint)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT p_branch_id = public.auth_employee_branch_id()
      OR p_branch_id = public.empleado_sala_de_hoy(NULL, (now() AT TIME ZONE 'America/El_Salvador')::date)
      OR public.auth_can_edit_any(ARRAY['ofertas_clientes']);
$function$;

-- ── apartado_cotizar: el total sale de `reserva_cuenta`; sólo reservas de sala ──
CREATE OR REPLACE FUNCTION public.apartado_cotizar(p_branch_id bigint, p_apartado jsonb)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_modo text := p_apartado->>'modo';
  v_cant integer; v_factor integer; v_precio numeric; v_total numeric; v_disp numeric;
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
    SELECT coalesce(max((x->>'disponibles')::numeric), 0) INTO v_disp
      FROM json_array_elements(public.app_existencias_netas(ARRAY[(p_apartado->>'producto_id')::int])) x
     WHERE (x->>'branch_id')::bigint = p_branch_id;
    IF v_disp < v_cant * v_factor THEN
      RAISE EXCEPTION 'En esta sala hay % unidades y se piden %: se encarga, no se aparta.', v_disp, v_cant * v_factor;
    END IF;
    v_total := round(v_precio * v_cant, 2);
    RETURN json_build_object('tipo', 'reserva', 'total', v_total, 'minimo', round(v_total * 0.5, 2), 'maximo', v_total,
      'cliente', v_cliente, 'detalle', (p_apartado->>'producto_nombre'));

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

-- ── apartado_aplicar: anota qué hizo el cobro; vuelve a mirar bajo candado ──
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
  v_id bigint; v_total numeric := (v_cot->>'total')::numeric; v_anticipo numeric; v_vence timestamptz;
  r public.app_reservas; k record;
BEGIN
  IF p_monto < (v_cot->>'minimo')::numeric - 0.004 OR p_monto > (v_cot->>'maximo')::numeric + 0.004 THEN
    RAISE EXCEPTION 'El cobro va de % a %.', to_char((v_cot->>'minimo')::numeric, 'FM$999,990.00'),
      to_char((v_cot->>'maximo')::numeric, 'FM$999,990.00');
  END IF;

  IF v_modo = 'nueva' THEN
    INSERT INTO public.app_reservas (customer_id, branch_id, origen, producto_id, producto_nombre, cantidad, factor,
        precio_unitario, precio_normal, estado, terminos_version, anticipo, lista_at, vence_at, preparada_por,
        pago_estado, pago_metodo, pagado_at)
    VALUES ((p_apartado->>'customer_id')::bigint, p_branch_id, 'sucursal', (p_apartado->>'producto_id')::bigint,
        left(btrim(p_apartado->>'producto_nombre'), 200), (p_apartado->>'cantidad')::integer,
        greatest(coalesce((p_apartado->>'factor')::integer, 1), 1),
        round((p_apartado->>'precio')::numeric, 2), round((p_apartado->>'precio')::numeric, 2), 'lista', 'sucursal-v2',
        round(p_monto, 2), now(), now() + make_interval(days => (SELECT p.dias_apartado FROM public.reserva_plazos() p)), p_employee,
        CASE WHEN round(p_monto, 2) >= v_total - 0.004 THEN 'pagado' ELSE 'anticipo' END, v_metodo, now())
    RETURNING id, anticipo, vence_at INTO v_id, v_anticipo, v_vence;
    UPDATE public.caja_movimientos_portal SET reserva_id = v_id, apartado_previo = jsonb_build_object('modo', 'nueva')
     WHERE id = p_movimiento;
    RETURN json_build_object('tipo', 'reserva', 'id', v_id, 'codigo', 'R-' || lpad(v_id::text, 6, '0'),
      'total', v_total, 'anticipo', v_anticipo, 'saldo', round(v_total - v_anticipo, 2), 'vence_at', v_vence);

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

-- ── apartado_deshacer: borra sólo la reserva de sala que nació de ESE cobro ──
CREATE OR REPLACE FUNCTION public.apartado_deshacer(p_movimiento bigint, p_anular boolean DEFAULT true)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  m public.caja_movimientos_portal%ROWTYPE; r public.app_reservas; k record;
  v_prev jsonb; v_nuevo numeric; v_en_linea boolean;
BEGIN
  SELECT * INTO m FROM public.caja_movimientos_portal WHERE id = p_movimiento FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  IF m.tipo_codigo IS DISTINCT FROM 'APARTADO' THEN RETURN; END IF;
  v_prev := m.apartado_previo;
  IF m.reserva_id IS NOT NULL THEN
    SELECT * INTO r FROM public.app_reservas WHERE id = m.reserva_id FOR UPDATE;
    IF FOUND THEN
      -- Se borra sólo si: es de sala, la creó ESTE cobro (anotado; en los
      -- cobros viejos sin anotar, la reserva nació después del movimiento),
      -- no hay otro cobro vivo sobre ella, sigue abierta y su anticipo no se
      -- aplicó a ninguna factura. Una reserva de la app NUNCA se borra.
      IF r.origen = 'sucursal' AND r.estado IN ('pendiente', 'lista')
         AND (v_prev->>'modo' = 'nueva' OR (v_prev IS NULL AND r.created_at >= m.created_at))
         AND NOT EXISTS (SELECT 1 FROM public.caja_movimientos_portal x
                          WHERE x.reserva_id = r.id AND x.id <> m.id AND x.anulado_at IS NULL AND x.tipo_codigo = 'APARTADO')
         AND NOT EXISTS (SELECT 1 FROM public.apartado_aplicaciones a WHERE a.reserva_id = r.id) THEN
        UPDATE public.caja_movimientos_portal SET reserva_id = NULL WHERE id = m.id;
        DELETE FROM public.app_reservas WHERE id = r.id;     -- nació de este cobro
      ELSE
        -- Si no, se le resta lo de este cobro y el estado de pago se recalcula:
        -- con anticipo 0 no puede quedar 'anticipo'; vuelve al de antes.
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

-- ── apartado_cambiar_monto: con candado y el total de `reserva_cuenta` ──────
CREATE OR REPLACE FUNCTION public.apartado_cambiar_monto(p_movimiento bigint, p_antes numeric, p_nuevo numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE m public.caja_movimientos_portal%ROWTYPE; r public.app_reservas; k record; v_nuevo numeric;
BEGIN
  SELECT * INTO m FROM public.caja_movimientos_portal WHERE id = p_movimiento FOR UPDATE;
  IF NOT FOUND OR m.reserva_id IS NULL OR m.tipo_codigo IS DISTINCT FROM 'APARTADO' THEN RETURN; END IF;
  SELECT * INTO r FROM public.app_reservas WHERE id = m.reserva_id FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT * INTO k FROM public.reserva_cuenta(r.id);
  -- La caja ya se corrigió: acá no se frena, sólo se acompaña.
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

-- ── apartado_para_retirar: total y pagado de `reserva_cuenta` ──────────────
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

CREATE OR REPLACE FUNCTION public.apartado_entregar(p_branch_id bigint, p_apartado jsonb)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v json := public.apartado_para_retirar(p_branch_id, p_apartado);
BEGIN
  IF NOT public.reserva_puede_manejar(p_branch_id) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF (v->>'pagado')::numeric > 0.004 AND (v->>'aplicado') IS NULL AND NOT (v->>'prueba')::boolean THEN
    RAISE EXCEPTION 'Primero se aplica el anticipo a la factura: usa «Retirar».';
  END IF;
  PERFORM public.apartado_marcar_entregado(p_apartado, public.auth_employee_id());
  RETURN json_build_object('ok', true);
END $function$;

-- ── reserva_cambiar_estado ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.reserva_cambiar_estado(p_id bigint, p_estado text, p_motivo text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  r public.app_reservas;
  v_emp uuid := public.auth_employee_id();
  v_horas integer;
  v_saldo numeric;
  v_hoy date := (now() AT TIME ZONE 'America/El_Salvador')::date;
BEGIN
  SELECT * INTO r FROM public.app_reservas WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NO_EXISTE'; END IF;
  IF NOT public.reserva_puede_manejar(r.branch_id) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF p_estado IN ('lista', 'retirada') AND r.origen = 'app' AND r.bajo_receta AND r.receta_estado IS DISTINCT FROM 'aprobada' THEN
    RAISE EXCEPTION 'La receta de esta reserva todavía no está aprobada.' USING ERRCODE = 'P0001';
  END IF;
  IF p_estado = 'lista' AND r.estado = 'pendiente' THEN
    -- El plazo: la única regla (`reserva_horas_al_preparar` → `puntos_horas_reserva`).
    v_horas := public.reserva_horas_al_preparar(r);
    UPDATE public.app_reservas SET estado = 'lista', lista_at = now(), vence_at = now() + make_interval(hours => v_horas),
           preparada_por = v_emp, updated_at = now() WHERE id = p_id;
  ELSIF p_estado = 'retirada' AND r.estado = 'lista' THEN
    -- Con anticipo, el retiro lo hace `apartado_entregar` / «Retirar» (2026-10-20).
    IF NOT coalesce(r.pago_prueba, false)
       AND greatest(coalesce(r.anticipo, 0), CASE WHEN r.pago_estado = 'pagado' THEN 1 ELSE 0 END) > 0
       AND NOT EXISTS (SELECT 1 FROM public.apartado_aplicaciones a WHERE a.reserva_id = r.id) THEN
      RAISE EXCEPTION 'Esta reserva tiene un pago: usa «Retirar» para aplicarlo a la factura.' USING ERRCODE = 'P0001';
    END IF;
    UPDATE public.app_reservas SET estado = 'retirada', cerrada_at = now(), cerrada_por = v_emp, updated_at = now(),
           pago_estado = CASE WHEN pago_estado IN ('pendiente', 'anticipo') THEN 'pagado' ELSE pago_estado END,
           pagado_at = coalesce(pagado_at, now())
     WHERE id = p_id;
  ELSIF p_estado = 'cancelada' AND r.estado IN ('en_revision', 'pendiente', 'lista') THEN
    -- Un anticipo ya aplicado a una factura es dinero de esa venta: no se
    -- cancela ni vuelve como saldo a favor.
    IF EXISTS (SELECT 1 FROM public.apartado_aplicaciones a WHERE a.reserva_id = r.id) THEN
      RAISE EXCEPTION 'El anticipo de esta reserva ya se aplicó a una factura: no se puede cancelar.' USING ERRCODE = 'P0001';
    END IF;
    UPDATE public.app_reservas SET estado = 'cancelada', cerrada_at = now(), cerrada_por = v_emp, updated_at = now(),
           -- El anticipo de caja queda a favor, igual que al vencer. Uno de
           -- PRUEBA no es dinero: no deja saldo.
           saldo_favor = CASE WHEN anticipo > 0 AND pago_metodo <> 'en_linea' AND saldo_favor IS NULL AND NOT coalesce(pago_prueba, false) THEN anticipo ELSE saldo_favor END,
           saldo_favor_vence = CASE WHEN anticipo > 0 AND pago_metodo <> 'en_linea' AND saldo_favor IS NULL AND NOT coalesce(pago_prueba, false)
                                    THEN v_hoy + public.saldo_favor_dias() ELSE saldo_favor_vence END,
           saldo_favor_origen = CASE WHEN anticipo > 0 AND pago_metodo <> 'en_linea' AND saldo_favor IS NULL AND NOT coalesce(pago_prueba, false) THEN 'anticipo' ELSE saldo_favor_origen END
     WHERE id = p_id
    RETURNING saldo_favor INTO v_saldo;
    IF r.origen = 'app' THEN
      INSERT INTO public.app_cliente_avisos (customer_id, tipo, ref, titulo, cuerpo, url)
      VALUES (r.customer_id, 'reserva', 'base:cancelada:' || r.id,
              'La sucursal canceló tu reserva',
              r.producto_nombre || coalesce(' · ' || nullif(btrim(p_motivo), ''), '')
                || CASE WHEN coalesce(v_saldo, 0) > 0 THEN '. Lo que pagaste quedó a tu favor para otra compra en cualquier sucursal.' ELSE '.' END,
              '/reservas')
      ON CONFLICT (customer_id, tipo, ref) DO NOTHING;
    END IF;
  ELSE
    RAISE EXCEPTION 'TRANSICION_INVALIDA: % → %', r.estado, p_estado;
  END IF;
  INSERT INTO public.audit_logs (user_id, action, target_id, details, branch_id, source)
  VALUES (public.auth_employee_id(), 'RESERVA_' || upper(p_estado), p_id::text,
          jsonb_build_object('antes', r.estado, 'motivo', p_motivo, 'saldo_favor', v_saldo), r.branch_id, 'ADMIN_PANEL');
  RETURN json_build_object('ok', true, 'id', p_id, 'estado', p_estado, 'saldo_favor', v_saldo);
END;
$function$;

-- ── reservas_vencer: plazos de `reserva_plazo_hasta`; sin saldo de prueba ni
-- de lo ya aplicado (y lo aplicado no vence: está en su factura) ────────────
CREATE OR REPLACE FUNCTION public.reservas_vencer()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_hoy date := (now() AT TIME ZONE 'America/El_Salvador')::date;
  v_ids bigint[];
BEGIN
  WITH v AS (
    UPDATE public.app_reservas r
       SET estado = 'vencida', cerrada_at = now(), updated_at = now(),
           vencida_motivo = CASE
             WHEN r.estado = 'en_revision' AND r.receta_estado = 'pendiente' THEN 'receta_sin_revisar'
             WHEN r.estado = 'en_revision' THEN 'sin_receta'
             WHEN r.estado = 'lista' THEN 'sin_retirar'
             WHEN r.origen = 'app' AND public.reserva_plazo_hasta(r) < now() THEN 'sin_preparar'
             ELSE 'oferta_terminada' END,
           saldo_favor = CASE WHEN r.anticipo > 0 AND r.pago_metodo <> 'en_linea' AND r.saldo_favor IS NULL AND NOT coalesce(r.pago_prueba, false) THEN r.anticipo ELSE r.saldo_favor END,
           saldo_favor_vence = CASE WHEN r.anticipo > 0 AND r.pago_metodo <> 'en_linea' AND r.saldo_favor IS NULL AND NOT coalesce(r.pago_prueba, false) THEN v_hoy + public.saldo_favor_dias() ELSE r.saldo_favor_vence END,
           saldo_favor_origen = CASE WHEN r.anticipo > 0 AND r.pago_metodo <> 'en_linea' AND r.saldo_favor IS NULL AND NOT coalesce(r.pago_prueba, false) THEN 'anticipo' ELSE r.saldo_favor_origen END
     WHERE ((r.estado = 'en_revision' AND public.reserva_plazo_hasta(r) < now())
            OR (r.estado = 'pendiente' AND r.origen = 'app' AND public.reserva_plazo_hasta(r) < now())
            OR (r.estado = 'pendiente' AND r.pago_estado <> 'pagado' AND r.oferta_fin IS NOT NULL AND r.oferta_fin < v_hoy)
            -- Vence cuando TERMINA el día de `vence_at` en El Salvador, no a su hora.
            OR (r.estado = 'lista' AND (r.vence_at AT TIME ZONE 'America/El_Salvador')::date < v_hoy))
       AND NOT EXISTS (SELECT 1 FROM public.apartado_aplicaciones a WHERE a.reserva_id = r.id)
    RETURNING r.id)
  SELECT array_agg(id) INTO v_ids FROM v;
  IF v_ids IS NULL THEN RETURN 0; END IF;

  -- Un aviso por pedido (o reserva suelta) de la app.
  INSERT INTO public.app_cliente_avisos (customer_id, tipo, ref, titulo, cuerpo, url)
  SELECT g.customer_id, 'reserva', 'base:vencida:' || g.grupo,
         CASE g.motivo WHEN 'sin_receta' THEN 'Tu reserva venció sin la foto de la receta'
                       WHEN 'receta_sin_revisar' THEN 'Tu reserva venció'
                       WHEN 'sin_preparar' THEN 'Tu reserva venció'
                       WHEN 'oferta_terminada' THEN 'Tu reserva venció'
                       ELSE 'Tu reserva venció sin retirar' END,
         CASE g.motivo WHEN 'sin_receta' THEN 'No recibimos la foto de tu receta a tiempo. Puedes volver a reservar cuando quieras.'
                       WHEN 'receta_sin_revisar' THEN 'La sucursal no alcanzó a revisar tu receta a tiempo. Disculpa: puedes volver a reservar y no cuenta en tu contra.'
                       WHEN 'sin_preparar' THEN 'La sucursal no alcanzó a preparar tu pedido a tiempo. Disculpa: puedes volver a reservar y no cuenta en tu contra.'
                       WHEN 'oferta_terminada' THEN 'La oferta terminó antes de que se preparara.'
                       ELSE 'Se cumplió el plazo para retirarla.' END
           || CASE WHEN g.saldo > 0 THEN ' Te quedaron $' || to_char(g.saldo, 'FM999990.00') || ' a favor para otra compra en cualquier sucursal.' ELSE '' END,
         '/reservas'
    FROM (SELECT customer_id, coalesce(pedido, id::text) AS grupo, min(vencida_motivo) AS motivo,
                 coalesce(sum(saldo_favor), 0) AS saldo
            FROM public.app_reservas
           WHERE id = ANY (v_ids) AND origen = 'app'
           GROUP BY 1, 2) g
  ON CONFLICT (customer_id, tipo, ref) DO NOTHING;

  RETURN array_length(v_ids, 1);
END;
$function$;
