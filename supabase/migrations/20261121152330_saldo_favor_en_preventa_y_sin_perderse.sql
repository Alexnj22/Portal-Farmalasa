-- Saldo a favor: que se vea y se use en Preventa, y que no se pierda (2026-11-21).
--
-- Auditoría del usuario («cómo sale en preventa / venta si tiene saldo a
-- favor»). Hallazgos que se corrigen aquí:
--   · Preventa no decía que el cliente tenía saldo a favor: `preventa_cliente`
--     devuelve ahora `saldos_favor` (los vigentes, de la ficha o de su cuenta
--     unida) y la pantalla lo ofrece;
--   · la vuelta de una hora de `reservas_vigilar` quitaba los puntos aunque
--     una preventa con puntos de ese cliente siguiera esperando en caja: la
--     factura descontaba puntos que ya no había y el saldo volvía a estar
--     disponible (se usaba dos veces). Ahora espera a que no quede ninguna;
--   · un saldo de menos de 100 puntos ($1) no se podía canjear en Preventa y
--     en caja quedaba como irregularidad: con saldo a favor convertido, el
--     mínimo es lo que haya de ese saldo;
--   · una empresa, un cliente genérico o uno fuera del programa convertía el
--     saldo en puntos que nunca podía canjear (y volvían a la hora): ahora se
--     dice al usarlo y se ofrece la devolución;
--   · anular el cobro del anticipo de un encargo que Bodega confirmó más barato
--     (con tarjeta) dejaba vivo el saldo a favor de la diferencia: ahora se
--     anula con el cobro (y si ya se usó, queda anotado).
-- Las funciones grandes se corrigen sobre su definición VIVA (reemplazo de un
-- fragmento que tiene que aparecer exactamente una vez; si no, no se toca).
SET lock_timeout = '5s';

