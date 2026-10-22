-- Reglamento de reservas v2 (decisiones del dueño, 2026-10-22):
--  · reserva de la app sin pagar: 3 días para retirarla; pagada: 7 (antes, el
--    nivel de puntos: 24 h).
--  · una sola prórroga de 7 días para retirar, en reservas y en encargos.
--  · un insumo que SÍ hay en la sala se aparta (con el 100 %); sólo se encarga
--    si no hay.
--  · un encargo que llegó y no se retiró en 7 días avisa a la sala para que
--    llame al cliente; si no lo va a retirar, la sala lo pasa a saldo a favor.
SET lock_timeout = '5s';

ALTER TABLE public.app_reservas
  ADD COLUMN IF NOT EXISTS prorrogada_at timestamptz,
  ADD COLUMN IF NOT EXISTS prorrogada_por uuid;
ALTER TABLE public.app_encargos
  ADD COLUMN IF NOT EXISTS listo_at timestamptz,
  ADD COLUMN IF NOT EXISTS prorrogado_at timestamptz,
  ADD COLUMN IF NOT EXISTS prorrogado_por uuid,
  ADD COLUMN IF NOT EXISTS aviso_sin_retirar_at timestamptz,
  ADD COLUMN IF NOT EXISTS saldo_reserva_id bigint REFERENCES public.app_reservas(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS app_encargos_saldo_reserva_id_idx ON public.app_encargos (saldo_reserva_id) WHERE saldo_reserva_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS app_encargos_listo_idx ON public.app_encargos (listo_at) WHERE estado = 'listo';
-- Los que ya estaban listos: su último cambio es la mejor aproximación.
UPDATE public.app_encargos SET listo_at = updated_at WHERE estado = 'listo' AND listo_at IS NULL;

-- Las columnas nuevas van AL FINAL: los que leen por nombre siguen igual.
DROP FUNCTION public.reserva_plazos();
CREATE FUNCTION public.reserva_plazos(OUT dias_pagada integer, OUT dias_apartado integer, OUT horas_sin_foto integer,
    OUT horas_receta_sin_revisar integer, OUT horas_para_preparar integer, OUT dias_saldo_favor integer,
    OUT dias_sin_pagar integer, OUT dias_prorroga integer, OUT dias_encargo integer)
 RETURNS record
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  -- Pagada en línea o apartada en caja: 7 días para retirarla. App sin la
  -- foto de la receta (u «otra foto»): 24 h. Foto sin revisar: 48 h. Sin
  -- preparar: 48 h. Saldo a favor: `saldo_favor_dias()`. App sin pagar: 3
  -- días. Prórroga (una sola): 7 días. Encargo que llegó: 7 días.
  SELECT 7, 7, 24, 48, 48, public.saldo_favor_dias(), 3, 7, 7;
$function$;
REVOKE EXECUTE ON FUNCTION public.reserva_plazos() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reserva_plazos() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.reserva_horas_al_preparar(r app_reservas)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT CASE WHEN r.pago_estado = 'pagado' THEN (SELECT p.dias_pagada * 24 FROM public.reserva_plazos() p)
              -- Apartado en sala (2026-10-22): sus 7 días, no las horas de la app.
              WHEN r.origen = 'sucursal' THEN (SELECT p.dias_apartado * 24 FROM public.reserva_plazos() p)
              -- App sin pagar: 3 días para todos (reglamento v2, 2026-10-22).
              ELSE (SELECT p.dias_sin_pagar * 24 FROM public.reserva_plazos() p) END;
$function$;



-- Hasta qué DÍA se retira un encargo que llegó (vence al terminar ese día).
CREATE OR REPLACE FUNCTION public.encargo_retirar_hasta(e app_encargos)
 RETURNS date
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT CASE WHEN e.estado = 'listo' AND e.listo_at IS NOT NULL THEN
    ((e.listo_at AT TIME ZONE 'America/El_Salvador')::date
      + p.dias_encargo + CASE WHEN e.prorrogado_at IS NOT NULL THEN p.dias_prorroga ELSE 0 END) END
  FROM public.reserva_plazos() p;
$function$;
REVOKE EXECUTE ON FUNCTION public.encargo_retirar_hasta(app_encargos) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.encargo_retirar_hasta(app_encargos) TO authenticated, service_role;


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
    -- Reglamento v2: un insumo que hay se aparta (con el 100 %); sólo se encarga si no hay.
    'modo', CASE WHEN v_disp >= v_necesita THEN 'reserva' ELSE 'encargo' END,
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
    -- Un insumo se aparta pagándolo completo (reglamento v2, cláusula 4.2).
    RETURN json_build_object('tipo', 'reserva', 'total', v_total,
      'minimo', CASE WHEN EXISTS (SELECT 1 FROM public.producto_insumo WHERE product_id = (p_apartado->>'producto_id')::bigint)
                     THEN v_total ELSE round(v_total * 0.5, 2) END, 'maximo', v_total,
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

CREATE OR REPLACE FUNCTION public.encargo_responder(p_id bigint, p_accion text, p_precio numeric DEFAULT NULL::numeric, p_fecha date DEFAULT NULL::date, p_nota text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  e public.app_encargos;
  v_emp uuid := public.auth_employee_id();
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
  IF p_accion = 'confirmar' AND e.estado = 'solicitado' THEN
    IF p_precio IS NULL OR p_precio <= 0 OR p_fecha IS NULL OR p_fecha < (now() AT TIME ZONE 'America/El_Salvador')::date THEN
      RAISE EXCEPTION 'Falta el precio o una fecha estimada válida.';
    END IF;
    UPDATE public.app_encargos SET estado = 'confirmado', precio_unitario = round(p_precio, 2),
           anticipo = round(p_precio * cantidad, 2), fecha_estimada = p_fecha, nota_sucursal = nullif(trim(p_nota), ''),
           respondido_por = v_emp, respondido_at = now(), updated_at = now() WHERE id = p_id;
  ELSIF p_accion = 'rechazar' AND e.estado IN ('solicitado', 'confirmado') THEN
    -- Un producto que no tenemos se rechaza con motivo escrito: es lo que se le dice al cliente.
    IF e.producto_nuevo AND coalesce(trim(p_nota), '') = '' THEN
      RAISE EXCEPTION 'Escribe el motivo: es lo que se le dice al cliente.';
    END IF;
    UPDATE public.app_encargos SET estado = 'rechazado', nota_sucursal = coalesce(nullif(trim(p_nota), ''), 'No lo podemos conseguir por ahora.'),
           respondido_por = v_emp, respondido_at = now(), cerrado_at = now(), updated_at = now() WHERE id = p_id;
  ELSIF p_accion = 'pedido' AND e.estado = 'aceptado' THEN
    UPDATE public.app_encargos SET estado = 'pedido', updated_at = now() WHERE id = p_id;
  ELSIF p_accion = 'listo' AND e.estado IN ('aceptado', 'pedido') THEN
    IF e.product_id IS NULL THEN
      RAISE EXCEPTION 'Es un producto nuevo: primero vincúlalo al producto ya creado en el catálogo.';
    END IF;
    UPDATE public.app_encargos SET estado = 'listo', listo_at = now(), updated_at = now() WHERE id = p_id;
  ELSIF p_accion = 'entregado' AND e.estado = 'listo' THEN
    IF e.pago_estado = 'pagado' AND NOT EXISTS (SELECT 1 FROM public.apartado_aplicaciones a WHERE a.encargo_id = e.id) THEN
      RAISE EXCEPTION 'Este encargo está pagado: usa «Retirar» para aplicar el pago a la factura.' USING ERRCODE = 'P0001';
    END IF;
    UPDATE public.app_encargos SET estado = 'entregado', cerrado_at = now(), updated_at = now() WHERE id = p_id;
  ELSE
    RAISE EXCEPTION 'TRANSICION_INVALIDA: % → %', e.estado, p_accion;
  END IF;
  INSERT INTO public.audit_logs (user_id, action, target_id, details, branch_id, source)
  VALUES (v_emp, 'ENCARGO_' || upper(p_accion), p_id::text,
          jsonb_build_object('antes', e.estado, 'precio', p_precio, 'fecha', p_fecha, 'nota', p_nota), e.branch_id, 'ADMIN_PANEL');
  RETURN json_build_object('ok', true, 'id', p_id);
END $function$;

CREATE OR REPLACE FUNCTION public.encargos_de_sucursal(p_branch_id bigint, p_abiertos boolean DEFAULT true)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
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
      -- El resto de una reserva (2026-10-22) se cobra con la reserva, nunca en «Por cobrar».
      'reserva_id', e.reserva_id, 'reserva', CASE WHEN e.reserva_id IS NOT NULL THEN 'R-' || lpad(e.reserva_id::text, 6, '0') END,
      'sugerido_product_id', e.sugerido_product_id, 'sugerido', ps.nombre,
      -- Reglamento v2: 7 días desde que llegó (+7 con la única prórroga), el último entero.
      'listo_at', e.listo_at, 'prorrogado_at', e.prorrogado_at, 'aviso_sin_retirar_at', e.aviso_sin_retirar_at,
      'retirar_hasta', public.encargo_retirar_hasta(e),
      'creado', e.created_at)
      ORDER BY (e.estado = 'solicitado') DESC, (e.estado = 'aceptado') DESC, e.created_at DESC)
      FROM public.app_encargos e
      JOIN public.branches b ON b.id = e.branch_id
      JOIN public.customers c ON c.id = e.customer_id
      LEFT JOIN public.products p ON p.id = e.product_id
      LEFT JOIN public.products ps ON ps.id = e.sugerido_product_id AND e.product_id IS NULL
     WHERE (p_branch_id IS NULL OR e.branch_id = p_branch_id)
       AND (CASE WHEN p_abiertos THEN e.estado IN ('solicitado', 'confirmado', 'aceptado', 'pedido', 'listo')
                 ELSE e.created_at > now() - interval '30 days' END)), '[]'::json);
