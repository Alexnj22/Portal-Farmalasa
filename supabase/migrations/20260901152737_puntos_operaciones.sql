-- Las operaciones del programa de puntos. TODAS son inertes hasta que alguien
-- las llama: no hay trigger, no hay cron, y este archivo no crea ninguno.
--
-- Todas SECURITY DEFINER, porque las tablas no aceptan escritura por la API: el
-- lote, la salida, el enlace y el saldo se mueven en UNA transacción o no se
-- mueve nada.
--
-- Plan: docs/PLAN-PUNTOS-EN-SUPABASE-2026-09-01.md
SET lock_timeout = '5s';

-- ── El FIFO, en un solo lugar ───────────────────────────────────────────────
-- Lo usan el canje, el vencimiento y el ajuste negativo. Devuelve cuántos
-- puntos consumió DE VERDAD, que puede ser menos de los pedidos: la cuenta
-- nunca queda debiendo y el llamador decide qué hacer con lo que faltó.
CREATE OR REPLACE FUNCTION public.puntos_consumir(
  p_customer_id bigint, p_puntos integer, p_salida_id bigint
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_falta integer := p_puntos;
  v_toma  integer;
  r       record;
BEGIN
  IF p_puntos <= 0 THEN RETURN 0; END IF;

  -- `FOR UPDATE` sobre los lotes vivos del cliente, del más viejo al más nuevo:
  -- dos canjes simultáneos de la misma persona se ponen en fila en vez de leer
  -- los dos el mismo saldo y gastarlo dos veces.
  FOR r IN
    SELECT id, restantes FROM public.puntos_lote
    WHERE customer_id = p_customer_id AND restantes > 0
    ORDER BY ganado_el, id
    FOR UPDATE
  LOOP
    EXIT WHEN v_falta <= 0;
    v_toma := least(v_falta, r.restantes);
    UPDATE public.puntos_lote SET restantes = restantes - v_toma WHERE id = r.id;
    INSERT INTO public.puntos_salida_lote (salida_id, lote_id, puntos)
      VALUES (p_salida_id, r.id, v_toma)
      ON CONFLICT (salida_id, lote_id) DO UPDATE SET puntos = puntos_salida_lote.puntos + EXCLUDED.puntos;
    v_falta := v_falta - v_toma;
  END LOOP;

  RETURN p_puntos - v_falta;
END;
$$;

-- ── Acumular ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.puntos_acumular(
  p_desde date, p_hasta date,
  p_margen numeric DEFAULT 0.02, p_tope integer DEFAULT 20000,
  p_simular boolean DEFAULT true
) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_leidas integer := 0; v_nuevas integer := 0; v_puntos bigint := 0;
  v_ya integer := 0; v_sin_ficha integer := 0;
  r record; v_lote bigint;
BEGIN
  FOR r IN
    SELECT * FROM json_to_recordset(
      public.ventas_elegibles_puntos(p_desde, p_hasta, p_margen, p_tope)
    ) AS x(invoice_id bigint, sucursal text, erp_invoice_id text, correlativo text,
           customer_id bigint, cod_vendedor int, total numeric, fecha date, puntos int)
  LOOP
    v_leidas := v_leidas + 1;

    -- Sin ficha no hay a quién acreditarle. Medido: 0 de 4,009 en la semana de
    -- prueba, pero una venta sin cliente no puede tumbar la corrida.
    IF r.customer_id IS NULL THEN v_sin_ficha := v_sin_ficha + 1; CONTINUE; END IF;

    -- La exclusión propia del circuito nuevo: la bitácora vieja no se mira. El
    -- índice único sobre invoice_id lo garantiza igual; esto sólo evita el
    -- trabajo y deja el conteo limpio.
    IF EXISTS (SELECT 1 FROM public.puntos_lote WHERE invoice_id = r.invoice_id) THEN
      v_ya := v_ya + 1; CONTINUE;
    END IF;

    v_nuevas := v_nuevas + 1;
    v_puntos := v_puntos + r.puntos;
    CONTINUE WHEN p_simular;

    INSERT INTO public.puntos_cuenta (customer_id) VALUES (r.customer_id)
      ON CONFLICT (customer_id) DO NOTHING;

    INSERT INTO public.puntos_lote
      (customer_id, origen, invoice_id, sucursal, puntos, restantes, ganado_el, vence_el)
    VALUES (r.customer_id, 'venta', r.invoice_id, r.sucursal, r.puntos, r.puntos,
            r.fecha, public.puntos_vence_el(r.fecha))
    RETURNING id INTO v_lote;

    UPDATE public.puntos_cuenta
       SET saldo = saldo + r.puntos, ganados = ganados + r.puntos, updated_at = now()
     WHERE customer_id = r.customer_id;
  END LOOP;

  RETURN json_build_object(
    'simulado', p_simular, 'desde', p_desde, 'hasta', p_hasta,
    'leidas', v_leidas, 'nuevas', v_nuevas, 'puntos', v_puntos,
    'ya_tenian_lote', v_ya, 'sin_ficha', v_sin_ficha,
    'tope_alcanzado', v_leidas >= p_tope
  );
END;
$$;
COMMENT ON FUNCTION public.puntos_acumular(date,date,numeric,integer,boolean) IS
  'Acredita los puntos de las ventas elegibles. Simula por defecto: para escribir hay que pedirlo con p_simular => false.';

-- ── Registrar un canje hecho en el mostrador ────────────────────────────────
-- El canje ocurre en el sistema de ventas, no acá. Esta función NO autoriza:
-- registra lo que ya pasó y descuenta. La fórmula y sus dos guardas están
-- medidas — ver §5 del plan y §5.b del documento del circuito.
CREATE OR REPLACE FUNCTION public.puntos_registrar_canje(
  p_invoice_id bigint, p_simular boolean DEFAULT true
) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v record; v_descuento numeric; v_puntos integer;
  v_salida bigint; v_consumidos integer; v_saldo integer;
BEGIN
  SELECT si.id, si.customer_id, si.has_puntos, si.total,
         coalesce(si.retencion, 0) AS retencion, si.fecha,
         b.codigo_puntos AS sucursal,
         coalesce(cu.acumula_puntos, true) AS ficha_acumula,
         (SELECT coalesce(sum(ii.total_linea), 0)
            FROM public.sales_invoice_items ii WHERE ii.invoice_id = si.id) AS renglones
    INTO v
    FROM public.sales_invoices si
    LEFT JOIN public.branches  b  ON b.id = si.branch_id
    LEFT JOIN public.customers cu ON cu.id = si.customer_id
   WHERE si.id = p_invoice_id;

  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'motivo', 'esa venta no existe');
  END IF;

  -- Guarda 1: la marca. `has_puntos` no tiene falsos negativos — todo canje real
  -- está marcado (medido sobre 269,206 facturas del año).
  IF NOT coalesce(v.has_puntos, false) THEN
    RETURN json_build_object('ok', false, 'motivo', 'la venta no trae descuento de puntos');
  END IF;

  -- Guarda 2: la ficha. MAPFRE es la ÚNICA con acumula_puntos = false de las
  -- 28,110 (verificado 2026-09-01): por convenio se le aplica el descuento y se
  -- registra igual que un canje, pero no tiene puntos. Sin esta guarda, esto
  -- dispararía ~60 alertas al año sobre la única ficha donde eso es normal — la
  -- forma más rápida de que una sala aprenda a ignorar la alerta.
  IF NOT v.ficha_acumula THEN
    RETURN json_build_object('ok', true, 'accion', 'ninguna',
                             'motivo', 'ficha de convenio: no acumula ni canjea');
  END IF;

  IF v.customer_id IS NULL THEN
    RETURN json_build_object('ok', false, 'motivo', 'la venta no tiene cliente');
  END IF;

  IF EXISTS (SELECT 1 FROM public.puntos_salida
              WHERE invoice_id = p_invoice_id AND tipo = 'canje') THEN
    RETURN json_build_object('ok', true, 'accion', 'ninguna', 'motivo', 'ya estaba registrado');
  END IF;

  -- El hueco entre los renglones y el total NO es necesariamente un descuento:
  -- puede ser retención del ISSS (Art. 162). Los 17 casos con hueco y sin marca
  -- eran todos eso, y por eso la retención se resta.
  v_descuento := (v.renglones - v.total) - v.retencion;
  v_puntos    := round(v_descuento * 100)::integer;

  IF v_puntos <= 0 THEN
    RETURN json_build_object('ok', false, 'motivo', 'el descuento no da puntos',
                             'descuento', v_descuento);
  END IF;

  SELECT coalesce(saldo, 0) INTO v_saldo FROM public.puntos_cuenta WHERE customer_id = v.customer_id;
  v_saldo := coalesce(v_saldo, 0);

  IF p_simular THEN
    RETURN json_build_object('simulado', true, 'ok', true, 'puntos', v_puntos,
      'descuento', v_descuento, 'saldo_actual', v_saldo,
      'alcanza', v_saldo >= v_puntos);
  END IF;

  INSERT INTO public.puntos_cuenta (customer_id) VALUES (v.customer_id)
    ON CONFLICT (customer_id) DO NOTHING;

  INSERT INTO public.puntos_salida (customer_id, tipo, puntos, monto, invoice_id, sucursal, motivo)
  VALUES (v.customer_id, 'canje', v_puntos, v_descuento, p_invoice_id, v.sucursal,
          'canje aplicado en el sistema de ventas')
  RETURNING id INTO v_salida;

  v_consumidos := public.puntos_consumir(v.customer_id, v_puntos, v_salida);

  -- La cuenta nunca queda debiendo: se resta lo que hay y se anota lo que faltó.
  IF v_consumidos < v_puntos THEN
    UPDATE public.puntos_salida SET puntos = greatest(v_consumidos, 1),
           motivo = motivo || format(' · faltaron %s puntos', v_puntos - v_consumidos)
     WHERE id = v_salida;
    IF v_consumidos = 0 THEN
      DELETE FROM public.puntos_salida WHERE id = v_salida;
    END IF;
  END IF;

  UPDATE public.puntos_cuenta
     SET saldo = saldo - v_consumidos, usados = usados + v_consumidos, updated_at = now()
   WHERE customer_id = v.customer_id;

  RETURN json_build_object('ok', true, 'accion', 'canje registrado',
    'puntos', v_puntos, 'descontados', v_consumidos,
    'no_recuperados', v_puntos - v_consumidos, 'descuento', v_descuento,
    -- El llamador es quien avisa: una función de Postgres no manda notificaciones.
    'avisar', v_consumidos < v_puntos,
    'aviso', CASE WHEN v_consumidos < v_puntos THEN json_build_object(
        'sucursal', v.sucursal, 'customer_id', v.customer_id, 'invoice_id', p_invoice_id,
        'pedidos', v_puntos, 'tenia', v_saldo) ELSE NULL END);
