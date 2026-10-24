-- ═══════════════════════════════════════════════════════════════════════════
-- Reglamento v2 de Puntos Salud — 3 de 4: vencimiento y canjes fuera de regla
-- (borrador 2026-10-24)
--
-- QUÉ CAMBIA
--   · `puntos_vencer_lotes`: `vence_el < hoy` (antes `<=`). Cl. 7.1: los puntos
--     «pueden usarse hasta esa fecha inclusive». Es una CORRECCIÓN y no depende
--     de la fecha del v2 (la v1 dice lo mismo). Medido en producción el
--     2026-10-24: 0 lotes con vence_el antes del 2027-10-01 y 0 salidas por
--     vencimiento → no hay nada que reparar. También afecta al raspable: sus
--     puntos (vence_el = último día del mes) sirven ese último día entero.
--   · `puntos_vencer_lotes`: no vence lo de quien salió del programa
--     (`acepta_programa_puntos = false`) — cl. 12.2 v2 y cl. 10 v1.
--   · `puntos_registrar_canje`: la caja no puede frenar un canje, así que el
--     canje se registra como siempre y, además, queda en `puntos_irregularidad`:
--       - `canje_fuera_del_programa`: canje de quien salió (cl. 12.2).
--       - `canje_bajo_minimo`: canje de menos de `minimo_canje` (100) puntos
--         (cl. 6.1; la v1 pide lo mismo).
--     Se ven en Puntos → Avisos (la pantalla ya muestra todo lo de esa tabla).
--
-- DESDE CUÁNDO RIGE: al aplicarla (son reglas que la v1 ya tenía).
-- TABLA CALIENTE: no (sólo funciones).
-- CÓMO SE VERIFICÓ: staging con execute_sql — ver el informe de la tanda.
-- ═══════════════════════════════════════════════════════════════════════════
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.puntos_vencer_lotes(p_al_dia date DEFAULT CURRENT_DATE, p_simular boolean DEFAULT true)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  r record; v_salida bigint; v_vencen integer;
  v_clientes integer := 0; v_puntos bigint := 0;
BEGIN
  FOR r IN
    -- Cl. 7.1: los puntos «pueden usarse hasta esa fecha inclusive», así que
    -- vencen el día DESPUÉS de `vence_el` (antes era `<=`: morían el último
    -- día en que todavía servían). Corrección, no regla nueva: no depende de
    -- `reglas_v2_desde()`. Medido el 2026-10-24: ningún lote vence antes del
    -- 2027-10-01 y no hay ni una salida por vencimiento, así que no cambia
    -- nada ya hecho.
    -- Cl. 12.2 (v1 cl. 10 dice lo mismo): quien salió del programa tiene sus
    -- puntos RETENIDOS, no vencen mientras esté fuera.
    SELECT l.customer_id, sum(l.restantes)::integer AS puntos
    FROM public.puntos_lote l
    WHERE l.restantes > 0 AND l.vence_el < p_al_dia
      AND NOT EXISTS (SELECT 1 FROM public.customers c
                       WHERE c.id = l.customer_id AND c.acepta_programa_puntos = false)
    GROUP BY l.customer_id
    ORDER BY l.customer_id
  LOOP
    IF p_simular THEN
      v_clientes := v_clientes + 1;
      v_puntos   := v_puntos + r.puntos;
      CONTINUE;
    END IF;

    -- Los lotes vencidos de ESTE cliente, bloqueados: un canje simultáneo
    -- espera, y lo que se suma después del bloqueo es lo que de verdad queda
    -- (un canje que entró entre la lista de arriba y este punto ya restó).
    PERFORM 1 FROM public.puntos_lote
     WHERE customer_id = r.customer_id AND restantes > 0 AND vence_el < p_al_dia
     FOR UPDATE;
    SELECT coalesce(sum(restantes), 0)::integer INTO v_vencen FROM public.puntos_lote
     WHERE customer_id = r.customer_id AND restantes > 0 AND vence_el < p_al_dia;
    CONTINUE WHEN v_vencen <= 0;

    INSERT INTO public.puntos_salida (customer_id, tipo, puntos, motivo)
    VALUES (r.customer_id, 'vencimiento', v_vencen, format('vencieron al %s', p_al_dia))
    RETURNING id INTO v_salida;

    -- De cada lote vencido sale exactamente lo que le quedaba.
    INSERT INTO public.puntos_salida_lote (salida_id, lote_id, puntos)
    SELECT v_salida, l.id, l.restantes FROM public.puntos_lote l
     WHERE l.customer_id = r.customer_id AND l.restantes > 0 AND l.vence_el < p_al_dia
    ON CONFLICT (salida_id, lote_id) DO UPDATE SET puntos = puntos_salida_lote.puntos + EXCLUDED.puntos;
    UPDATE public.puntos_lote SET restantes = 0
     WHERE customer_id = r.customer_id AND restantes > 0 AND vence_el < p_al_dia;

    UPDATE public.puntos_cuenta
       SET saldo = saldo - v_vencen, usados = usados + v_vencen, updated_at = now()
     WHERE customer_id = r.customer_id;

    v_clientes := v_clientes + 1;
    v_puntos   := v_puntos + v_vencen;
  END LOOP;

  RETURN json_build_object('simulado', p_simular, 'al_dia', p_al_dia,
                           'clientes', v_clientes, 'puntos', v_puntos);
