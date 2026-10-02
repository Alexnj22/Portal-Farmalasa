-- El canje hecho sin un solo punto quedaba invisible en la pestaña de Avisos
-- (2026-10-01). Con saldo 0 la salida se BORRABA (puntos_salida exige
-- puntos > 0) y el panel lee el aviso del libro: el teléfono sonaba, «Ver»
-- llevaba a una lista sin esa venta. Ahora el caso queda anotado en
-- puntos_irregularidad (tipo canje_sin_saldo) y el panel lo muestra con lo
-- que faltó. El aviso además trae cliente y documento para el texto.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.puntos_registrar_canje(p_invoice_id bigint, p_simular boolean DEFAULT true)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v record; v_descuento numeric; v_puntos integer;
  v_salida bigint; v_consumidos integer; v_saldo integer;
BEGIN
  SELECT si.id, si.customer_id, si.has_puntos, si.total,
         coalesce(si.retencion, 0) AS retencion, si.fecha, si.correlativo,
         b.codigo_puntos AS sucursal,
         cu.name AS cliente,
         coalesce(cu.acumula_puntos, true) AS ficha_acumula,
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

CREATE OR REPLACE FUNCTION public.puntos_panel_avisos()
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v json;
BEGIN
  IF NOT (SELECT public.auth_has_module_permission('puntos_tab_avisos', 'can_view')) THEN
    RAISE EXCEPTION 'No tienes permiso para ver los avisos de puntos.' USING ERRCODE = '42501';
  END IF;

  SELECT coalesce(json_agg(x ORDER BY x.cuando DESC), '[]'::json) INTO v FROM (
    SELECT 'canje_sin_saldo' AS tipo, s.created_at AS cuando, s.customer_id, c.name AS cliente,
           coalesce(b.name, s.sucursal) AS sala, si.correlativo AS documento, si.id AS invoice_id,
           s.puntos AS puntos,
           nullif(substring(s.motivo FROM 'faltaron ([0-9]+) puntos'), '')::int AS faltaron,
           NULL::text AS nota, NULL::uuid AS quien_id, NULL::text AS quien
      FROM public.puntos_salida s
      JOIN public.customers c ON c.id = s.customer_id
      LEFT JOIN public.sales_invoices si ON si.id = s.invoice_id
      LEFT JOIN public.branches b ON b.codigo_puntos = s.sucursal
     WHERE s.tipo = 'canje' AND s.invoice_id IS NOT NULL AND s.motivo LIKE '%faltaron%'
       AND s.created_at >= now() - interval '60 days'
    UNION ALL
    SELECT 'anulada_con_puntos_gastados', g.created_at, g.customer_id, c.name,
           coalesce(b.name, g.sucursal), si.correlativo, si.id,
           g.no_recuperados, g.no_recuperados, NULL, NULL, NULL
      FROM public.puntos_anulacion_gastada g
      JOIN public.sales_invoices si ON si.id = g.invoice_id
      LEFT JOIN public.customers c ON c.id = g.customer_id
      LEFT JOIN public.branches b ON b.codigo_puntos = g.sucursal
     WHERE g.created_at >= now() - interval '60 days'
    UNION ALL
    -- Regla del usuario (2026-09-28): un canje no puede dejar la venta en $0.00.
    SELECT 'canje_venta_en_cero', s.created_at, s.customer_id, c.name,
           coalesce(b.name, s.sucursal), si.correlativo, si.id,
           s.puntos, NULL::int, NULL, NULL, NULL
      FROM public.puntos_salida s
      JOIN public.sales_invoices si ON si.id = s.invoice_id
      JOIN public.customers c ON c.id = s.customer_id
      LEFT JOIN public.branches b ON b.codigo_puntos = s.sucursal
     WHERE s.tipo = 'canje' AND s.revertida_at IS NULL AND si.total <= 0
       AND s.created_at >= now() - interval '60 days'
    UNION ALL
    SELECT 'canje_devuelto', s.revertida_at, s.customer_id, c.name,
           coalesce(b.name, s.sucursal), si.correlativo, si.id,
           s.puntos, NULL::int, NULL, NULL, NULL
      FROM public.puntos_salida s
      JOIN public.customers c ON c.id = s.customer_id
      LEFT JOIN public.sales_invoices si ON si.id = s.invoice_id
      LEFT JOIN public.branches b ON b.codigo_puntos = s.sucursal
     WHERE s.tipo = 'canje' AND s.revertida_at >= now() - interval '60 days'
    UNION ALL
    -- Movimientos fuera de lo normal (2026-10-01). Incluye el canje hecho con
    -- saldo 0, que no deja salida en el libro: «faltaron» viaja en `detalle`.
    SELECT i.tipo, i.created_at, i.customer_id, c.name,
           coalesce(b.name, i.sucursal), si.correlativo, i.invoice_id,
           i.puntos, (i.detalle->>'faltaron')::int, i.nota, i.employee_id, e.name
      FROM public.puntos_irregularidad i
      LEFT JOIN public.customers c ON c.id = i.customer_id
      LEFT JOIN public.sales_invoices si ON si.id = i.invoice_id
      LEFT JOIN public.branches b ON b.codigo_puntos = i.sucursal
      LEFT JOIN public.employees e ON e.id = i.employee_id
     WHERE i.tipo <> 'anulada_gastada' AND i.created_at >= now() - interval '60 days'
  ) x;
  RETURN v;
END;
$function$;

-- El caso que lo destapó: Salud 2, 1-oct 18:12, 200 puntos con saldo 0.
INSERT INTO public.puntos_irregularidad
  (clave, tipo, dia, customer_id, sucursal, invoice_id, puntos, nota, detalle, created_at)
SELECT 'puntos_sin_saldo:' || si.id, 'canje_sin_saldo', si.fecha, si.customer_id,
       b.codigo_puntos, si.id, 200,
       'Se aplicaron 200 puntos y el cliente no tenía ninguno.',
       jsonb_build_object('faltaron', 200, 'tenia', 0), '2026-10-02 00:14:01+00'
  FROM public.sales_invoices si LEFT JOIN public.branches b ON b.id = si.branch_id
 WHERE si.id = 6703113
ON CONFLICT (clave) DO NOTHING;