END;
$$;

-- ── Anular una venta ────────────────────────────────────────────────────────
-- «La devolución es un CANJE con su motivo, no un borrado» (decisión del
-- usuario, 2026-08-29): el saldo baja y queda una línea que lo explica. Borrar
-- el lote le dejaba al cliente menos puntos y ninguna explicación.
--
-- El vínculo es inequívoco por construcción: el índice único sobre invoice_id
-- garantiza a lo sumo UN lote por venta. La ambigüedad que en MySQL dejó dos de
-- 26 casos sin resolver —`TicketFactura` se repite entre salas— acá no existe.
CREATE OR REPLACE FUNCTION public.puntos_anular_venta(
  p_invoice_id bigint, p_simular boolean DEFAULT true
) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  l record; v_salida bigint; v_quita integer;
BEGIN
  SELECT * INTO l FROM public.puntos_lote WHERE invoice_id = p_invoice_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN json_build_object('ok', true, 'accion', 'ninguna',
      'motivo', 'esa venta nunca dio puntos en el portal');
  END IF;

  v_quita := l.restantes;

  IF p_simular THEN
    RETURN json_build_object('simulado', true, 'ok', true,
      'dio', l.puntos, 'se_quitan', v_quita, 'ya_gastados', l.puntos - v_quita);
  END IF;

  IF v_quita > 0 THEN
    INSERT INTO public.puntos_salida (customer_id, tipo, puntos, invoice_id, sucursal, motivo)
    VALUES (l.customer_id, 'anulacion', v_quita, p_invoice_id, l.sucursal,
            'la venta se anuló')
    RETURNING id INTO v_salida;

    UPDATE public.puntos_lote SET restantes = 0 WHERE id = l.id;
    INSERT INTO public.puntos_salida_lote (salida_id, lote_id, puntos)
      VALUES (v_salida, l.id, v_quita);

    UPDATE public.puntos_cuenta
       SET saldo = saldo - v_quita, usados = usados + v_quita, updated_at = now()
     WHERE customer_id = l.customer_id;
  END IF;

  RETURN json_build_object('ok', true,
    'accion', CASE WHEN v_quita = l.puntos THEN 'retirados enteros'
                   WHEN v_quita = 0        THEN 'ya se habían gastado todos'
                   ELSE 'retirados en parte' END,
    'dio', l.puntos, 'se_quitaron', v_quita, 'no_recuperados', l.puntos - v_quita);