END $function$;

CREATE OR REPLACE FUNCTION public.reservas_vigilar()
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_hoy date := (now() AT TIME ZONE 'America/El_Salvador')::date;
  v_apagados integer := 0;
  v_avisos integer := 0;
  v_reversos integer := 0;
  v_encargos integer := 0;
  v_ids integer[];
  v_dest uuid[];
  v_clave text;
  v_monto numeric(12,2);
  v_usado numeric(12,2);
  v_queda numeric(12,2);
  v_codigo text;
  v_salida bigint;
  v_nota text;
  r public.app_reservas;
  m record;
  s record;
  x record;
BEGIN
  -- 0 · saldo usado que ninguna factura canjeó en una hora (2026-10-21).
  -- Lo usado se volvió puntos del titular para que la caja lo descuente como
  -- un canje. Si en una hora no hubo canje (la factura salió a otro nombre o
  -- como consumidor final), esos puntos se quitan del libro con una salida
  -- de ajuste y el monto vuelve a la reserva como movimiento 'reverso'. Si se
  -- canjeó una parte, vuelve sólo lo que quedó en el lote.
  FOR m IN
    SELECT mv.id, mv.reserva_id, mv.monto, mv.branch_id, mv.employee_id, mv.created_at,
           l.id AS lote_id, l.customer_id AS titular, l.restantes, l.puntos
      FROM public.saldo_favor_movimientos mv
      JOIN public.puntos_lote l ON l.id = mv.puntos_lote_id
     WHERE mv.tipo = 'uso' AND mv.created_at < now() - interval '1 hour'
       AND l.origen = 'saldo_favor' AND l.restantes > 0
       AND NOT EXISTS (SELECT 1 FROM public.saldo_favor_movimientos z
                        WHERE z.tipo = 'reverso' AND z.puntos_lote_id = mv.puntos_lote_id)
     ORDER BY mv.id
     FOR UPDATE OF l SKIP LOCKED
  LOOP
    SELECT * INTO r FROM public.app_reservas WHERE id = m.reserva_id FOR UPDATE;
    v_monto := round(m.restantes / 100.0, 2);
    v_usado := round((m.puntos - m.restantes) / 100.0, 2);
    v_codigo := coalesce(r.pedido, 'R-' || lpad(r.id::text, 6, '0'));

    PERFORM 1 FROM public.puntos_cuenta WHERE customer_id = m.titular FOR UPDATE;
    INSERT INTO public.puntos_salida (customer_id, tipo, puntos, monto, sucursal, motivo)
    VALUES (m.titular, 'ajuste', m.restantes, v_monto,
            (SELECT b.codigo_puntos FROM public.branches b WHERE b.id = m.branch_id),
            'Saldo a favor de la reserva ' || v_codigo || ' sin canjear en una hora: vuelve a la reserva')
    RETURNING id INTO v_salida;
    INSERT INTO public.puntos_salida_lote (salida_id, lote_id, puntos) VALUES (v_salida, m.lote_id, m.restantes);
    UPDATE public.puntos_lote SET restantes = 0 WHERE id = m.lote_id;
    UPDATE public.puntos_cuenta
       SET saldo = saldo - m.restantes, usados = usados + m.restantes, updated_at = now()
     WHERE customer_id = m.titular;

    v_queda := coalesce(r.saldo_favor, 0) + v_monto;
    UPDATE public.app_reservas
       SET saldo_favor = v_queda,
           saldo_favor_usado_at = NULL, saldo_favor_usado_por = NULL, saldo_favor_usado_branch = NULL,
           updated_at = now()
     WHERE id = r.id;

    v_nota := CASE WHEN v_usado > 0
      THEN format('Se usaron %s del saldo de %s y la factura descontó sólo %s: los %s restantes volvieron a la reserva.',
                  to_char(m.monto, 'FM$999,990.00'), v_codigo, to_char(v_usado, 'FM$999,990.00'), to_char(v_monto, 'FM$999,990.00'))
      ELSE format('Se usaron %s del saldo de %s y en una hora ninguna factura a su nombre los descontó (¿salió a otro nombre o como consumidor final?): volvieron a la reserva.',
                  to_char(m.monto, 'FM$999,990.00'), v_codigo) END;

    INSERT INTO public.saldo_favor_movimientos (reserva_id, tipo, monto, saldo_despues, branch_id, puntos_lote_id, nota)
    VALUES (r.id, 'reverso', v_monto, v_queda, m.branch_id, m.lote_id,
            CASE WHEN v_usado > 0 THEN 'canje parcial: vuelve lo no descontado' ELSE 'sin canje en una hora' END);

    INSERT INTO public.audit_logs (action, target_id, details, branch_id, source)
    VALUES ('RESERVA_SALDO_FAVOR_REVERSO', r.id::text,
            jsonb_build_object('movimiento', m.id, 'lote', m.lote_id, 'usado', m.monto, 'canjeado', v_usado,
                               'devuelto', v_monto, 'queda', v_queda, 'salida', v_salida),
            m.branch_id, 'SYSTEM');

    PERFORM public.saldo_favor_anotar('saldo_reverso:' || m.id, 'saldo_favor_no_canjeado', r.customer_id,
      m.branch_id, NULL, m.employee_id, v_monto, v_nota,
      jsonb_build_object('reserva_id', r.id, 'codigo', v_codigo, 'usado', m.monto, 'canjeado', v_usado, 'movimiento', m.id));

    SELECT array_agg(DISTINCT d) INTO v_dest
      FROM unnest(coalesce(public.destinatarios_de_reservas(m.branch_id), '{}'::uuid[])
                  || coalesce(public.destinatarios_de_reservas(r.branch_id), '{}'::uuid[])) d;
    IF v_dest IS NOT NULL THEN
      PERFORM public.notify_employees(v_dest, 'RESERVA_APP',
        'El saldo a favor no se descontó',
        v_nota || ' Si la venta ya salió sin el descuento, hay que revisarla con el cliente.',
        '/puntos?tab=avisos', jsonb_build_object('check_key', 'saldo_reverso:' || m.id, 'reserva_id', r.id),
        true, m.branch_id::integer);
      UPDATE public.puntos_irregularidad SET avisado_at = now() WHERE clave = 'saldo_reverso:' || m.id;
    END IF;
    v_reversos := v_reversos + 1;
  END LOOP;

  -- 1 · saldos vencidos
  FOR s IN
    SELECT id, saldo_favor, customer_id, branch_id, pedido FROM public.app_reservas
     WHERE saldo_favor > 0 AND saldo_favor_usado_at IS NULL AND saldo_favor_devuelto_at IS NULL
       AND saldo_favor_vence < v_hoy
     FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE public.app_reservas
       SET saldo_favor_inicial = coalesce(saldo_favor_inicial, saldo_favor), saldo_favor = 0, updated_at = now()
     WHERE id = s.id;
    INSERT INTO public.saldo_favor_movimientos (reserva_id, tipo, monto, saldo_despues, nota)
    VALUES (s.id, 'vencimiento', s.saldo_favor, 0, 'venció sin usarse');
    PERFORM public.saldo_favor_anotar('saldo_vencido:' || s.id, 'saldo_favor_vencido', s.customer_id,
      s.branch_id, NULL, NULL, s.saldo_favor,
      format('El saldo a favor de %s (%s) venció sin usarse.',
             coalesce(s.pedido, 'R-' || lpad(s.id::text, 6, '0')), to_char(s.saldo_favor, 'FM$999,990.00')),
      jsonb_build_object('reserva_id', s.id));
    v_apagados := v_apagados + 1;
  END LOOP;

  -- 2 · existencia por debajo de lo apartado
  SELECT array_agg(DISTINCT producto_id::int) INTO v_ids
    FROM public.app_reservas
   WHERE estado IN ('en_revision', 'pendiente', 'lista') AND producto_id IS NOT NULL;
  IF v_ids IS NOT NULL THEN
    FOR x IN
      SELECT e.product_id, e.branch_id, e.existencia, e.apartadas,
             (SELECT r2.producto_nombre FROM public.app_reservas r2
               WHERE r2.producto_id = e.product_id AND r2.branch_id = e.branch_id
                 AND r2.estado IN ('en_revision', 'pendiente', 'lista') ORDER BY r2.id LIMIT 1) AS producto,
             (SELECT count(*) FROM public.app_reservas r2
               WHERE r2.producto_id = e.product_id AND r2.branch_id = e.branch_id
                 AND r2.estado IN ('en_revision', 'pendiente', 'lista')) AS reservas
        FROM json_to_recordset(public.app_existencias_netas(v_ids))
             AS e(product_id int, branch_id bigint, existencia numeric, apartadas numeric, disponibles numeric)
       WHERE e.apartadas > 0 AND e.existencia < e.apartadas
    LOOP
      v_clave := 'reserva_sin_existencia:' || x.branch_id || ':' || x.product_id || ':' || v_hoy;
      CONTINUE WHEN EXISTS (SELECT 1 FROM public.notifications n
                             WHERE n.metadata ? 'check_key' AND n.metadata->>'check_key' = v_clave);
      v_dest := public.destinatarios_de_reservas(x.branch_id);
      CONTINUE WHEN v_dest IS NULL;
      PERFORM public.notify_employees(v_dest, 'RESERVA_APP',
        'Falta existencia para una reserva',
        coalesce(x.producto, 'Un producto') || ': hay ' || trim(to_char(x.existencia, 'FM999,990'))
          || ' y ' || CASE WHEN x.reservas = 1 THEN 'una reserva aparta ' ELSE x.reservas || ' reservas apartan ' END
          || trim(to_char(x.apartadas, 'FM999,990')) || '. Revísalo antes de que el cliente llegue.',
        '/reservas', jsonb_build_object('check_key', v_clave, 'producto_id', x.product_id,
                                        'existencia', x.existencia, 'apartadas', x.apartadas),
        true, x.branch_id::integer);
      v_avisos := v_avisos + 1;
    END LOOP;
  END IF;

  -- 3 · encargos que llegaron y no se retiraron en su plazo (reglamento v2).
  -- No se cierran solos: la sala llama al cliente para confirmar y, si no lo
  -- va a retirar, lo pasa a saldo a favor (`encargo_pasar_a_saldo`).
  FOR x IN
    SELECT e.id, e.branch_id, e.producto_nombre, c.name AS cliente, c.phone
      FROM public.app_encargos e JOIN public.customers c ON c.id = e.customer_id
     WHERE e.estado = 'listo' AND e.aviso_sin_retirar_at IS NULL
       AND public.encargo_retirar_hasta(e) < v_hoy
  LOOP
    v_dest := public.destinatarios_de_reservas(x.branch_id);
    IF v_dest IS NOT NULL THEN
      PERFORM public.notify_employees(v_dest, 'RESERVA_APP',
        'Encargo sin retirar · E-' || lpad(x.id::text, 6, '0'),
        'Pasó el plazo y ' || coalesce(initcap(split_part(x.cliente, ' ', 1)), 'el cliente') || ' no ha retirado '
          || coalesce(x.producto_nombre, 'su encargo') || '. Llámalo' || coalesce(' al ' || x.phone, '')
          || ' para confirmar; si no lo va a retirar, pásalo a saldo a favor.',
        '/reservas', jsonb_build_object('check_key', 'encargo_sin_retirar:' || x.id, 'encargo_id', x.id),
        true, x.branch_id::integer);
    END IF;
    UPDATE public.app_encargos SET aviso_sin_retirar_at = now() WHERE id = x.id;
    v_encargos := v_encargos + 1;
  END LOOP;

  RETURN json_build_object('saldos_apagados', v_apagados, 'avisos_existencia', v_avisos, 'saldos_devueltos', v_reversos,
                           'encargos_sin_retirar', v_encargos);