-- ── 1. Usar el saldo: sólo quien puede canjear puntos ──
CREATE OR REPLACE FUNCTION public.reserva_usar_saldo_favor(p_id bigint, p_monto numeric, p_prueba text)
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
  v_cli public.customers;
  v_tit bigint;
  v_modo text;
  v_monto numeric(12,2) := round(coalesce(p_monto, 0), 2);
  v_puntos integer;
  v_queda numeric(12,2);
  v_lote bigint;
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
  IF r.saldo_favor_vence < v_hoy THEN RAISE EXCEPTION 'Ese saldo a favor ya venció'; END IF;

  v_modo := public.cliente_confirma(r.customer_id, p_prueba);
  IF v_modo IS NULL THEN
    RAISE EXCEPTION 'No se pudo confirmar que sea el titular: escanea su tarjeta de Puntos Salud o escribe el DUI o el teléfono de su ficha.';
  END IF;
  IF v_monto <= 0 THEN RAISE EXCEPTION 'Escribe cuánto se usa.'; END IF;
  IF v_monto > r.saldo_favor THEN
    RAISE EXCEPTION 'Tiene % a favor: no se pueden usar %.', to_char(r.saldo_favor, 'FM$999,990.00'), to_char(v_monto, 'FM$999,990.00');
  END IF;

  SELECT * INTO v_cli FROM public.customers WHERE id = r.customer_id;
  -- Se descuenta como un canje de puntos: una ficha que no canjea (convenio)
  -- nunca lo vería registrado.
  IF NOT coalesce(v_cli.acumula_puntos, true) THEN
    RAISE EXCEPTION 'Esta ficha no usa puntos: el saldo a favor no se puede descontar en caja.';
  END IF;
  -- Las mismas reglas con que Preventa deja canjear (`preventa_puntos_del_cliente`,
  -- 2026-11-21): sin esto el saldo se volvía puntos que nadie podía canjear y
  -- regresaba a la hora.
  IF v_cli.tipo_persona IS NOT DISTINCT FROM 'juridica' OR public.cliente_es_generico(v_cli.id)
     OR v_cli.acepta_programa_puntos IS NOT DISTINCT FROM false THEN
    RAISE EXCEPTION 'Este cliente no puede canjear puntos: su saldo a favor se devuelve en efectivo (pídelo desde la reserva).';
  END IF;
  IF public.puntos_fuente() <> 'portal' THEN
    RAISE EXCEPTION 'El programa de puntos no está en el portal: el saldo a favor no se puede descontar.';
  END IF;

  v_sala := coalesce(public.empleado_sala_de_hoy(NULL, v_hoy), public.auth_employee_branch_id());
  v_codigo := coalesce(r.pedido, 'R-' || lpad(r.id::text, 6, '0'));
  v_puntos := round(v_monto * 100)::integer;
  v_tit := public.puntos_titular(r.customer_id);

  INSERT INTO public.puntos_cuenta (customer_id) VALUES (v_tit) ON CONFLICT (customer_id) DO NOTHING;
  PERFORM 1 FROM public.puntos_cuenta WHERE customer_id = v_tit FOR UPDATE;
  INSERT INTO public.puntos_lote (customer_id, origen, puntos, restantes, ganado_el, vence_el, sucursal, motivo, creado_por)
  VALUES (v_tit, 'saldo_favor', v_puntos, v_puntos, v_hoy, greatest(r.saldo_favor_vence, v_hoy),
          (SELECT b.codigo_puntos FROM public.branches b WHERE b.id = v_sala),
          'Saldo a favor de la reserva ' || v_codigo, v_quien)
  RETURNING id INTO v_lote;
  UPDATE public.puntos_cuenta SET saldo = saldo + v_puntos, ganados = ganados + v_puntos, updated_at = now()
   WHERE customer_id = v_tit;

  v_queda := r.saldo_favor - v_monto;
  UPDATE public.app_reservas
     SET saldo_favor_inicial = coalesce(saldo_favor_inicial, saldo_favor),
         saldo_favor = v_queda,
         saldo_favor_usado_at     = CASE WHEN v_queda <= 0 THEN now() ELSE saldo_favor_usado_at END,
         saldo_favor_usado_por    = CASE WHEN v_queda <= 0 THEN v_quien ELSE saldo_favor_usado_por END,
         saldo_favor_usado_branch = CASE WHEN v_queda <= 0 THEN v_sala ELSE saldo_favor_usado_branch END,
         updated_at = now()
   WHERE id = p_id;

  INSERT INTO public.saldo_favor_movimientos (reserva_id, tipo, monto, saldo_despues, branch_id, employee_id, puntos_lote_id, confirmado_con)
  VALUES (p_id, 'uso', v_monto, v_queda, v_sala, v_quien, v_lote, v_modo);

  INSERT INTO public.audit_logs (action, target_id, details, branch_id, user_id)
  VALUES ('RESERVA_SALDO_FAVOR_USADO', p_id::text,
          jsonb_build_object('monto', v_monto, 'queda', v_queda, 'puntos', v_puntos, 'lote', v_lote,
                             'confirmado_con', v_modo, 'sala_de_la_reserva', r.branch_id),
          v_sala, v_quien);

  RETURN json_build_object('ok', true, 'monto', v_monto, 'puntos', v_puntos, 'queda', v_queda,
                           'cliente', v_cli.name, 'codigo', v_codigo, 'confirmado_con', v_modo);
END $function$;

