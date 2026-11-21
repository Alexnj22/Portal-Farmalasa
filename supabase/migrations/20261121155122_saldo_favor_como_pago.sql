-- Saldo a favor como PAGO, no como descuento (2026-11-21, opción A del usuario).
--
-- Antes el saldo se convertía en puntos y la factura lo restaba: el anticipo
-- nunca quedaba en ninguna factura (fuera del libro y del IVA). Ahora se usa
-- como el anticipo de un retiro:
--   · se APARTA (`saldo_favor_apartar`): baja el saldo y nace un uso;
--   · se factura la compra COMPLETA, al contado si el saldo salió de efectivo
--     y lo demás se paga en efectivo, si no al crédito;
--   · después se APLICA con lo mismo que el retiro: el vale «Aplica anticipo»
--     (operar-caja) o el abono al crédito (creditos-erp). Las dos piezas leen
--     `apartado_para_retirar` y escriben `apartado_aplicaciones`, que ahora
--     aceptan `{ saldo_uso_id }`;
--   · si no se va a usar (la preventa se descartó, el cliente se arrepintió) se
--     SUELTA y el monto vuelve al saldo.
SET lock_timeout = '5s';

-- ── Los usos ──
CREATE TABLE IF NOT EXISTS public.saldo_favor_usos (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at   timestamptz NOT NULL DEFAULT now(),
  reserva_id   bigint NOT NULL REFERENCES public.app_reservas(id),
  branch_id    bigint NOT NULL REFERENCES public.branches(id),
  customer_id  bigint NOT NULL REFERENCES public.customers(id),
  monto        numeric(12,2) NOT NULL CHECK (monto > 0),
  estado       text NOT NULL DEFAULT 'apartado' CHECK (estado IN ('apartado', 'aplicado', 'liberado')),
  preventa_id  bigint REFERENCES public.preventas(id),
  confirmado_con text,
  creado_por   uuid,
  aplicado_at  timestamptz,
  liberado_at  timestamptz,
  motivo       text
);
COMMENT ON TABLE public.saldo_favor_usos IS
  'Saldo a favor apartado para pagar una factura (2026-11-21). Se aplica con el vale o el abono al crédito del retiro (apartado_aplicaciones.saldo_uso_id).';
CREATE INDEX IF NOT EXISTS saldo_favor_usos_reserva ON public.saldo_favor_usos (reserva_id);
CREATE INDEX IF NOT EXISTS saldo_favor_usos_branch_apartado ON public.saldo_favor_usos (branch_id) WHERE estado = 'apartado';
CREATE INDEX IF NOT EXISTS saldo_favor_usos_customer ON public.saldo_favor_usos (customer_id);
CREATE INDEX IF NOT EXISTS saldo_favor_usos_preventa ON public.saldo_favor_usos (preventa_id) WHERE preventa_id IS NOT NULL;
ALTER TABLE public.saldo_favor_usos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS saldo_favor_usos_select ON public.saldo_favor_usos;
CREATE POLICY saldo_favor_usos_select ON public.saldo_favor_usos FOR SELECT TO authenticated
  USING (public.reserva_puede_manejar(branch_id));
REVOKE ALL ON public.saldo_favor_usos FROM anon;

ALTER TABLE public.apartado_aplicaciones
  ADD COLUMN IF NOT EXISTS saldo_uso_id bigint REFERENCES public.saldo_favor_usos(id);
CREATE UNIQUE INDEX IF NOT EXISTS apartado_aplicaciones_saldo_uso ON public.apartado_aplicaciones (saldo_uso_id) WHERE saldo_uso_id IS NOT NULL;
ALTER TABLE public.apartado_aplicaciones DROP CONSTRAINT IF EXISTS apartado_aplicaciones_check;
ALTER TABLE public.apartado_aplicaciones DROP CONSTRAINT IF EXISTS apartado_aplicaciones_una_referencia;
ALTER TABLE public.apartado_aplicaciones ADD CONSTRAINT apartado_aplicaciones_una_referencia
  CHECK (num_nonnulls(reserva_id, encargo_id, saldo_uso_id) = 1);