END $function$;


-- Una sola prórroga de 7 días para retirar (reglamento v2, cláusula 7).
CREATE OR REPLACE FUNCTION public.reserva_prorrogar(p_id bigint)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE r public.app_reservas; v_emp uuid := public.auth_employee_id(); v_vence timestamptz; v_codigo text;
BEGIN
  SELECT * INTO r FROM public.app_reservas WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Esa reserva no existe.'; END IF;
  IF NOT public.reserva_puede_manejar(r.branch_id) THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501'; END IF;
  IF r.estado <> 'lista' OR r.vence_at IS NULL THEN RAISE EXCEPTION 'Sólo se prorroga una reserva lista para retirar.'; END IF;
  IF r.prorrogada_at IS NOT NULL THEN RAISE EXCEPTION 'Esta reserva ya se prorrogó una vez: no admite otra prórroga.'; END IF;
  UPDATE public.app_reservas
     SET vence_at = vence_at + make_interval(days => (SELECT p.dias_prorroga FROM public.reserva_plazos() p)),
         prorrogada_at = now(), prorrogada_por = v_emp, updated_at = now()
   WHERE id = p_id RETURNING vence_at INTO v_vence;
  v_codigo := coalesce(r.pedido, 'R-' || lpad(p_id::text, 6, '0'));
  IF r.origen = 'app' THEN
    INSERT INTO public.app_cliente_avisos (customer_id, tipo, ref, titulo, cuerpo, url)
    VALUES (r.customer_id, 'reserva', 'base:prorroga:' || p_id, 'Tu reserva tiene más plazo',
            'Puedes retirar ' || coalesce(r.producto_nombre, 'tu reserva') || ' hasta el '
              || to_char((v_vence AT TIME ZONE 'America/El_Salvador')::date, 'DD/MM/YYYY') || ', todo el día.',
            '/reservas')
    ON CONFLICT (customer_id, tipo, ref) DO NOTHING;
  END IF;
  INSERT INTO public.audit_logs (user_id, action, target_id, details, branch_id, source)
  VALUES (v_emp, 'RESERVA_PRORROGADA', p_id::text, jsonb_build_object('antes', r.vence_at, 'ahora', v_vence), r.branch_id, 'ADMIN_PANEL');
  RETURN json_build_object('ok', true, 'codigo', v_codigo, 'vence_at', v_vence);
