SET lock_timeout = '5s';

-- `get_inyecciones_aplicadas` nació INVOKER y la pantalla respondió «No tienes
-- permiso» a TODOS, Gerencia incluida: el emparejado lee `employees.code`
-- (quién registró el cobro contra quién vendió) y esa columna no tiene GRANT
-- para `authenticated` — por diseño, el código del empleado es su credencial
-- del kiosco. La prueba del día la corrió `postgres`, que lee todo: la columna
-- sin permiso no se vio hasta que la abrió una persona.
--
-- Pasa a DEFINER con la guarda escrita adentro, que es el patrón del proyecto
-- (regla 4): el permiso `ventas_tab_inyecciones` decide si entra, y el alcance
-- de `ventas` decide qué sala — quien no tiene ALL queda atado a la suya.
-- `employees.code` no sale en la respuesta: sólo se compara. El código que sí
-- viaja es el `cod_vendedor` de la factura, el mismo que ya muestra la pestaña
-- Vendedores.
CREATE OR REPLACE FUNCTION public.get_inyecciones_aplicadas(
  p_branch_id integer,
  p_desde date,
  p_hasta date
)
RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, extensions
SET plan_cache_mode = 'force_custom_plan'
AS $$
DECLARE
  v_ids     bigint[];
  v_ventas  bigint[] := '{}';
  v_cobros  bigint[] := '{}';
  r         record;