END;
$$;

-- ── Vencer ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.puntos_vencer_lotes(
  p_al_dia date DEFAULT current_date, p_simular boolean DEFAULT true
) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  r record; v_salida bigint;
  v_clientes integer := 0; v_puntos bigint := 0;
BEGIN
  FOR r IN
    SELECT customer_id, sum(restantes)::integer AS puntos
    FROM public.puntos_lote
    WHERE restantes > 0 AND vence_el <= p_al_dia
    GROUP BY customer_id
    ORDER BY customer_id
  LOOP
    v_clientes := v_clientes + 1;
    v_puntos   := v_puntos + r.puntos;
    CONTINUE WHEN p_simular;

    INSERT INTO public.puntos_salida (customer_id, tipo, puntos, motivo)
    VALUES (r.customer_id, 'vencimiento', r.puntos,
            format('vencieron al %s', p_al_dia))
    RETURNING id INTO v_salida;

    -- Se consume por FIFO igual que un canje: los que vencen son los más
    -- viejos, así que salen primero de todos modos.
    PERFORM public.puntos_consumir(r.customer_id, r.puntos, v_salida);

    UPDATE public.puntos_cuenta
       SET saldo = saldo - r.puntos, usados = usados + r.puntos, updated_at = now()
     WHERE customer_id = r.customer_id;
  END LOOP;

  RETURN json_build_object('simulado', p_simular, 'al_dia', p_al_dia,
                           'clientes', v_clientes, 'puntos', v_puntos);
