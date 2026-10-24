-- Reservas v2 · 01 — los plazos del Reglamento de reservas y encargos especiales.
--
-- QUÉ CAMBIA (sólo desde `reglas_v2_desde()`, hoy 2026-11-15, fecha de El Salvador):
--   · Plazo para retirar según lo PAGADO, no según el origen:
--       sin pago 7 días · con anticipo 30 · pagada completa 60 (cláusula 3.4).
--     Corre desde el aviso de que está lista; si se paga después, pasa al que
--     corresponda CONTADO DESDE ESE PAGO (3.4, último párrafo).
--   · Encargo recibido: 60 días (4.5).
--   · Sin prórroga (6.4): las cuatro funciones de prórroga rechazan, y
--     `reserva_prorrogable` / `encargo_prorrogable` (campos calculados que leen
--     el portal, la app del personal y la app de clientes) dicen `false`.
--   · Saldo a favor: 365 días desde que se genera (8.2).
--
-- DÓNDE: el plazo por lo pagado lo pone UN solo sitio, el trigger que ya existe
-- (`app_reservas_guardas`, BEFORE INSERT OR UPDATE): así lo respetan todos los
-- caminos que marcan lista o cobran —`reserva_cambiar_estado`,
-- `reserva_sumar_llegada`, `reserva_precio_de_bodega`, `reserva_ajustar`,
-- `apartado_aplicar` (nueva / pedido / reserva), `apartado_enlace_preparar`,
-- `app_reserva_pago_confirmar` (anticipo y total en línea), `apartado_deshacer` y
-- `apartado_cambiar_monto`— sin reescribir ninguno. Reemplazar la función del
-- trigger no es DDL sobre la tabla: no toma lock sobre `app_reservas`.
--
-- ANTES DE LA FECHA: idéntico a hoy. Cada rama nueva pregunta
-- `reservas_v2_rige(<cuándo empezó el plazo>)`: una reserva cuyo plazo empezó
-- antes de la fecha (R-000114, lista en octubre, vence el 30-oct) conserva su
-- regla aunque se toque después.
--
-- CÓMO SE VERIFICÓ: en el branch de pruebas con `execute_sql`, con casos
-- fabricados antes y después de la fecha dentro de una transacción que se
-- deshace sola (la fecha se movió adentro, no para las otras tandas).
SET lock_timeout = '5s';

-- ── La fecha común (la crea la tanda de PUNTOS; idéntica e idempotente) ──────
ALTER TABLE public.puntos_config ADD COLUMN IF NOT EXISTS reglas_v2_desde date NOT NULL DEFAULT '2026-11-15';
CREATE OR REPLACE FUNCTION public.reglas_v2_desde() RETURNS date LANGUAGE sql STABLE
SET search_path = public, extensions AS $$ SELECT reglas_v2_desde FROM public.puntos_config LIMIT 1 $$;
REVOKE EXECUTE ON FUNCTION public.reglas_v2_desde() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reglas_v2_desde() TO authenticated, service_role;

-- ¿Rige el reglamento v2 en ese momento? En fecha de El Salvador, como
-- `acumula_por_renglon_desde`. Sin fecha configurada, NO rige (falla segura).
CREATE OR REPLACE FUNCTION public.reservas_v2_rige(p_en timestamptz DEFAULT now())
RETURNS boolean LANGUAGE sql STABLE
SET search_path = public, extensions AS $$
  SELECT coalesce((coalesce(p_en, now()) AT TIME ZONE 'America/El_Salvador')::date >= public.reglas_v2_desde(), false);
