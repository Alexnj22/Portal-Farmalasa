SET lock_timeout = '5s';

-- Umbrales corregidos el mismo día, después de ver el primer hallazgo real en
-- simulación: 3 facturas en 4 minutos de la misma cajera eran una compra
-- partida, no una irregularidad.
CREATE OR REPLACE FUNCTION public.puntos_vigilar_irregularidades(p_simular boolean DEFAULT false)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_hoy date := (now() AT TIME ZONE 'America/El_Salvador')::date;
  v_desde date;
  v_hallazgos jsonb;
  v_dest uuid[];
  v_nuevos int := 0;
  r record;
BEGIN
  IF public.puntos_fuente() <> 'portal' THEN
    RETURN json_build_object('omitido', 'el programa no funciona en el portal');
  END IF;
  -- Ayer también: lo que entró al filo de la medianoche se juzga completo.
  v_desde := greatest(v_hoy - 1, (SELECT inicio FROM public.puntos_config WHERE id));

  WITH v AS (
    SELECT l.customer_id, l.ganado_el AS dia, l.puntos, l.sucursal, l.invoice_id,
           coalesce(b.name, l.sucursal) AS sala, si.cod_vendedor, si.correlativo, si.created_at,
           -- Una visita nueva del mismo vendedor si pasó más de media hora: una
           -- compra partida en tres facturas seguidas es UNA visita.
           CASE WHEN si.created_at - lag(si.created_at) OVER (PARTITION BY l.customer_id, l.ganado_el, si.cod_vendedor
                                                               ORDER BY si.created_at) <= interval '30 minutes'
                THEN 0 ELSE 1 END AS visita_nueva
      FROM public.puntos_lote l
      JOIN public.sales_invoices si ON si.id = l.invoice_id
      LEFT JOIN public.branches b ON b.codigo_puntos = l.sucursal
     WHERE l.origen = 'venta' AND l.ganado_el >= v_desde
  ),
  dia AS (
    SELECT customer_id, dia, count(*) AS n, sum(puntos) AS p,
           count(DISTINCT sucursal) AS salas, count(DISTINCT cod_vendedor) AS vendedores,
           string_agg(DISTINCT sala, ', ') AS lista_salas,
           min(created_at) AS primera, max(created_at) AS ultima
      FROM v GROUP BY 1, 2
  ),
  h AS (
    -- 1 · Muchas ventas a la misma ficha en un día. La señal es la cantidad de
    -- VENDEDORES, no de facturas: con uno solo, 6+ facturas pasa 7 veces al
    -- año; con 4+ vendedores pasó 321 (el día de 214 tickets tenía 8).
    SELECT 'muchas_ventas' AS tipo, 'muchas:' || customer_id || ':' || dia AS clave, dia, customer_id,
           NULL::text AS sucursal, NULL::bigint AS invoice_id, NULL::uuid AS employee_id, p::int AS puntos,
           format('%s ventas en un día, de %s vendedores, entre %s y %s', n, vendedores,
                  to_char(primera AT TIME ZONE 'America/El_Salvador', 'HH12:MI AM'),
                  to_char(ultima AT TIME ZONE 'America/El_Salvador', 'HH12:MI AM')) AS nota,
           jsonb_build_object('ventas', n, 'vendedores', vendedores, 'salas', lista_salas) AS detalle
      FROM dia WHERE vendedores >= 4 OR n >= 8
    UNION ALL
    -- 2 · Muchos puntos en un día (si no es ya por muchas ventas).
    SELECT 'acumulacion_alta', 'alta:' || customer_id || ':' || dia, dia, customer_id,
           lista_salas, NULL, NULL, p::int,
           format('%s puntos en un día, en %s %s', p, n, CASE WHEN n = 1 THEN 'venta' ELSE 'ventas' END),
           jsonb_build_object('ventas', n)
      FROM dia WHERE p >= 500 AND NOT (vendedores >= 4 OR n >= 8)
    UNION ALL
    -- 3 · Compras en 3 o más salas el mismo día.
    SELECT 'varias_salas', 'salas:' || customer_id || ':' || dia, dia, customer_id,
           lista_salas, NULL, NULL, p::int,
           format('Compró en %s salas el mismo día (%s)', salas, lista_salas),
           jsonb_build_object('ventas', n, 'salas', lista_salas)
      FROM dia WHERE salas >= 3
    UNION ALL
    -- 4 · Un vendedor atiende a la misma ficha en 3+ visitas separadas (3 al año
    -- en el sistema anterior; contando facturas daba 502 y casi todas eran una
    -- compra partida).
    SELECT 'mismo_vendedor', 'vendedor:' || x.customer_id || ':' || x.cod_vendedor || ':' || x.dia, x.dia,
           x.customer_id, x.salas, NULL, e.id, x.p::int,
           format('%s le cargó ventas en %s momentos distintos del día (%s facturas)', coalesce(public.nombre_corto_de_empleado(e.first_names, e.last_names, e.name), 'El vendedor ' || x.cod_vendedor), x.visitas, x.n),
           jsonb_build_object('ventas', x.n, 'visitas', x.visitas, 'cod_vendedor', x.cod_vendedor)
      FROM (SELECT customer_id, dia, cod_vendedor, count(*) n, sum(visita_nueva) visitas, sum(puntos) p,
                   string_agg(DISTINCT sala, ', ') salas
              FROM v WHERE cod_vendedor IS NOT NULL GROUP BY 1, 2, 3 HAVING sum(visita_nueva) >= 3) x
      LEFT JOIN public.employees e ON e.code = x.cod_vendedor
    UNION ALL
    -- 5 · Un empleado se vende a sí mismo (su DUI es el de la ficha).
    SELECT 'venta_a_si_mismo', 'propia:' || v.invoice_id, v.dia, v.customer_id,
           v.sucursal, v.invoice_id, e.id, v.puntos,
           'La vendió un empleado a su propia ficha',
           jsonb_build_object('documento', v.correlativo)
      FROM v
      JOIN public.employees e ON e.code = v.cod_vendedor AND coalesce(e.dui, '') <> ''
      JOIN public.customers c ON c.id = v.customer_id
     WHERE regexp_replace(e.dui, '\D', '', 'g') = regexp_replace(coalesce(c.dui, ''), '\D', '', 'g')
       AND length(regexp_replace(e.dui, '\D', '', 'g')) = 9
    UNION ALL
    -- 6 · Puntos dados a mano. Los del cuadre del arranque no llevan autor.
    SELECT 'ajuste_suma', 'ajuste_lote:' || l.id, l.ganado_el, l.customer_id,
           NULL, NULL, l.creado_por, l.puntos,
           'Puntos dados a mano: ' || coalesce(l.motivo, 'sin motivo'), NULL
      FROM public.puntos_lote l
     WHERE l.origen = 'ajuste' AND l.ganado_el >= v_desde AND l.creado_por IS NOT NULL
    UNION ALL
    -- 7 · Puntos quitados a mano.
    SELECT 'ajuste_resta', 'ajuste_salida:' || s.id, (s.created_at AT TIME ZONE 'America/El_Salvador')::date,
           s.customer_id, NULL, NULL, s.autorizado_por, -s.puntos,
           'Puntos quitados a mano: ' || coalesce(s.motivo, 'sin motivo'), NULL
      FROM public.puntos_salida s
     WHERE s.tipo = 'ajuste' AND s.created_at >= v_desde::timestamp AT TIME ZONE 'America/El_Salvador'
       AND s.autorizado_por IS NOT NULL
    UNION ALL
    -- 8 · Canje grande, o canje hecho con puntos recién ganados.
    SELECT CASE WHEN s.puntos >= 2000 THEN 'canje_grande' ELSE 'canje_recien_ganado' END,
           'canje:' || s.id, (s.created_at AT TIME ZONE 'America/El_Salvador')::date,
           s.customer_id, s.sucursal, s.invoice_id, NULL, s.puntos,
           CASE WHEN s.puntos >= 2000 THEN format('Canje de %s puntos', s.puntos)
                ELSE format('Canjeó %s puntos y %s los ganó en los 3 días anteriores', s.puntos, rec.p) END,
           jsonb_build_object('ganados_3_dias', rec.p)
      FROM public.puntos_salida s
      CROSS JOIN LATERAL (
        SELECT coalesce(sum(l.puntos), 0) AS p FROM public.puntos_lote l
         WHERE l.customer_id = s.customer_id AND l.origen IN ('venta', 'ajuste')
           AND l.ganado_el BETWEEN (s.created_at AT TIME ZONE 'America/El_Salvador')::date - 3
                               AND (s.created_at AT TIME ZONE 'America/El_Salvador')::date) rec
     WHERE s.tipo = 'canje' AND s.revertida_at IS NULL
       AND s.created_at >= v_desde::timestamp AT TIME ZONE 'America/El_Salvador'
       AND (s.puntos >= 2000 OR (rec.p >= 300 AND rec.p * 2 >= s.puntos))
    UNION ALL
    -- 9 · Factura anulada cuando sus puntos ya se habían canjeado. Ya figura en
    -- Avisos por su cuenta; acá sólo se agrega para que llegue el aviso.
    SELECT 'anulada_gastada', 'anulada:' || g.invoice_id, (g.created_at AT TIME ZONE 'America/El_Salvador')::date,
           g.customer_id, g.sucursal, g.invoice_id, NULL, g.no_recuperados,
           format('Se anuló una factura cuyos puntos ya se habían canjeado: %s puntos no se recuperaron', g.no_recuperados),
           NULL
      FROM public.puntos_anulacion_gastada g
     WHERE g.created_at >= v_desde::timestamp AT TIME ZONE 'America/El_Salvador'
  )
  SELECT coalesce(jsonb_agg(to_jsonb(h)), '[]'::jsonb) INTO v_hallazgos FROM h;

  IF p_simular THEN
    RETURN json_build_object('simulado', true, 'desde', v_desde, 'hallazgos', v_hallazgos);
  END IF;

  SELECT ARRAY[e.id] INTO v_dest
    FROM public.puntos_config pc JOIN public.employees e ON e.id = pc.avisar_fallas_a
   WHERE pc.id AND e.status = 'ACTIVO';
  IF v_dest IS NULL THEN
    SELECT array_agg(e.id) INTO v_dest FROM public.employees e
     WHERE e.status = 'ACTIVO' AND e.role_id IN (2, 3);
  END IF;

  FOR r IN
    WITH ins AS (
      INSERT INTO public.puntos_irregularidad
        (clave, tipo, dia, customer_id, sucursal, invoice_id, employee_id, puntos, nota, detalle)
      SELECT x.clave, x.tipo, x.dia, x.customer_id, x.sucursal, x.invoice_id, x.employee_id, x.puntos, x.nota, x.detalle
        FROM jsonb_to_recordset(v_hallazgos) AS x(clave text, tipo text, dia date, customer_id bigint, sucursal text,
             invoice_id bigint, employee_id uuid, puntos int, nota text, detalle jsonb)
      ON CONFLICT (clave) DO UPDATE
        SET puntos = EXCLUDED.puntos, nota = EXCLUDED.nota, detalle = EXCLUDED.detalle,
            sucursal = EXCLUDED.sucursal, updated_at = now()
        WHERE (puntos_irregularidad.puntos, puntos_irregularidad.nota)
              IS DISTINCT FROM (EXCLUDED.puntos, EXCLUDED.nota)
      RETURNING id, nota, customer_id, avisado_at
    )
    -- Desde la salida del INSERT y no releyendo la tabla: dentro del mismo
    -- comando la consulta de afuera no ve las filas recién insertadas.
    SELECT ins.id, ins.nota, ins.customer_id, c.name AS cliente
      FROM ins LEFT JOIN public.customers c ON c.id = ins.customer_id
     WHERE ins.avisado_at IS NULL
  LOOP
    IF v_dest IS NOT NULL THEN
      PERFORM public.notify_employees(v_dest, 'PUNTOS_IRREGULAR',
        'Puntos: movimiento fuera de lo normal',
        coalesce(r.cliente, 'Cliente ' || r.customer_id) || ' — ' || r.nota,
        '/puntos?tab=avisos', jsonb_build_object('check_key', 'puntos_irregular:' || r.id), true, NULL);
    END IF;
    UPDATE public.puntos_irregularidad SET avisado_at = now() WHERE id = r.id;
    v_nuevos := v_nuevos + 1;
  END LOOP;

  RETURN json_build_object('ok', true, 'hallazgos', jsonb_array_length(v_hallazgos), 'avisados', v_nuevos);
END;
$function$;