END;
$$;

-- ── Cuadrar ─────────────────────────────────────────────────────────────────
-- Un saldo mantenido que nadie compara contra su libro deja de ser cierto sin
-- avisar. Informa por defecto; corregir hay que pedirlo.
CREATE OR REPLACE FUNCTION public.puntos_cuadrar(
  p_customer_id bigint DEFAULT NULL, p_corregir boolean DEFAULT false
) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE v json; v_corregidos integer := 0;
BEGIN
  CREATE TEMP TABLE IF NOT EXISTS _cuadre (
    customer_id bigint, saldo_guardado int, saldo_libro int,
    ganados_guardado int, ganados_libro int, usados_guardado int, usados_libro int
  ) ON COMMIT DROP;
  DELETE FROM _cuadre;

  INSERT INTO _cuadre
  SELECT c.customer_id, c.saldo, coalesce(l.restantes, 0),
         c.ganados, coalesce(l.puntos, 0),
         c.usados, coalesce(s.puntos, 0)
  FROM public.puntos_cuenta c
  LEFT JOIN (SELECT customer_id, sum(restantes)::int restantes, sum(puntos)::int puntos
               FROM public.puntos_lote GROUP BY 1) l ON l.customer_id = c.customer_id
  LEFT JOIN (SELECT customer_id, sum(puntos)::int puntos
               FROM public.puntos_salida GROUP BY 1) s ON s.customer_id = c.customer_id
  WHERE p_customer_id IS NULL OR c.customer_id = p_customer_id;

  IF p_corregir THEN
    UPDATE public.puntos_cuenta c
       SET saldo = q.saldo_libro, ganados = q.ganados_libro, usados = q.usados_libro,
           updated_at = now()
      FROM _cuadre q
     WHERE q.customer_id = c.customer_id
       AND (c.saldo, c.ganados, c.usados) IS DISTINCT FROM
           (q.saldo_libro, q.ganados_libro, q.usados_libro);
    GET DIAGNOSTICS v_corregidos = ROW_COUNT;
  END IF;

  SELECT json_build_object(
    'cuentas', count(*),
    'descuadradas', count(*) FILTER (WHERE saldo_guardado <> saldo_libro),
    'corregidas', v_corregidos,
    'detalle', coalesce(json_agg(to_json(q)) FILTER (WHERE saldo_guardado <> saldo_libro), '[]'::json)
  ) INTO v FROM _cuadre q;

  RETURN v;