END;
$function$;

CREATE OR REPLACE FUNCTION public.puntos_registrar_canje(p_invoice_id bigint, p_simular boolean DEFAULT true)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v record; v_descuento numeric; v_puntos integer; v_minimo integer;
  v_salida bigint; v_consumidos integer; v_saldo integer;
BEGIN
  SELECT si.id, si.customer_id, si.has_puntos, si.total,
         coalesce(si.retencion, 0) AS retencion, si.fecha, si.correlativo,
         b.codigo_puntos AS sucursal,
         cu.name AS cliente,
         coalesce(cu.acumula_puntos, true) AS ficha_acumula,
         cu.acepta_programa_puntos IS NOT DISTINCT FROM false AS fuera_del_programa,
         (SELECT coalesce(sum(ii.total_linea), 0)
            FROM public.sales_invoice_items ii WHERE ii.invoice_id = si.id AND ii.erp_product_id IS DISTINCT FROM 0) AS renglones
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

  -- Dos canjes que la caja no frena y el reglamento no permite (2026-10-24).
  -- No se deshacen —el descuento ya se dio en caja—: se registran igual, para
  -- que el libro diga lo que pasó, y quedan anotados para revisar.
  --  · Cl. 12.2: quien salió del programa tiene sus puntos retenidos «no
  --    vencen ni se canjean mientras esté fuera» (la v1, cl. 10, igual).
  --  · Cl. 6.1: el canje es «desde un mínimo de 100 puntos» (v1 cl. 4: lo mismo).
  IF v.fuera_del_programa THEN
    INSERT INTO public.puntos_irregularidad (clave, tipo, dia, customer_id, sucursal, invoice_id, puntos, nota, detalle)
    VALUES ('canje_fuera_del_programa:' || p_invoice_id, 'canje_fuera_del_programa', v.fecha, v.customer_id,
            v.sucursal, p_invoice_id, v_puntos,
            format('Se canjearon %s puntos a un cliente que salió del programa: sus puntos están retenidos.', v_puntos),
            jsonb_build_object('saldo', v_saldo))
    ON CONFLICT (clave) DO NOTHING;
  END IF;
  SELECT minimo_canje INTO v_minimo FROM public.puntos_config WHERE id;
  IF v_puntos < coalesce(v_minimo, 100) THEN
    INSERT INTO public.puntos_irregularidad (clave, tipo, dia, customer_id, sucursal, invoice_id, puntos, nota, detalle)
    VALUES ('canje_bajo_minimo:' || p_invoice_id, 'canje_bajo_minimo', v.fecha, v.customer_id,
            v.sucursal, p_invoice_id, v_puntos,
            format('Se canjearon %s puntos: el mínimo es %s.', v_puntos, coalesce(v_minimo, 100)),
            jsonb_build_object('minimo', coalesce(v_minimo, 100)))
    ON CONFLICT (clave) DO NOTHING;
  END IF;

  INSERT INTO public.puntos_cuenta (customer_id) VALUES (v.customer_id)
    ON CONFLICT (customer_id) DO NOTHING;

  INSERT INTO public.puntos_salida (customer_id, tipo, puntos, monto, invoice_id, sucursal, motivo)
  VALUES (v.customer_id, 'canje', v_puntos, v_descuento, p_invoice_id, v.sucursal,
          'canje aplicado en el sistema de ventas')
  RETURNING id INTO v_salida;

  v_consumidos := public.puntos_consumir_canje(v.customer_id, v_puntos, v_salida);

  -- La cuenta nunca queda debiendo: se resta lo que hay y se anota lo que faltó.
  IF v_consumidos < v_puntos THEN
    UPDATE public.puntos_salida SET puntos = greatest(v_consumidos, 1),
           motivo = motivo || format(' · faltaron %s puntos', v_puntos - v_consumidos)
     WHERE id = v_salida;
    IF v_consumidos = 0 THEN
      DELETE FROM public.puntos_salida WHERE id = v_salida;
      -- Sin salida en el libro, el panel de Avisos no tenía de dónde leerlo
      -- (2026-10-01): el aviso llegaba y «Ver» mostraba una lista sin él.
      -- Queda anotado acá; la clave es la misma del aviso, así no se duplica.
      INSERT INTO public.puntos_irregularidad
        (clave, tipo, dia, customer_id, sucursal, invoice_id, puntos, nota, detalle)
      VALUES ('puntos_sin_saldo:' || p_invoice_id, 'canje_sin_saldo', v.fecha, v.customer_id,
              v.sucursal, p_invoice_id, v_puntos,
              format('Se aplicaron %s puntos y el cliente no tenía ninguno.', v_puntos),
              jsonb_build_object('faltaron', v_puntos, 'tenia', v_saldo))
      ON CONFLICT (clave) DO NOTHING;
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
        'cliente', v.cliente, 'documento', v.correlativo,
        'pedidos', v_puntos, 'tenia', v_saldo) ELSE NULL END);
END;
$function$;
