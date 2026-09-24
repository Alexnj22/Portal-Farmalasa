SET lock_timeout = '5s';
-- Auditoría de `get_inyecciones_aplicadas` (2026-09-24), la pestaña Inyecciones
-- de Ventas. `gate:perf` la levantó sin declarar: 324 MB por llamada. Medida como
-- usuario, con 92 días y todas las salas leía 308,174 bloques (2.4 GB) y tardaba
-- 2.5 s — el tamaño de lectura que llena el pool del portal.
--
-- El 78% era la primera pasada: una búsqueda en el índice por cada una de las
-- ~64,000 facturas del período, y `es_inyectable` —dos expresiones regulares—
-- evaluada renglón por renglón (~114,000). Ahora:
--
--   · los renglones se leen por RANGO de `invoice_id` sobre el índice cubridor
--     y se cruzan con las facturas del período (la técnica de 20260922165346);
--   · la expresión se evalúa una vez por DESCRIPCIÓN distinta (~3,200), con el
--     `DISTINCT` en su propio CTE materializado: sin esa cerca el planificador
--     baja el filtro por debajo y vuelve a evaluarlo renglón por renglón;
--   · los dos pasos siguientes filtran con `= ANY (v_iny)` —las descripciones
--     inyectables del período— en vez de repetir la expresión.
--
-- Medido como usuario: 92 días y todas las salas 308,174 → 109,521 bloques y
-- 2.5 s → 0.5 s; el período por defecto 74,996 → 31,205 y ~0.8 s → 0.16 s.
-- Contenido IDÉNTICO en seis casos (por defecto, 92 días, una sala, un día,
-- agosto de La Popular): cada venta con sus productos y su cobro, y cada cobro
-- sin venta.
--
-- Único cambio visible, y a propósito: las dos listas desempatan por `id`. El
-- orden era fecha y hora `HH24:MI`, así que dos ventas del mismo minuto salían
-- en el orden que eligiera el plan — podía cambiar de una recarga a otra.
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
      AND si.estado NOT IN ('NULA', 'DTE INVALIDADO EN MH', 'ANULADA')
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

  FOR r IN
    WITH ventas AS (
      SELECT si.id, si.branch_id, si.fecha, si.fecha + si.hora AS ts, si.cod_vendedor,
             string_agg(upper(ii.descripcion), ' ') AS productos
      FROM sales_invoices si
      JOIN sales_invoice_items ii ON ii.invoice_id = si.id
      WHERE si.id = ANY (v_ids)
        AND ii.descripcion = ANY (v_iny)
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
$$;

REVOKE EXECUTE ON FUNCTION public.get_inyecciones_aplicadas(integer, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_inyecciones_aplicadas(integer, date, date) TO authenticated, service_role;