BEGIN
  -- La guarda es el permiso de la PESTAÑA, no el RLS: ver el encabezado.
  IF NOT (SELECT auth_has_module_permission('ventas_tab_inyecciones', 'can_view')) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  -- Quien ve Ventas sólo de su sala, ve sólo su sala acá también, pida lo que
  -- pida: el filtro de sala del navegador no es una guarda.
  IF coalesce((SELECT auth_module_scope('ventas')), '') <> 'ALL' THEN
    p_branch_id := (SELECT auth_employee_branch_id());
    IF p_branch_id IS NULL THEN
      RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF p_desde IS NULL OR p_hasta IS NULL OR p_hasta < p_desde THEN
    RAISE EXCEPTION 'Rango de fechas inválido';
  END IF;
  IF p_hasta - p_desde > 92 THEN
    RAISE EXCEPTION 'El rango no puede pasar de tres meses';
  END IF;

  -- La pasada cara —leer cada renglón del período para mirarle el nombre— se
  -- hace UNA vez. Lo que sigue entra por la llave primaria.
  v_ids := ARRAY(
    SELECT DISTINCT si.id
    FROM sales_invoices si
    JOIN sales_invoice_items ii ON ii.invoice_id = si.id
    WHERE si.fecha BETWEEN p_desde AND p_hasta
      AND (p_branch_id IS NULL OR si.branch_id = p_branch_id)
      AND si.estado NOT IN ('NULA', 'DTE INVALIDADO EN MH', 'ANULADA')
      AND si.hora IS NOT NULL
      AND es_inyectable(ii.descripcion)
  );

  FOR r IN
    WITH ventas AS (
      SELECT si.id, si.branch_id, si.fecha, si.fecha + si.hora AS ts, si.cod_vendedor,
             string_agg(upper(ii.descripcion), ' ') AS productos
      FROM sales_invoices si
      JOIN sales_invoice_items ii ON ii.invoice_id = si.id
      WHERE si.id = ANY (v_ids)
        AND es_inyectable(ii.descripcion)
      GROUP BY si.id
    ), cobros AS (
      SELECT p.id, p.branch_id, p.fecha,
             (p.registrado_at AT TIME ZONE 'America/El_Salvador') AS ts,
             e.code,
             upper(nullif(trim(split_part(p.concepto, '·', 2)), '')) AS producto
      FROM caja_movimientos_portal p
      LEFT JOIN employees e ON e.id = p.registrado_por
      WHERE p.tipo_codigo = 'APLICACION'
        AND p.anulado_at IS NULL
        AND p.fecha BETWEEN p_desde AND p_hasta
        AND (p_branch_id IS NULL OR p.branch_id = p_branch_id)
    )
    SELECT v.id AS venta_id, c.id AS cobro_id,
           abs(extract(epoch FROM c.ts - v.ts)) / 60
           + CASE WHEN c.code IS NOT DISTINCT FROM v.cod_vendedor THEN 0 ELSE 5 END
           - CASE WHEN c.producto IS NOT NULL
                   AND strpos(v.productos, split_part(c.producto, ' ', 1)) > 0
                  THEN 3 ELSE 0 END AS puntaje
    FROM ventas v
    JOIN cobros c ON c.branch_id = v.branch_id AND c.fecha = v.fecha
     AND c.ts BETWEEN v.ts - interval '10 minutes' AND v.ts + interval '45 minutes'
    ORDER BY 3, 1, 2
  LOOP
    IF NOT (r.venta_id = ANY (v_ventas)) AND NOT (r.cobro_id = ANY (v_cobros)) THEN
      v_ventas := v_ventas || r.venta_id;
      v_cobros := v_cobros || r.cobro_id;
    END IF;
  END LOOP;

  RETURN (
    WITH pares AS (
      SELECT * FROM unnest(v_ventas, v_cobros) AS t(venta_id, cobro_id)
    ), cobros AS (
      SELECT p.id, p.branch_id, p.fecha,
             to_char(p.registrado_at AT TIME ZONE 'America/El_Salvador', 'HH24:MI') AS hora,
             p.monto, p.concepto, p.registrado_por, e.name AS registrado_nombre,
             pa.venta_id
      FROM caja_movimientos_portal p
      LEFT JOIN employees e ON e.id = p.registrado_por
      LEFT JOIN pares pa ON pa.cobro_id = p.id
      WHERE p.tipo_codigo = 'APLICACION'
        AND p.anulado_at IS NULL
        AND p.fecha BETWEEN p_desde AND p_hasta
        AND (p_branch_id IS NULL OR p.branch_id = p_branch_id)
    ), ventas AS (
      SELECT si.id, si.branch_id, si.fecha, to_char(si.hora, 'HH24:MI') AS hora,
             si.correlativo, si.cliente, si.cod_vendedor, ev.id AS vendedor_id, ev.name AS vendedor_nombre,
             json_agg(json_build_object('descripcion', ii.descripcion,
                                        'cantidad', ii.cantidad,
                                        'total', ii.total_linea) ORDER BY ii.linea_num) AS productos,
             sum(ii.cantidad) AS unidades,
             sum(ii.total_linea) AS total,
             pa.cobro_id
      FROM sales_invoices si
      JOIN sales_invoice_items ii ON ii.invoice_id = si.id
      LEFT JOIN employees ev ON ev.code = si.cod_vendedor
      LEFT JOIN pares pa ON pa.venta_id = si.id
      WHERE si.id = ANY (v_ids)
        AND es_inyectable(ii.descripcion)
      GROUP BY si.id, ev.id, ev.name, pa.cobro_id
    )
    SELECT json_build_object(
      'ventas', coalesce((
        SELECT json_agg(json_build_object(
                 'id', v.id, 'branch_id', v.branch_id, 'fecha', v.fecha, 'hora', v.hora,
                 'correlativo', v.correlativo, 'cliente', v.cliente,
                 'cod_vendedor', v.cod_vendedor, 'vendedor_id', v.vendedor_id,
                 'vendedor_nombre', v.vendedor_nombre,
                 'productos', v.productos, 'unidades', v.unidades, 'total', v.total,
                 'cobro', CASE WHEN c.id IS NULL THEN NULL ELSE json_build_object(
                   'id', c.id, 'hora', c.hora, 'monto', c.monto, 'concepto', c.concepto,
                   'registrado_por', c.registrado_por, 'registrado_nombre', c.registrado_nombre) END
               ) ORDER BY v.fecha DESC, v.hora DESC)
        FROM ventas v LEFT JOIN cobros c ON c.id = v.cobro_id
      ), '[]'::json),
      'cobros_sin_venta', coalesce((
        SELECT json_agg(json_build_object(
                 'id', c.id, 'branch_id', c.branch_id, 'fecha', c.fecha, 'hora', c.hora,
                 'monto', c.monto, 'concepto', c.concepto,
                 'registrado_por', c.registrado_por, 'registrado_nombre', c.registrado_nombre
               ) ORDER BY c.fecha DESC, c.hora DESC)
        FROM cobros c WHERE c.venta_id IS NULL
      ), '[]'::json)
    )
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_inyecciones_aplicadas(integer, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_inyecciones_aplicadas(integer, date, date) TO authenticated, service_role;