-- ── 2. Los puntos en Preventa: con saldo a favor convertido, el mínimo es ese saldo ──
CREATE OR REPLACE FUNCTION public.preventa_puntos_del_cliente(p_customer bigint, p_excluir bigint DEFAULT NULL::bigint)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE c public.customers; v_saldo int; v_comp int; v_min int; v_puede boolean; v_sf int;
BEGIN
  SELECT * INTO c FROM public.customers WHERE id = p_customer;
  IF NOT FOUND THEN
    RETURN json_build_object('puede_canjear', false, 'saldo', 0, 'comprometidos', 0, 'disponibles', 0,
                             'minimo_canje', 100, 'tope', 10000, 'valor', 0.01, 'de_saldo_favor', 0);
  END IF;
  v_saldo := coalesce((public.puntos_estado_cuenta(c.id)->>'saldo')::numeric, 0)::int;
  SELECT coalesce(sum((pv.venta->>'puntos')::int), 0) INTO v_comp
    FROM public.preventas pv
   WHERE pv.customer_id = c.id AND pv.origen = 'directa' AND pv.estado IN ('enviando', 'viva', 'sin_enlace')
     AND pv.id IS DISTINCT FROM p_excluir AND coalesce((pv.venta->>'puntos')::int, 0) > 0;
  SELECT coalesce(minimo_canje, 100) INTO v_min FROM public.puntos_config LIMIT 1;
  -- Saldo a favor ya convertido en puntos (2026-11-21): se canjea entero
  -- aunque sea menos que el mínimo (un saldo de $0.60 no tenía cómo usarse).
  SELECT coalesce(sum(l.restantes), 0)::int INTO v_sf
    FROM public.puntos_lote l
   WHERE l.customer_id = public.puntos_titular(c.id) AND l.origen = 'saldo_favor' AND l.restantes > 0;
  IF v_sf > 0 THEN v_min := least(coalesce(v_min, 100), v_sf); END IF;
  v_puede := NOT public.cliente_es_generico(c.id) AND coalesce(c.acumula_puntos, true)
             AND c.acepta_programa_puntos IS DISTINCT FROM false AND c.tipo_persona IS DISTINCT FROM 'juridica';
  RETURN json_build_object('puede_canjear', v_puede, 'saldo', v_saldo, 'comprometidos', v_comp,
                           'disponibles', greatest(v_saldo - v_comp, 0), 'minimo_canje', coalesce(v_min, 100),
                           'tope', 10000, 'valor', 0.01, 'de_saldo_favor', v_sf);
END $function$;

-- ── 3. Correcciones sobre la definición viva ──
DO $migra$
DECLARE
  v_def text; v_ancla text; v_nuevo text; v_n integer;
  -- Reemplaza `ancla` por `nuevo` en la definición viva de `fn`; exige una sola aparición.
  c record;