END $function$;
REVOKE EXECUTE ON FUNCTION public.reserva_prorrogar(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reserva_prorrogar(bigint) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.encargo_prorrogar(p_id bigint)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE e public.app_encargos; v_emp uuid := public.auth_employee_id();
BEGIN
  SELECT * INTO e FROM public.app_encargos WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ese encargo no existe.'; END IF;
  IF NOT public.encargo_puede_manejar(e.branch_id) THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501'; END IF;
  IF e.estado <> 'listo' THEN RAISE EXCEPTION 'Sólo se prorroga un encargo que ya llegó.'; END IF;
  IF e.prorrogado_at IS NOT NULL THEN RAISE EXCEPTION 'Este encargo ya se prorrogó una vez: no admite otra prórroga.'; END IF;
  -- Con la prórroga vuelve a avisar si tampoco se retira en el plazo nuevo.
  UPDATE public.app_encargos SET prorrogado_at = now(), prorrogado_por = v_emp, aviso_sin_retirar_at = NULL, updated_at = now()
   WHERE id = p_id RETURNING * INTO e;
  INSERT INTO public.audit_logs (user_id, action, target_id, details, branch_id, source)
  VALUES (v_emp, 'ENCARGO_PRORROGADO', p_id::text, jsonb_build_object('hasta', public.encargo_retirar_hasta(e)), e.branch_id, 'ADMIN_PANEL');
  RETURN json_build_object('ok', true, 'retirar_hasta', public.encargo_retirar_hasta(e));
END $function$;
REVOKE EXECUTE ON FUNCTION public.encargo_prorrogar(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.encargo_prorrogar(bigint) TO authenticated, service_role;

-- El cliente no retira (o desiste de) un encargo pagado: lo pagado queda a su
-- favor (reglamento v2, cláusulas 8 y 9) y el producto queda para la venta.
-- El saldo vive, como todo saldo a favor, en una fila cerrada de app_reservas.
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
  IF e.estado NOT IN ('aceptado', 'pedido', 'listo') OR e.pago_estado <> 'pagado' THEN
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
REVOKE EXECUTE ON FUNCTION public.encargo_pasar_a_saldo(bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.encargo_pasar_a_saldo(bigint, text) TO authenticated, service_role;