-- ── ¿El saldo salió de efectivo? ──
-- Con los cobros de la reserva en la mano, manda que TODOS hayan sido en
-- efectivo de la caja y ninguno en línea; sin cobros ligados (saldo de un
-- encargo, cobro de pedido), lo dice `pago_metodo`.
CREATE OR REPLACE FUNCTION public.saldo_favor_es_efectivo(p_reserva bigint)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE r public.app_reservas; v_todos boolean;
BEGIN
  SELECT * INTO r FROM public.app_reservas WHERE id = p_reserva;
  IF NOT FOUND THEN RETURN false; END IF;
  IF EXISTS (SELECT 1 FROM public.app_reservas_pagos pg WHERE pg.reserva_id = r.id AND pg.pagado_at IS NOT NULL) THEN
    RETURN false;
  END IF;
  SELECT bool_and(m.forma_pago = 'EFECTIVO') INTO v_todos
    FROM public.caja_movimientos_portal m
   WHERE m.reserva_id = r.id AND m.tipo_codigo = 'APARTADO' AND m.anulado_at IS NULL;
  IF v_todos IS NOT NULL THEN RETURN v_todos; END IF;
  RETURN coalesce(r.pago_metodo, 'efectivo') = 'efectivo';
END $function$;
REVOKE EXECUTE ON FUNCTION public.saldo_favor_es_efectivo(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.saldo_favor_es_efectivo(bigint) TO authenticated, service_role;

-- ── Apartar ──
CREATE OR REPLACE FUNCTION public.saldo_favor_apartar(p_id bigint, p_monto numeric, p_prueba text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  r public.app_reservas;
  v_hoy date := (now() AT TIME ZONE 'America/El_Salvador')::date;
  v_quien uuid := public.auth_employee_id();
  v_sala bigint;
  v_modo text;
  v_monto numeric(12,2) := round(coalesce(p_monto, 0), 2);
  v_queda numeric(12,2);
  v_uso bigint;
  v_codigo text;
BEGIN
  SELECT * INTO r FROM public.app_reservas WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No existe esa reserva'; END IF;
  -- El saldo vale en cualquier sala: basta poder manejar reservas en la propia.
  IF NOT (public.reserva_puede_manejar(r.branch_id) OR public.auth_can_edit_any(ARRAY['dash_reservas'])) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF coalesce(r.saldo_favor, 0) <= 0 THEN RAISE EXCEPTION 'Esa reserva no tiene saldo a favor'; END IF;
  IF r.saldo_favor_usado_at IS NOT NULL THEN RAISE EXCEPTION 'Ese saldo a favor ya se usó'; END IF;
  IF r.saldo_favor_devuelto_at IS NOT NULL THEN RAISE EXCEPTION 'Ese saldo a favor ya se devolvió en dinero'; END IF;
  IF r.devolucion_pedida_at IS NOT NULL THEN RAISE EXCEPTION 'Ya se pidió devolver ese saldo en efectivo.'; END IF;
  IF r.saldo_favor_vence < v_hoy THEN RAISE EXCEPTION 'Ese saldo a favor ya venció'; END IF;
  v_modo := public.cliente_confirma(r.customer_id, p_prueba);
  IF v_modo IS NULL THEN
    RAISE EXCEPTION 'No se pudo confirmar que sea el titular: escanea su tarjeta de Puntos Salud o escribe el DUI o el teléfono de su ficha.';
  END IF;
  IF v_monto <= 0 THEN RAISE EXCEPTION 'Escribe cuánto se usa.'; END IF;
  IF v_monto > r.saldo_favor THEN
    RAISE EXCEPTION 'Tiene % a favor: no se pueden usar %.', to_char(r.saldo_favor, 'FM$999,990.00'), to_char(v_monto, 'FM$999,990.00');
  END IF;

  v_sala := coalesce(public.empleado_sala_de_hoy(NULL, v_hoy), public.auth_employee_branch_id());
  IF v_sala IS NULL THEN RAISE EXCEPTION 'No se sabe en qué sucursal estás hoy.'; END IF;
  v_codigo := coalesce(r.pedido, 'R-' || lpad(r.id::text, 6, '0'));
  v_queda := r.saldo_favor - v_monto;
  UPDATE public.app_reservas
     SET saldo_favor_inicial = coalesce(saldo_favor_inicial, saldo_favor),
         saldo_favor = v_queda,
         saldo_favor_usado_at     = CASE WHEN v_queda <= 0 THEN now() ELSE saldo_favor_usado_at END,
         saldo_favor_usado_por    = CASE WHEN v_queda <= 0 THEN v_quien ELSE saldo_favor_usado_por END,
         saldo_favor_usado_branch = CASE WHEN v_queda <= 0 THEN v_sala ELSE saldo_favor_usado_branch END,
         updated_at = now()
   WHERE id = p_id;
  INSERT INTO public.saldo_favor_usos (reserva_id, branch_id, customer_id, monto, confirmado_con, creado_por)
  VALUES (r.id, v_sala, r.customer_id, v_monto, v_modo, v_quien)
  RETURNING id INTO v_uso;
  INSERT INTO public.saldo_favor_movimientos (reserva_id, tipo, monto, saldo_despues, branch_id, employee_id, confirmado_con, nota)
  VALUES (r.id, 'uso', v_monto, v_queda, v_sala, v_quien, v_modo, 'Apartado para pagar una factura (uso ' || v_uso || ')');
  INSERT INTO public.audit_logs (action, target_id, details, branch_id, user_id)
  VALUES ('RESERVA_SALDO_FAVOR_APARTADO', r.id::text,
          jsonb_build_object('uso', v_uso, 'monto', v_monto, 'queda', v_queda, 'confirmado_con', v_modo, 'sala_de_la_reserva', r.branch_id),
          v_sala, v_quien);
  RETURN json_build_object('ok', true, 'uso_id', v_uso, 'monto', v_monto, 'queda', v_queda, 'codigo', v_codigo,
                           'cliente', (SELECT name FROM public.customers WHERE id = r.customer_id),
                           'efectivo', public.saldo_favor_es_efectivo(r.id), 'confirmado_con', v_modo);
END $function$;
REVOKE EXECUTE ON FUNCTION public.saldo_favor_apartar(bigint, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.saldo_favor_apartar(bigint, numeric, text) TO authenticated, service_role;

-- ── Soltar: el monto vuelve al saldo ──
-- El trabajo, sin permisos: lo llaman `saldo_favor_soltar` y el disparador
-- de preventas. Sin EXECUTE para nadie de la API.
CREATE OR REPLACE FUNCTION public.saldo_favor_soltar_sin_permiso(p_uso bigint, p_motivo text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE u public.saldo_favor_usos; r public.app_reservas; v_queda numeric(12,2); v_quien uuid := public.auth_employee_id();
BEGIN
  SELECT * INTO u FROM public.saldo_favor_usos WHERE id = p_uso FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ese uso del saldo no existe.'; END IF;
  IF u.estado = 'liberado' THEN RETURN json_build_object('ok', true, 'ya_estaba', true); END IF;
  IF u.estado = 'aplicado' OR EXISTS (SELECT 1 FROM public.apartado_aplicaciones a WHERE a.saldo_uso_id = u.id) THEN
    RAISE EXCEPTION 'Ese saldo ya se aplicó a una factura: no se puede soltar.';
  END IF;
  SELECT * INTO r FROM public.app_reservas WHERE id = u.reserva_id FOR UPDATE;
  v_queda := coalesce(r.saldo_favor, 0) + u.monto;
  UPDATE public.app_reservas
     SET saldo_favor = v_queda, saldo_favor_usado_at = NULL, saldo_favor_usado_por = NULL, saldo_favor_usado_branch = NULL,
         updated_at = now()
   WHERE id = r.id;
  INSERT INTO public.saldo_favor_movimientos (reserva_id, tipo, monto, saldo_despues, branch_id, employee_id, nota)
  VALUES (r.id, 'reverso', u.monto, v_queda, u.branch_id, v_quien,
          left(coalesce(nullif(btrim(p_motivo), ''), 'No se usó: vuelve al saldo') || ' (uso ' || u.id || ')', 300));
  UPDATE public.saldo_favor_usos
     SET estado = 'liberado', liberado_at = now(), motivo = left(nullif(btrim(coalesce(p_motivo, '')), ''), 300)
   WHERE id = u.id;
  INSERT INTO public.audit_logs (action, target_id, details, branch_id, user_id, source)
  VALUES ('RESERVA_SALDO_FAVOR_SOLTADO', r.id::text, jsonb_build_object('uso', u.id, 'monto', u.monto, 'queda', v_queda, 'motivo', p_motivo),
          u.branch_id, v_quien, CASE WHEN v_quien IS NULL THEN 'SYSTEM' ELSE 'ADMIN_PANEL' END);
  RETURN json_build_object('ok', true, 'monto', u.monto, 'queda', v_queda);
END $function$;
REVOKE EXECUTE ON FUNCTION public.saldo_favor_soltar_sin_permiso(bigint, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.saldo_favor_soltar_sin_permiso(bigint, text) TO service_role;

CREATE OR REPLACE FUNCTION public.saldo_favor_soltar(p_uso bigint, p_motivo text DEFAULT NULL)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v_branch bigint;
BEGIN
  SELECT branch_id INTO v_branch FROM public.saldo_favor_usos WHERE id = p_uso;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ese uso del saldo no existe.'; END IF;
  IF coalesce(auth.role(), '') <> 'service_role'
     AND NOT (public.reserva_puede_manejar(v_branch) OR public.auth_can_edit_any(ARRAY['dash_reservas'])) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  RETURN public.saldo_favor_soltar_sin_permiso(p_uso, p_motivo);
END $function$;
REVOKE EXECUTE ON FUNCTION public.saldo_favor_soltar(bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.saldo_favor_soltar(bigint, text) TO authenticated, service_role;

-- ── Ligar el uso a la preventa que lo lleva ──
CREATE OR REPLACE FUNCTION public.saldo_favor_ligar_preventa(p_uso bigint, p_preventa bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE u public.saldo_favor_usos; pv public.preventas;
BEGIN
  SELECT * INTO u FROM public.saldo_favor_usos WHERE id = p_uso FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ese uso del saldo no existe.'; END IF;
  IF NOT (public.reserva_puede_manejar(u.branch_id) OR public.auth_can_edit_any(ARRAY['dash_reservas'])) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO pv FROM public.preventas WHERE id = p_preventa;
  IF NOT FOUND OR pv.branch_id <> u.branch_id THEN RAISE EXCEPTION 'Esa preventa no es de esta sucursal.'; END IF;
  IF pv.customer_id IS DISTINCT FROM u.customer_id THEN RAISE EXCEPTION 'Esa preventa no está a nombre del dueño del saldo.'; END IF;
  UPDATE public.saldo_favor_usos SET preventa_id = p_preventa WHERE id = p_uso AND estado = 'apartado';
END $function$;
REVOKE EXECUTE ON FUNCTION public.saldo_favor_ligar_preventa(bigint, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.saldo_favor_ligar_preventa(bigint, bigint) TO authenticated, service_role;

-- ── Lo apartado sin aplicar, por sucursal ──
CREATE OR REPLACE FUNCTION public.saldo_favor_por_aplicar(p_branch bigint)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  IF NOT public.reserva_puede_manejar(p_branch) THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501'; END IF;
  RETURN (SELECT coalesce(json_agg(json_build_object(
            'id', u.id, 'reserva_id', u.reserva_id, 'codigo', coalesce(r.pedido, 'R-' || lpad(r.id::text, 6, '0')),
            'customer_id', u.customer_id, 'cliente', c.name, 'monto', u.monto, 'created_at', u.created_at,
            'creado_por', u.creado_por, 'efectivo', public.saldo_favor_es_efectivo(r.id),
            'preventa_id', u.preventa_id, 'preventa_estado', pv.estado, 'facturada_at', pv.facturada_at)
          ORDER BY u.created_at), '[]'::json)
     FROM public.saldo_favor_usos u
     JOIN public.app_reservas r ON r.id = u.reserva_id
     LEFT JOIN public.customers c ON c.id = u.customer_id
     LEFT JOIN public.preventas pv ON pv.id = u.preventa_id
    WHERE u.branch_id = p_branch AND u.estado = 'apartado');
END $function$;
REVOKE EXECUTE ON FUNCTION public.saldo_favor_por_aplicar(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.saldo_favor_por_aplicar(bigint) TO authenticated, service_role;

-- ── Una preventa descartada suelta el saldo que llevaba ──
CREATE OR REPLACE FUNCTION public.preventas_soltar_saldo()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE u record;
BEGIN
  IF NEW.estado = 'descartada' AND OLD.estado IS DISTINCT FROM 'descartada' THEN
    FOR u IN SELECT id FROM public.saldo_favor_usos WHERE preventa_id = NEW.id AND estado = 'apartado'
              AND NOT EXISTS (SELECT 1 FROM public.apartado_aplicaciones a WHERE a.saldo_uso_id = saldo_favor_usos.id) LOOP
      PERFORM public.saldo_favor_soltar_sin_permiso(u.id, 'Se descartó la preventa ' || NEW.id);
    END LOOP;
  END IF;
  RETURN NEW;
END $function$;
REVOKE EXECUTE ON FUNCTION public.preventas_soltar_saldo() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS preventas_soltar_saldo ON public.preventas;
CREATE TRIGGER preventas_soltar_saldo AFTER UPDATE OF estado ON public.preventas
  FOR EACH ROW WHEN (NEW.estado = 'descartada') EXECUTE FUNCTION public.preventas_soltar_saldo();

-- ── El retiro entiende `{ saldo_uso_id }` ──
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
  r public.app_reservas; e public.app_encargos; k record; u public.saldo_favor_usos;
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
  ELSIF p_apartado ? 'saldo_uso_id' THEN
    -- Saldo a favor apartado para pagar una factura (2026-11-21): lo pagado
    -- es el monto del uso; efectivo u otra forma, según de dónde salió.
    SELECT * INTO u FROM public.saldo_favor_usos WHERE id = (p_apartado->>'saldo_uso_id')::bigint;
    IF NOT FOUND THEN RAISE EXCEPTION 'Ese uso del saldo no existe.'; END IF;
    SELECT * INTO r FROM public.app_reservas WHERE id = u.reserva_id;
    v_tipo := 'saldo'; v_id := u.id; v_branch := u.branch_id; v_estado := u.estado; v_listo := u.estado IN ('apartado', 'aplicado');
    v_customer := u.customer_id; v_producto := 'Saldo a favor'; v_codigo := coalesce(r.pedido, 'R-' || lpad(r.id::text, 6, '0'));
    v_total := u.monto; v_pagado := u.monto;
    IF public.saldo_favor_es_efectivo(r.id) THEN v_efectivo := u.monto; ELSE v_otras := u.monto; END IF;
    SELECT to_json(a) INTO v_aplicado FROM public.apartado_aplicaciones a WHERE a.saldo_uso_id = u.id;
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
  IF v_branch <> p_branch_id THEN
    RAISE EXCEPTION '%', CASE WHEN v_tipo = 'saldo' THEN 'Ese saldo se apartó en otra sucursal.' ELSE 'Eso se retira en otra sucursal.' END;
  END IF;
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

CREATE OR REPLACE FUNCTION public.apartado_aplicacion_registrar(p_branch_id bigint, p_apartado jsonb, p_modo text, p_monto numeric, p_credito text, p_movimiento bigint, p_employee uuid, p_entregar boolean)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v_id bigint;
BEGIN
  INSERT INTO public.apartado_aplicaciones (reserva_id, encargo_id, saldo_uso_id, branch_id, modo, monto, credito_erp, movimiento_id, creado_por)
  VALUES ((p_apartado->>'reserva_id')::bigint, (p_apartado->>'encargo_id')::bigint, (p_apartado->>'saldo_uso_id')::bigint,
          p_branch_id, p_modo, round(p_monto, 2), p_credito, p_movimiento, p_employee)
  RETURNING id INTO v_id;
  -- El vale de un saldo a favor no se liga a la reserva: un saldo se aplica
  -- por partes y el movimiento la trabaría (2026-11-21).
  IF p_movimiento IS NOT NULL AND NOT (p_apartado ? 'saldo_uso_id') THEN
    UPDATE public.caja_movimientos_portal
       SET reserva_id = (p_apartado->>'reserva_id')::bigint, encargo_id = (p_apartado->>'encargo_id')::bigint
     WHERE id = p_movimiento;
  END IF;
  IF p_entregar THEN PERFORM public.apartado_marcar_entregado(p_apartado, p_employee); END IF;
  RETURN json_build_object('id', v_id);
END $function$;

CREATE OR REPLACE FUNCTION public.apartado_marcar_entregado(p_apartado jsonb, p_employee uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v_branch bigint; v_reserva bigint;
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
  ELSIF p_apartado ? 'saldo_uso_id' THEN
    -- Saldo a favor (2026-11-21): el vale o el abono ya entraron.
    UPDATE public.saldo_favor_usos SET estado = 'aplicado', aplicado_at = now()
     WHERE id = (p_apartado->>'saldo_uso_id')::bigint AND estado = 'apartado'
    RETURNING branch_id, reserva_id INTO v_branch, v_reserva;
    IF NOT FOUND THEN RAISE EXCEPTION 'Ese saldo no está apartado.'; END IF;
    INSERT INTO public.audit_logs (user_id, action, target_id, details, branch_id, source)
    VALUES (p_employee, 'RESERVA_SALDO_FAVOR_APLICADO', v_reserva::text,
            jsonb_build_object('uso', (p_apartado->>'saldo_uso_id')::bigint), v_branch, 'ADMIN_PANEL');
  ELSE
    UPDATE public.app_encargos SET estado = 'entregado', cerrado_at = now(), updated_at = now(),
           pago_estado = CASE WHEN pago_estado IN ('pendiente', 'anticipo') THEN 'pagado' ELSE pago_estado END,
           pagado_at = coalesce(pagado_at, now())
     WHERE id = (p_apartado->>'encargo_id')::bigint AND estado = 'listo'
    RETURNING branch_id INTO v_branch;
    IF NOT FOUND THEN RAISE EXCEPTION 'Ese encargo no está listo para entregar.'; END IF;
    INSERT INTO public.audit_logs (user_id, action, target_id, details, branch_id, source)
    VALUES (p_employee, 'ENCARGO_ENTREGADO', p_apartado->>'encargo_id', jsonb_build_object('por', 'retiro'), v_branch, 'ADMIN_PANEL');
  END IF;
END $function$;

-- ── Devolver en efectivo espera a lo apartado ──
DO $migra$
DECLARE v_def text; v_n integer;
  v_ancla text := $a$  IF v_motivo IS NULL OR length(v_motivo) < 3 THEN RAISE EXCEPTION 'Escribe el motivo de la devolución.'; END IF;$a$;
BEGIN
  v_def := pg_get_functiondef('public.reserva_saldo_devolver(bigint,text)'::regprocedure);
  v_n := (length(v_def) - length(replace(v_def, v_ancla, ''))) / length(v_ancla);
  IF v_n <> 1 THEN RAISE EXCEPTION 'reserva_saldo_devolver: el fragmento aparece % veces.', v_n; END IF;
  EXECUTE replace(v_def, v_ancla, v_ancla || $b$
  -- (2026-11-21) Una parte apartada para pagar una factura vuelve si se suelta:
  -- con la devolución hecha quedaría en una reserva cerrada.
  IF EXISTS (SELECT 1 FROM public.saldo_favor_usos su WHERE su.reserva_id = p_id AND su.estado = 'apartado') THEN
    RAISE EXCEPTION 'Una parte de este saldo está apartada para una factura. Aplícala o suéltala desde Reservas primero.' USING ERRCODE = 'P0001';
  END IF;$b$);
END $migra$;