END;
$$;

-- ── El estado de cuenta, para la pantalla ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.puntos_estado_cuenta(p_customer_id bigint)
RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE v json;
BEGIN
  SELECT json_build_object(
    'customer_id', p_customer_id,
    'saldo',   coalesce((SELECT saldo   FROM public.puntos_cuenta WHERE customer_id = p_customer_id), 0),
    'ganados', coalesce((SELECT ganados FROM public.puntos_cuenta WHERE customer_id = p_customer_id), 0),
    'usados',  coalesce((SELECT usados  FROM public.puntos_cuenta WHERE customer_id = p_customer_id), 0),
    'vencimientos', coalesce((
      SELECT json_agg(to_json(x) ORDER BY x.vence_el)
      FROM (SELECT vence_el, sum(restantes)::int AS puntos
              FROM public.puntos_lote
             WHERE customer_id = p_customer_id AND restantes > 0
             GROUP BY vence_el) x), '[]'::json),
    'movimientos', coalesce((
      SELECT json_agg(to_json(m) ORDER BY m.fecha DESC, m.id DESC)
      FROM (
        SELECT id, 'compra'::text AS tipo, ganado_el AS fecha, sucursal, puntos, NULL::text AS motivo
          FROM public.puntos_lote   WHERE customer_id = p_customer_id
        UNION ALL
        SELECT id, tipo, created_at::date, sucursal, -puntos, motivo
          FROM public.puntos_salida WHERE customer_id = p_customer_id
      ) m), '[]'::json)
  ) INTO v;
  RETURN v;
END;
$$;

-- ── La migración de los saldos, de una sola vez ─────────────────────────────
-- Recibe [{erp_id, saldo}] del volcado de la base vieja. Liga por el NÚMERO del
-- ERP y nunca por el nombre: el nombre sale de cómo se escribió la factura, y
-- medido sobre 68 duplicados reales normalizar acentos evita 0 de ellos.
CREATE OR REPLACE FUNCTION public.puntos_migrar(
  p_filas json, p_ganado_el date DEFAULT DATE '2026-10-01', p_simular boolean DEFAULT true
) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  r record; v_cid bigint;
  v_leidas int := 0; v_migradas int := 0; v_puntos bigint := 0;
  v_sin_ficha int := 0; v_ya int := 0; v_cero int := 0;
  v_faltantes text[] := '{}';
