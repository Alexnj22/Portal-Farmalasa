-- Reservas: aviso a la sala ANTES de que una reserva de la app se cierre sola
-- (2026-10-26, opción A elegida por el usuario). Se mantiene el cierre a las
-- 24 h del reglamento; lo nuevo es la sección 6 de `reservas_vigilar`.
-- Parte de la definición VIVA (pg_get_functiondef).
SET lock_timeout = '5s';

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
  v_detenidas integer := 0;
  v_por_vencer integer := 0;
  v_hora integer := extract(hour FROM now() AT TIME ZONE 'America/El_Salvador')::integer;
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

  -- 4 · reservas detenidas (2026-10-26). Mientras lo que falta viene en
  -- camino el plazo de preparación se detiene (reglamento 3.5) y la reserva
  -- no vence sola; una pedida en la sala sin existencia tampoco tiene plazo.
  -- Si en 7 días no se movió, a la sala se le avisa una vez por semana: el
  -- cliente está esperando algo que puede no llegar nunca.
  FOR x IN
    SELECT ar.id, ar.branch_id, ar.producto_nombre, coalesce(ar.pedido, 'R-' || lpad(ar.id::text, 6, '0')) AS codigo,
           greatest(coalesce(ar.pendiente_at, ar.created_at), coalesce(ar.traslado_cambio_at, ar.created_at)) AS desde
      FROM public.app_reservas ar
     WHERE ar.estado = 'pendiente' AND public.reserva_plazo_hasta(ar) IS NULL
       AND greatest(coalesce(ar.pendiente_at, ar.created_at), coalesce(ar.traslado_cambio_at, ar.created_at)) < now() - interval '7 days'
  LOOP
    v_clave := 'reserva_detenida:' || x.id || ':' || to_char(v_hoy, 'IYYY-IW');
    CONTINUE WHEN EXISTS (SELECT 1 FROM public.notifications n
                           WHERE n.metadata ? 'check_key' AND n.metadata->>'check_key' = v_clave);
    v_dest := public.destinatarios_de_reservas(x.branch_id);
    CONTINUE WHEN v_dest IS NULL;
    PERFORM public.notify_employees(v_dest, 'RESERVA_APP',
      'Reserva detenida · ' || x.codigo,
      coalesce(x.producto_nombre, 'Una reserva') || ' lleva ' || (v_hoy - (x.desde AT TIME ZONE 'America/El_Salvador')::date)
        || ' días esperando lo que falta. Revisa el traslado o el pedido a Bodega, y llama al cliente: puede esperar o cancelarla.',
      '/reservas', jsonb_build_object('check_key', v_clave, 'reserva_id', x.id), true, x.branch_id::integer);
    v_detenidas := v_detenidas + 1;
  END LOOP;

  -- 5 · encargos cuya fecha estimada ya pasó sin que llegaran. La fecha no es
  -- garantizada, pero si cambia hay que avisarle al cliente (reglamento 4.4).
  FOR x IN
    SELECT e.id, e.branch_id, e.producto_nombre, e.fecha_estimada
      FROM public.app_encargos e
     WHERE e.estado IN ('aceptado', 'pedido') AND e.fecha_estimada IS NOT NULL AND e.fecha_estimada < v_hoy
  LOOP
    v_clave := 'encargo_fecha_pasada:' || x.id || ':' || x.fecha_estimada;
    CONTINUE WHEN EXISTS (SELECT 1 FROM public.notifications n
                           WHERE n.metadata ? 'check_key' AND n.metadata->>'check_key' = v_clave);
    v_dest := public.destinatarios_de_reservas(x.branch_id);
    CONTINUE WHEN v_dest IS NULL;
    PERFORM public.notify_employees(v_dest, 'ENCARGO_APP',
      'Encargo atrasado · E-' || lpad(x.id::text, 6, '0'),
      coalesce(x.producto_nombre, 'Un encargo') || ' debía llegar el ' || to_char(x.fecha_estimada, 'DD/MM')
        || ' y no ha llegado. Cambia la fecha estimada (el cliente recibe el aviso) o marca que el proveedor no entregó.',
      '/reservas', jsonb_build_object('check_key', v_clave, 'encargo_id', x.id), true, x.branch_id::integer);
  END LOOP;

  -- 6 · lo que la SALA tiene que mover antes de que se cierre solo (2026-10-26).
  -- Reglamento, cláusula 3: si la sucursal no prepara la reserva o no revisa la receta
  -- en sus 24 h, se cierra sin consecuencia para el cliente — y él pierde lo
  -- que ya estaba apartado. El aviso de `reservas_vencer` llega DESPUÉS; éste,
  -- seis horas antes. Este cron no corre de noche: a partir de las 21:00 se
  -- avisa también lo que vence antes de las 13:00 del día siguiente.
  FOR x IN
    SELECT DISTINCT ON (coalesce(ar.pedido, ar.id::text))
           ar.id, ar.branch_id, ar.producto_nombre, ar.estado, ar.traslado_estado, coalesce(ar.traslado_llegaron, 0) AS llegaron,
           coalesce(ar.pedido, 'R-' || lpad(ar.id::text, 6, '0')) AS codigo, public.reserva_plazo_hasta(ar) AS hasta
      FROM public.app_reservas ar
     WHERE ar.origen = 'app'
       AND (ar.estado = 'pendiente' OR (ar.estado = 'en_revision' AND ar.receta_estado = 'pendiente'))
       AND public.reserva_plazo_hasta(ar) > now()
       AND (public.reserva_plazo_hasta(ar) <= now() + interval '6 hours'
            OR (v_hora >= 21 AND public.reserva_plazo_hasta(ar)
                  <= (((v_hoy + 1)::timestamp + interval '13 hours') AT TIME ZONE 'America/El_Salvador')))
     ORDER BY coalesce(ar.pedido, ar.id::text), public.reserva_plazo_hasta(ar)
  LOOP
    v_clave := 'reserva_por_vencer_sala:' || x.id || ':' || to_char(x.hasta, 'YYYYMMDDHH24MI');
    CONTINUE WHEN EXISTS (SELECT 1 FROM public.notifications n
                           WHERE n.metadata ? 'check_key' AND n.metadata->>'check_key' = v_clave);
    v_dest := public.destinatarios_de_reservas(x.branch_id);
    CONTINUE WHEN v_dest IS NULL;
    v_nota := to_char(x.hasta AT TIME ZONE 'America/El_Salvador',
                      CASE WHEN (x.hasta AT TIME ZONE 'America/El_Salvador')::date = v_hoy THEN 'HH24:MI' ELSE 'DD/MM HH24:MI' END);
    PERFORM public.notify_employees(v_dest, 'RESERVA_APP',
      CASE WHEN x.estado = 'en_revision' THEN 'Receta por revisar · ' ELSE 'Reserva por cerrarse · ' END || x.codigo,
      CASE
        WHEN x.estado = 'en_revision' THEN
          'La receta de ' || coalesce(x.producto_nombre, 'una reserva') || ' espera revisión. Si no se revisa antes de las ' || v_nota || ', la reserva se cierra sola.'
        WHEN x.traslado_estado = 'precio' THEN
          'Bodega dio otro precio para ' || coalesce(x.producto_nombre, 'una reserva') || '. Llama al cliente para que decida antes de las ' || v_nota || '; si no, la reserva se cierra sola.'
        WHEN x.traslado_estado IS NOT NULL AND x.llegaron > 0 THEN
          'Llegó sólo una parte de ' || coalesce(x.producto_nombre, 'una reserva') || '. Llama al cliente para que elija —lo que llegó, otro producto o cancelar— antes de las ' || v_nota || '; si no, la reserva se cierra sola y pierde lo que llegó.'
        WHEN x.traslado_estado IS NOT NULL THEN
          'El traslado de ' || coalesce(x.producto_nombre, 'una reserva') || ' no salió. Consíguelo en otra sala o llama al cliente antes de las ' || v_nota || '; si no, la reserva se cierra sola.'
        ELSE
          coalesce(x.producto_nombre, 'Una reserva') || ' espera que la preparen. Si no queda lista antes de las ' || v_nota || ', se cierra sola.'
      END,
      '/reservas', jsonb_build_object('check_key', v_clave, 'reserva_id', x.id), true, x.branch_id::integer);
    v_por_vencer := v_por_vencer + 1;
  END LOOP;

  RETURN json_build_object('saldos_apagados', v_apagados, 'avisos_existencia', v_avisos, 'saldos_devueltos', v_reversos,
                           'encargos_sin_retirar', v_encargos, 'reservas_detenidas', v_detenidas,
                           'por_vencer_en_sala', v_por_vencer);
END $function$;