$$;
REVOKE EXECUTE ON FUNCTION public.reservas_v2_rige(timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reservas_v2_rige(timestamptz) TO authenticated, service_role;

-- Días para retirar según lo pagado (cláusula 3.4). Sólo v2.
CREATE OR REPLACE FUNCTION public.reserva_dias_retiro(p_pago_estado text, p_anticipo numeric)
RETURNS integer LANGUAGE sql IMMUTABLE
SET search_path = public, extensions AS $$
  SELECT CASE WHEN p_pago_estado = 'pagado' THEN 60
              WHEN p_pago_estado = 'anticipo' OR coalesce(p_anticipo, 0) > 0.004 THEN 30
              ELSE 7 END;
$$;
REVOKE EXECUTE ON FUNCTION public.reserva_dias_retiro(text, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reserva_dias_retiro(text, numeric) TO authenticated, service_role;

-- ── El saldo a favor: 60 días (v1) → 1 año (v2), desde que se genera ─────────
-- IMMUTABLE → STABLE: ahora depende de la fecha. Se evalúa al GENERAR el saldo
-- (`v_hoy + saldo_favor_dias()`), así que un saldo de octubre conserva sus 60.
CREATE OR REPLACE FUNCTION public.saldo_favor_dias()
RETURNS integer LANGUAGE sql STABLE
SET search_path TO 'public', 'extensions'
AS $function$ SELECT CASE WHEN public.reservas_v2_rige() THEN 365 ELSE 60 END $function$;

-- ── Los plazos: los mismos campos, con los valores de la regla que rige hoy ──
-- (IMMUTABLE → STABLE por lo mismo.) En v2 casi nadie los lee para el plazo de
-- retiro —lo pone el trigger—, pero quien los lea no tiene que ver la regla vieja.
CREATE OR REPLACE FUNCTION public.reserva_plazos(OUT dias_pagada integer, OUT dias_apartado integer, OUT horas_sin_foto integer, OUT horas_receta_sin_revisar integer, OUT horas_para_preparar integer, OUT dias_saldo_favor integer, OUT dias_sin_pagar integer, OUT dias_prorroga integer, OUT dias_encargo integer)
 RETURNS record
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  -- v1 (hasta `reglas_v2_desde()`): pagada en línea o apartada en caja 7 días;
  -- app sin la foto de la receta 24 h; foto sin revisar 24 h; sin preparar
  -- 24 h; app sin pagar 3 días; una prórroga de 7; encargo que llegó 7.
  -- v2 (Reglamento de reservas, cl. 3.4, 4.5, 6.4 y 8.2): pagada 60, con
  -- anticipo 30, sin pago 7, sin prórroga, encargo recibido 60, saldo 1 año.
  SELECT CASE WHEN v THEN 60 ELSE 7 END, CASE WHEN v THEN 30 ELSE 7 END, 24, 24, 24,
         public.saldo_favor_dias(), CASE WHEN v THEN 7 ELSE 3 END, CASE WHEN v THEN 0 ELSE 7 END,
         CASE WHEN v THEN 60 ELSE 7 END
    FROM (SELECT public.reservas_v2_rige() AS v) x;
$function$;

-- Lo que la reserva tendrá al marcarla lista AHORA (lo muestra la sala).
CREATE OR REPLACE FUNCTION public.reserva_horas_al_preparar(r app_reservas)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT CASE
              -- v2: según lo pagado, para todos los orígenes (cláusula 3.4).
              WHEN public.reservas_v2_rige() THEN public.reserva_dias_retiro(r.pago_estado, r.anticipo) * 24
              WHEN r.pago_estado = 'pagado' THEN (SELECT p.dias_pagada * 24 FROM public.reserva_plazos() p)
              -- Apartado en sala (2026-10-22): sus 7 días, no las horas de la app.
              WHEN r.origen = 'sucursal' THEN (SELECT p.dias_apartado * 24 FROM public.reserva_plazos() p)
              -- App sin pagar: 3 días para todos (reglamento v2, 2026-10-22).
              ELSE (SELECT p.dias_sin_pagar * 24 FROM public.reserva_plazos() p) END;
$function$;

-- ── El trigger de siempre, más el plazo por lo pagado (v2) ───────────────────
CREATE OR REPLACE FUNCTION public.app_reservas_guardas()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_cerradas constant text[] := ARRAY['cancelada', 'vencida'];
  v_hoy date := (now() AT TIME ZONE 'America/El_Salvador')::date;
  v_dias integer;
  v_antes integer;
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- La regla del libro, decidida acá: lo que mande la app no cuenta.
    NEW.bajo_receta := public.clase_de_dispensacion(NEW.producto_id::int) IS NOT NULL;
    IF NEW.origen = 'app' AND NEW.bajo_receta AND NEW.estado = 'pendiente' THEN
      NEW.estado := 'en_revision';
    END IF;
  END IF;

  -- Desde cuándo espera que la preparen (48 h, `reservas_vencer`).
  IF NEW.estado = 'pendiente' AND (TG_OP = 'INSERT' OR OLD.estado IS DISTINCT FROM 'pendiente') THEN
    NEW.pendiente_at := now();
  END IF;

  -- Sin la receta aprobada no se prepara, no se marca lista ni se entrega.
  -- (El pago no se frena acá: un cobro que llega nunca se puede perder.)
  IF NEW.origen = 'app' AND NEW.bajo_receta AND NEW.estado IN ('pendiente', 'lista', 'retirada')
     AND NEW.receta_estado IS DISTINCT FROM 'aprobada'
     AND (TG_OP = 'INSERT' OR OLD.estado IS DISTINCT FROM NEW.estado) THEN
    RAISE EXCEPTION 'La receta de esta reserva todavía no está aprobada.' USING ERRCODE = 'P0001';
  END IF;

  -- Reglamento v2 (desde `reglas_v2_desde()`), cláusula 3.4: el plazo para
  -- retirar depende de lo PAGADO —sin pago 7, anticipo 30, total 60— y corre
  -- desde el aviso de que está lista; si el cliente paga después, pasa al que
  -- corresponda CONTADO DESDE ESE PAGO. Sólo si el plazo empezó (`lista_at`)
  -- cuando ya regía v2: lo que empezó antes conserva su regla.
  IF NEW.estado = 'lista' AND NEW.lista_at IS NOT NULL AND public.reservas_v2_rige(NEW.lista_at) THEN
    v_dias := public.reserva_dias_retiro(NEW.pago_estado, NEW.anticipo);
    IF TG_OP = 'INSERT' OR OLD.estado IS DISTINCT FROM 'lista' OR OLD.lista_at IS DISTINCT FROM NEW.lista_at THEN
      NEW.vence_at := NEW.lista_at + make_interval(days => v_dias);
    ELSE
      v_antes := public.reserva_dias_retiro(OLD.pago_estado, OLD.anticipo);
      IF v_dias > v_antes OR coalesce(NEW.anticipo, 0) > coalesce(OLD.anticipo, 0) + 0.004 THEN
        -- Pagó (o pagó más): desde este pago, nunca menos de lo que ya tenía.
        NEW.vence_at := greatest(coalesce(OLD.vence_at, NEW.lista_at), now() + make_interval(days => v_dias));
      ELSIF v_dias < v_antes THEN
        -- Se anuló o corrigió el cobro: el plazo vuelve al de lo que queda pagado.
        NEW.vence_at := CASE WHEN v_dias = 7 THEN NEW.lista_at
                             ELSE greatest(NEW.lista_at, coalesce(NEW.pagado_at, NEW.lista_at)) END
                        + make_interval(days => v_dias);
      END IF;
    END IF;
  END IF;

  -- Lo pagado en línea que se cierra (la sala la cancela, vence, o el pago
  -- llega cuando ya estaba cerrada) queda A FAVOR del cliente (punto 6). El
  -- envío, si el pedido entero se cerró, lo suma `app_reservas_saldo_envio`.
  -- Un cobro de PRUEBA no es dinero: no deja saldo.
  IF TG_OP = 'UPDATE' AND NEW.estado = ANY (v_cerradas) AND NEW.pago_estado = 'pagado'
     AND NEW.pago_metodo = 'en_linea' AND NOT NEW.pago_prueba AND NEW.saldo_favor IS NULL
     AND (NOT (OLD.estado = ANY (v_cerradas)) OR OLD.pago_estado IS DISTINCT FROM 'pagado') THEN
    NEW.saldo_favor := round(coalesce(NEW.precio_unitario, 0) * NEW.cantidad, 2);
    NEW.saldo_favor_vence := v_hoy + public.saldo_favor_dias();
    NEW.saldo_favor_origen := CASE WHEN OLD.estado = ANY (v_cerradas) THEN 'pago_tardio' ELSE 'pago_en_linea' END;
    IF NEW.saldo_favor <= 0 THEN
      NEW.saldo_favor := NULL; NEW.saldo_favor_vence := NULL; NEW.saldo_favor_origen := NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

-- ── Encargo recibido: 7 (+7 de prórroga) → 60 días, según cuándo LLEGÓ ───────
CREATE OR REPLACE FUNCTION public.encargo_retirar_hasta(e app_encargos)
 RETURNS date
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT CASE WHEN e.estado = 'listo' AND e.listo_at IS NOT NULL THEN
    ((e.listo_at AT TIME ZONE 'America/El_Salvador')::date
      + CASE WHEN public.reservas_v2_rige(e.listo_at) THEN 60   -- reglamento v2, cl. 4.5
             ELSE 7 + CASE WHEN e.prorrogado_at IS NOT NULL THEN 7 ELSE 0 END END) END;
$function$;

-- ── ¿Se puede prorrogar? La regla la dice la base, no una fecha en el cliente ─
CREATE OR REPLACE FUNCTION public.reserva_prorrogable(r app_reservas)
RETURNS boolean LANGUAGE sql STABLE
SET search_path = public, extensions AS $$
  SELECT r.estado = 'lista' AND r.vence_at IS NOT NULL AND r.prorrogada_at IS NULL AND NOT public.reservas_v2_rige();
$$;
REVOKE EXECUTE ON FUNCTION public.reserva_prorrogable(app_reservas) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reserva_prorrogable(app_reservas) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.encargo_prorrogable(e app_encargos)
RETURNS boolean LANGUAGE sql STABLE
SET search_path = public, extensions AS $$
  SELECT e.estado = 'listo' AND e.prorrogado_at IS NULL AND NOT public.reservas_v2_rige();
$$;
REVOKE EXECUTE ON FUNCTION public.encargo_prorrogable(app_encargos) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.encargo_prorrogable(app_encargos) TO authenticated, service_role;

-- ── Las reglas que rigen hoy, para la pantalla y el papel ────────────────────
-- Una sola lectura: el portal y las apps imprimen y muestran lo que diga esto,
-- nunca una fecha escrita en el cliente.
CREATE OR REPLACE FUNCTION public.reserva_reglas()
RETURNS json LANGUAGE sql STABLE
SET search_path = public, extensions AS $$
  SELECT json_build_object(
    'v2', v, 'desde', public.reglas_v2_desde(),
    'dias_sin_pago', CASE WHEN v THEN 7 ELSE 3 END,
    'dias_anticipo', CASE WHEN v THEN 30 ELSE 7 END,
    'dias_pagada', CASE WHEN v THEN 60 ELSE 7 END,
    'dias_encargo', CASE WHEN v THEN 60 ELSE 7 END,
    'dias_saldo_favor', public.saldo_favor_dias(),
    'prorroga_dias', CASE WHEN v THEN 0 ELSE 7 END)
  FROM (SELECT public.reservas_v2_rige() AS v) x;
$$;
REVOKE EXECUTE ON FUNCTION public.reserva_reglas() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reserva_reglas() TO authenticated, service_role;

-- ── Las cuatro prórrogas: desde la fecha, «los plazos no se prorrogan» (6.4) ─
CREATE OR REPLACE FUNCTION public.reserva_prorrogar(p_id bigint)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE r public.app_reservas; v_emp uuid := public.auth_employee_id(); v_vence timestamptz; v_codigo text;
BEGIN
  -- Reglamento v2, cláusula 6.4: los plazos para retirar no se prorrogan.
  IF public.reservas_v2_rige() THEN
    RAISE EXCEPTION 'Los plazos para retirar ya no se prorrogan.' USING ERRCODE = 'P0001';
  END IF;
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

CREATE OR REPLACE FUNCTION public.reserva_prorrogar_por_cliente(p_id bigint, p_customer bigint)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE r public.app_reservas; v_vence timestamptz; v_codigo text; v_dest uuid[];
BEGIN
  -- Reglamento v2, cláusula 6.4: los plazos para retirar no se prorrogan.
  IF public.reservas_v2_rige() THEN
    RETURN json_build_object('ok', false, 'mensaje', 'Los plazos para retirar no se prorrogan.');
  END IF;
  SELECT * INTO r FROM public.app_reservas WHERE id = p_id AND customer_id = p_customer FOR UPDATE;
  IF NOT FOUND OR r.estado <> 'lista' OR r.vence_at IS NULL THEN
    RETURN json_build_object('ok', false, 'mensaje', 'Sólo se puede pedir más plazo cuando la reserva ya está lista para retirar.');
  END IF;
  IF r.prorrogada_at IS NOT NULL THEN
    RETURN json_build_object('ok', false, 'mensaje', 'Esta reserva ya tuvo su prórroga: no admite otra.');
  END IF;
  UPDATE public.app_reservas
     SET vence_at = vence_at + make_interval(days => (SELECT p.dias_prorroga FROM public.reserva_plazos() p)),
         prorrogada_at = now(), updated_at = now()
   WHERE id = p_id RETURNING vence_at INTO v_vence;
  v_codigo := coalesce(r.pedido, 'R-' || lpad(p_id::text, 6, '0'));
  INSERT INTO public.audit_logs (action, target_id, details, branch_id, source)
  VALUES ('RESERVA_PRORROGADA', p_id::text, jsonb_build_object('antes', r.vence_at, 'ahora', v_vence, 'desde', 'app', 'customer_id', p_customer), r.branch_id, 'SYSTEM');
  v_dest := public.destinatarios_de_reservas(r.branch_id);
  IF v_dest IS NOT NULL THEN
    PERFORM public.notify_employees(v_dest, 'RESERVA_APP', 'Prórroga de ' || v_codigo,
      'El cliente pidió más plazo desde la app: retira hasta el '
        || to_char((v_vence AT TIME ZONE 'America/El_Salvador')::date, 'DD/MM/YYYY') || '. Sigue separada.',
      '/reservas', jsonb_build_object('check_key', 'reserva_prorroga_cliente:' || p_id, 'reserva_id', p_id),
      false, r.branch_id::integer);
  END IF;
  RETURN json_build_object('ok', true, 'vence_at', v_vence);
END $function$;

CREATE OR REPLACE FUNCTION public.encargo_prorrogar(p_id bigint)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE e public.app_encargos; v_emp uuid := public.auth_employee_id();
BEGIN
  -- Reglamento v2, cláusula 6.4: los plazos para retirar no se prorrogan.
  IF public.reservas_v2_rige() THEN
    RAISE EXCEPTION 'Los plazos para retirar ya no se prorrogan.' USING ERRCODE = 'P0001';
  END IF;
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

CREATE OR REPLACE FUNCTION public.encargo_prorrogar_por_cliente(p_id bigint, p_customer bigint)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE e public.app_encargos; v_dest uuid[];
BEGIN
  -- Reglamento v2, cláusula 6.4: los plazos para retirar no se prorrogan.
  IF public.reservas_v2_rige() THEN
    RETURN json_build_object('ok', false, 'mensaje', 'Los plazos para retirar no se prorrogan.');
  END IF;
  SELECT * INTO e FROM public.app_encargos WHERE id = p_id AND customer_id = p_customer FOR UPDATE;
  IF NOT FOUND OR e.estado <> 'listo' THEN
    RETURN json_build_object('ok', false, 'mensaje', 'Sólo se puede pedir más plazo cuando el encargo ya llegó.');
  END IF;
  IF e.prorrogado_at IS NOT NULL THEN
    RETURN json_build_object('ok', false, 'mensaje', 'Este encargo ya tuvo su prórroga: no admite otra.');
  END IF;
  UPDATE public.app_encargos SET prorrogado_at = now(), aviso_sin_retirar_at = NULL, updated_at = now()
   WHERE id = p_id RETURNING * INTO e;
  INSERT INTO public.audit_logs (action, target_id, details, branch_id, source)
  VALUES ('ENCARGO_PRORROGADO', p_id::text, jsonb_build_object('hasta', public.encargo_retirar_hasta(e), 'desde', 'app', 'customer_id', p_customer), e.branch_id, 'SYSTEM');
  v_dest := public.destinatarios_de_reservas(e.branch_id);
  IF v_dest IS NOT NULL THEN
    PERFORM public.notify_employees(v_dest, 'RESERVA_APP', 'Prórroga de un encargo',
      coalesce(e.producto_nombre, 'Un encargo') || ': el cliente pidió más plazo desde la app. Retira hasta el '
        || to_char(public.encargo_retirar_hasta(e), 'DD/MM/YYYY') || '.',
      '/reservas', jsonb_build_object('check_key', 'encargo_prorroga_cliente:' || p_id, 'encargo_id', p_id),
      false, e.branch_id::integer);
  END IF;
  RETURN json_build_object('ok', true, 'retirar_hasta', public.encargo_retirar_hasta(e));
END $function$;