BEGIN
  FOR r IN SELECT * FROM json_to_recordset(p_filas) AS x(erp_id text, saldo integer)
  LOOP
    v_leidas := v_leidas + 1;

    IF coalesce(r.saldo, 0) <= 0 THEN v_cero := v_cero + 1; CONTINUE; END IF;

    SELECT id INTO v_cid FROM public.customers WHERE erp_id = r.erp_id;
    IF v_cid IS NULL THEN
      v_sin_ficha := v_sin_ficha + 1;
      IF array_length(v_faltantes,1) IS NULL OR array_length(v_faltantes,1) < 50 THEN
        v_faltantes := v_faltantes || r.erp_id;
      END IF;
      CONTINUE;
    END IF;

    IF EXISTS (SELECT 1 FROM public.puntos_lote
                WHERE customer_id = v_cid AND origen = 'migracion') THEN
      v_ya := v_ya + 1; CONTINUE;
    END IF;

    v_migradas := v_migradas + 1;
    v_puntos   := v_puntos + r.saldo;
    CONTINUE WHEN p_simular;

    INSERT INTO public.puntos_cuenta (customer_id, migrada_at) VALUES (v_cid, now())
      ON CONFLICT (customer_id) DO UPDATE SET migrada_at = now();

    INSERT INTO public.puntos_lote
      (customer_id, origen, puntos, restantes, ganado_el, vence_el, motivo)
    VALUES (v_cid, 'migracion', r.saldo, r.saldo, p_ganado_el,
            public.puntos_vence_el(p_ganado_el),
            'saldo traído del sistema anterior');

    UPDATE public.puntos_cuenta
       SET saldo = saldo + r.saldo, ganados = ganados + r.saldo, updated_at = now()
     WHERE customer_id = v_cid;
  END LOOP;

  RETURN json_build_object('simulado', p_simular, 'leidas', v_leidas,
    'migradas', v_migradas, 'puntos', v_puntos, 'saldo_cero', v_cero,
    'ya_migradas', v_ya, 'sin_ficha_en_el_portal', v_sin_ficha,
    'erp_id_sin_ficha', to_json(v_faltantes));
END;
$$;

-- ── Permisos ────────────────────────────────────────────────────────────────
-- Nada de esto lo llama el navegador todavía. `service_role` para los procesos
-- del portal; `authenticated` sólo donde una pantalla lo va a necesitar.
REVOKE EXECUTE ON FUNCTION public.puntos_consumir(bigint,integer,bigint) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.puntos_consumir(bigint,integer,bigint) TO service_role;

REVOKE EXECUTE ON FUNCTION public.puntos_acumular(date,date,numeric,integer,boolean) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.puntos_acumular(date,date,numeric,integer,boolean) TO service_role;

REVOKE EXECUTE ON FUNCTION public.puntos_registrar_canje(bigint,boolean) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.puntos_registrar_canje(bigint,boolean) TO service_role;

REVOKE EXECUTE ON FUNCTION public.puntos_anular_venta(bigint,boolean) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.puntos_anular_venta(bigint,boolean) TO service_role;

REVOKE EXECUTE ON FUNCTION public.puntos_vencer_lotes(date,boolean) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.puntos_vencer_lotes(date,boolean) TO service_role;

REVOKE EXECUTE ON FUNCTION public.puntos_migrar(json,date,boolean) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.puntos_migrar(json,date,boolean) TO service_role;

REVOKE EXECUTE ON FUNCTION public.puntos_cuadrar(bigint,boolean) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.puntos_cuadrar(bigint,boolean) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.puntos_estado_cuenta(bigint) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.puntos_estado_cuenta(bigint) TO authenticated, service_role;
