-- El cobro de aplicación se empareja PRIMERO con una venta que tenga el
-- producto que nombra; la cercanía en el tiempo decide entre esas.
--
-- Salud 4, 30-sep-2026: un único cobro «Aplicacion de inyeccion · DEPO PROVERA»
-- a las 18:06 se emparejó con PULMO GRIP (17:55) y no con DEPO PROVERA (17:34).
-- El nombre valía −3 minutos: 11 contra 32−3 = 29, ganaba la venta cercana. La
-- pantalla decía cobrada la que no y sin cobro la que sí.
--
-- Ahora no coincidir con el nombre cuesta +1000: una venta con el producto
-- siempre gana a una sin él, y si ninguna venta del margen lo tiene, el cobro
-- igual cae en la más cercana (no se pierde). NO se exige la coincidencia:
-- medido sobre 766 cobros con producto, 123 tienen en el margen ventas que no
-- coinciden por cómo se escribió el detalle («NOMAGESTT», «1 NEUROBION 25.000»,
-- «APLICACIÓN DE NEUROBIÓN»); exigirla los dejaría sueltos.
--
-- La coincidencia también mejora: sin tildes, por CUALQUIER palabra de 4+
-- letras del detalle (no sólo la primera, que era «1» o «APLICACIÓN»), o por el
-- detalle entero sin espacios («DEPOPROVERA»).
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.get_inyecciones_aplicadas(p_branch_id integer, p_desde date, p_hasta date)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
  v_ids     bigint[];
  v_iny     text[];
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
  -- hace UNA vez, y barata (auditada el 2026-09-24; con 92 días y todas las
  -- salas era 240,735 bloques y 1.1 s, el 78% de la función):
  --
  --   · los renglones se leen por RANGO de `invoice_id` —las facturas de un
  --     período son casi contiguas— sobre el índice cubridor, y se cruzan con
  --     las facturas del período. Antes era una búsqueda en el índice por cada
  --     una de las ~64,000 facturas;
  --   · `es_inyectable` se evalúa una vez por DESCRIPCIÓN distinta (~3,200), no
  --     por renglón (~114,000). El `DISTINCT` va en su propio CTE materializado:
  --     sin esa cerca el planificador baja el filtro por debajo y vuelve a
  --     evaluarlo renglón por renglón.
  --
  -- `v_iny` son las descripciones inyectables del período. Los dos pasos de
  -- abajo filtran con `= ANY (v_iny)` en vez de volver a la expresión regular:
  -- es la misma respuesta, porque sus renglones son de estas mismas facturas.
  WITH f AS MATERIALIZED (
    SELECT si.id
    FROM sales_invoices si
    WHERE si.fecha BETWEEN p_desde AND p_hasta
      AND (p_branch_id IS NULL OR si.branch_id = p_branch_id)
      AND public.venta_valida(si.estado)
      AND si.hora IS NOT NULL
  ), rango AS MATERIALIZED (
    SELECT min(id) AS lo, max(id) AS hi FROM f
  ), renglones AS MATERIALIZED (
    SELECT ii.invoice_id, ii.descripcion
    FROM rango JOIN sales_invoice_items ii ON ii.invoice_id BETWEEN rango.lo AND rango.hi
  ), descripciones AS MATERIALIZED (
    SELECT DISTINCT descripcion FROM renglones
  ), inyectables AS MATERIALIZED (
    SELECT descripcion FROM descripciones WHERE es_inyectable(descripcion)
  )
  SELECT coalesce((SELECT array_agg(descripcion) FROM inyectables), '{}'),
         coalesce((SELECT array_agg(DISTINCT x.invoice_id)
                     FROM renglones x
                     JOIN inyectables i ON i.descripcion = x.descripcion
                     JOIN f ON f.id = x.invoice_id), '{}')
    INTO v_iny, v_ids;

  -- Emparejamiento: menor puntaje gana, cada venta y cada cobro una sola vez.
  --   minutos entre venta y cobro
  --   + 5    si el cobro lo registró otra persona que el vendedor
  --   + 1000 si el cobro nombra un producto y la venta no lo tiene
  FOR r IN
    WITH ventas AS (
      SELECT si.id, si.branch_id, si.fecha, si.fecha + si.hora AS ts, si.cod_vendedor,
             translate(string_agg(upper(ii.descripcion), ' '), 'ÁÉÍÓÚÜÑ', 'AEIOUUN') AS productos
      FROM sales_invoices si
      JOIN sales_invoice_items ii ON ii.invoice_id = si.id
      WHERE si.id = ANY (v_ids)
        AND ii.descripcion = ANY (v_iny)
      GROUP BY si.id
    ), cobros AS (
      SELECT p.id, p.branch_id, p.fecha,
             (p.registrado_at AT TIME ZONE 'America/El_Salvador') AS ts,
             e.code,
             translate(upper(nullif(trim(split_part(p.concepto, '·', 2)), '')),
                       'ÁÉÍÓÚÜÑ', 'AEIOUUN') AS producto
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
           + CASE WHEN c.producto IS NULL THEN 0
                  WHEN strpos(replace(v.productos, ' ', ''), replace(c.producto, ' ', '')) > 0 THEN 0
                  WHEN EXISTS (
                    SELECT 1 FROM regexp_split_to_table(c.producto, '[^A-Z0-9]+') w
                    WHERE length(w) >= 4
                      AND w NOT IN ('APLICACION', 'INYECCION', 'AMPOLLA', 'AMPOLLAS', 'VIAL')
                      AND strpos(v.productos, w) > 0) THEN 0
                  ELSE 1000 END AS puntaje
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
        AND ii.descripcion = ANY (v_iny)
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
               ) ORDER BY v.fecha DESC, v.hora DESC, v.id DESC)
        FROM ventas v LEFT JOIN cobros c ON c.id = v.cobro_id
      ), '[]'::json),
      'cobros_sin_venta', coalesce((
        SELECT json_agg(json_build_object(
                 'id', c.id, 'branch_id', c.branch_id, 'fecha', c.fecha, 'hora', c.hora,
                 'monto', c.monto, 'concepto', c.concepto,
                 'registrado_por', c.registrado_por, 'registrado_nombre', c.registrado_nombre
               ) ORDER BY c.fecha DESC, c.hora DESC, c.id DESC)
        FROM cobros c WHERE c.venta_id IS NULL
      ), '[]'::json)
    )
  );
END;
$function$;