BEGIN
  FOR c IN SELECT * FROM (VALUES
    -- 3a. Preventa: los saldos a favor vigentes del cliente.
    ('public.preventa_cliente(bigint,bigint)',
     $a$    'puntos', public.preventa_puntos_del_cliente(c.id),$a$,
     $b$    'puntos', public.preventa_puntos_del_cliente(c.id),
    -- Saldos a favor vigentes (2026-11-21): de la ficha o de su cuenta unida.
    -- Usarlo pide confirmar al titular (`reserva_usar_saldo_favor`).
    'saldos_favor', (SELECT coalesce(json_agg(json_build_object('id', r.id, 'codigo', coalesce(r.pedido, 'R-' || lpad(r.id::text, 6, '0')),
                        'monto', r.saldo_favor, 'vence', r.saldo_favor_vence) ORDER BY r.saldo_favor_vence, r.id), '[]'::json)
                       FROM public.app_reservas r
                      WHERE (r.customer_id = c.id OR public.puntos_titular(r.customer_id) = public.puntos_titular(c.id))
                        AND coalesce(r.saldo_favor, 0) > 0 AND r.saldo_favor_usado_at IS NULL AND r.saldo_favor_devuelto_at IS NULL
                        AND r.devolucion_pedida_at IS NULL AND r.saldo_favor_vence >= v_hoy),$b$),
    -- 3b. El canje de un saldo a favor chico no es una irregularidad.
    ('public.puntos_registrar_canje(bigint,boolean)',
     $a$  IF v_puntos < coalesce(v_minimo, 100) THEN$a$,
     $b$  -- Un saldo a favor convertido se canjea entero aunque sea chico (2026-11-21).
  IF v_puntos < coalesce(v_minimo, 100)
     AND NOT EXISTS (SELECT 1 FROM public.puntos_lote pl WHERE pl.customer_id = public.puntos_titular(v.customer_id)
                       AND pl.origen = 'saldo_favor' AND pl.restantes > 0) THEN$b$),
    -- 3c. La vuelta de una hora espera a que no quede una preventa con puntos.
    ('public.reservas_vigilar()',
     $a$     ORDER BY mv.id
     FOR UPDATE OF l SKIP LOCKED$a$,
     $b$       -- Con una preventa de ese cliente esperando en caja con puntos
       -- (2026-11-21), todavía se va a canjear: quitarlos ahora dejaba la
       -- factura sin puntos y el saldo disponible otra vez.
       AND NOT EXISTS (SELECT 1 FROM public.preventas pv
                        WHERE pv.origen = 'directa' AND pv.estado IN ('enviando', 'viva', 'sin_enlace')
                          AND coalesce((pv.venta->>'puntos')::int, 0) > 0
                          AND public.puntos_titular(pv.customer_id) = l.customer_id)
     ORDER BY mv.id
     FOR UPDATE OF l SKIP LOCKED$b$),
    -- 3d. El saldo de la diferencia queda anotado en el cobro que lo originó.
    ('public.encargo_responder(bigint,text,numeric,date,text)',
     $a$        v_abonado := v_total;
$a$,
     $b$        v_abonado := v_total;
        -- Si se anula ese cobro, el saldo se anula con él (`apartado_deshacer`).
        UPDATE public.caja_movimientos_portal
           SET apartado_previo = coalesce(apartado_previo, '{}'::jsonb) || jsonb_build_object('saldo_diferencia', v_saldo)
         WHERE encargo_id = e.id AND tipo_codigo = 'APARTADO' AND anulado_at IS NULL;
$b$),
    -- 3e. Anular el cobro anula el saldo de la diferencia (o lo anota si ya se usó).
    ('public.apartado_deshacer(bigint,boolean)',
     $a$  IF m.encargo_id IS NOT NULL THEN
    UPDATE public.app_encargos$a$,
     $b$  IF m.encargo_id IS NOT NULL AND v_prev ? 'saldo_diferencia' THEN
    -- El saldo a favor de la diferencia de precio (2026-11-21) nació de este cobro.
    SELECT * INTO r FROM public.app_reservas WHERE id = (v_prev->>'saldo_diferencia')::bigint FOR UPDATE;
    IF FOUND AND coalesce(r.saldo_favor, 0) > 0 AND r.saldo_favor_usado_at IS NULL AND r.saldo_favor_devuelto_at IS NULL
       AND r.saldo_favor >= coalesce(r.saldo_favor_inicial, r.saldo_favor) THEN
      UPDATE public.app_reservas
         SET saldo_favor_inicial = coalesce(saldo_favor_inicial, saldo_favor), saldo_favor = 0, updated_at = now()
       WHERE id = r.id;
      INSERT INTO public.saldo_favor_movimientos (reserva_id, tipo, monto, saldo_despues, branch_id, employee_id, nota)
      VALUES (r.id, 'anulacion', r.saldo_favor, 0, r.branch_id, public.auth_employee_id(),
              format('Se anuló el cobro %s que lo originó.', m.id));
    ELSIF FOUND THEN
      PERFORM public.saldo_favor_anotar('saldo_diferencia_anulada:' || m.id, 'saldo_favor_sin_respaldo', r.customer_id,
        r.branch_id, NULL, NULL, coalesce(r.saldo_favor_inicial, r.saldo_favor),
        format('Se anuló el cobro %s, pero el saldo a favor %s que nació de él ya se usó o se devolvió.',
               m.id, 'R-' || lpad(r.id::text, 6, '0')),
        jsonb_build_object('reserva_id', r.id, 'movimiento', m.id));
    END IF;
  END IF;
  IF m.encargo_id IS NOT NULL THEN
    UPDATE public.app_encargos$b$)
  ) AS t(fn, ancla, nuevo)
  LOOP
    v_def := pg_get_functiondef(c.fn::regprocedure);
    v_n := (length(v_def) - length(replace(v_def, c.ancla, ''))) / length(c.ancla);
    IF v_n <> 1 THEN
      RAISE EXCEPTION 'En % el fragmento aparece % veces (se esperaba 1): no se toca nada.', c.fn, v_n;
    END IF;
    EXECUTE replace(v_def, c.ancla, c.nuevo);
  END LOOP;
END $migra$;
