SET lock_timeout = '5s';

-- Distribución · H2 (3 de 3): la liquidación del vendedor (partido de la
-- definición viva). Cambian cuatro cosas, las cuatro en el efectivo:
--   · `pagos` cuenta lo cobrado al vender aunque el documento se invalide
--     después (el dinero entró ese día), y nunca lo de un pedido que
--     reemplaza a otro (no es dinero nuevo: es el de la venta original);
--   · `reintegros` resta el efectivo devuelto ese día;
--   · `credito` mira sólo documentos vigentes, incluido el reemplazo;
--   · `correcciones`: el efectivo que un reemplazo trae DE MÁS sobre el
--     documento que corrige entra el día del reemplazo (lo de menos ya lo
--     resta `reintegros`). Por forma de pago, nunca cuentan lo mismo.
-- Y `dist_liquidaciones_del_dia` deja de calcular su propio esperado y le
-- pregunta a `dist_liquidacion`: dos jueces del mismo efectivo terminan
-- diciendo números distintos.
CREATE OR REPLACE FUNCTION public.dist_liquidacion(p_vendedor uuid, p_fecha date)
 RETURNS json
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'extensions'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
    v_admin boolean := (SELECT public.auth_can_edit_any(ARRAY['distribucion_config']));
    v_res   json;
BEGIN
    IF NOT v_admin AND p_vendedor IS DISTINCT FROM (SELECT public.auth_employee_id()) THEN
        RAISE EXCEPTION 'DIST_SIN_PERMISO: cada vendedor ve su propia liquidación';
    END IF;
    WITH ventas AS (
        SELECT d.id, d.tipo, d.numero_control, d.hor_emi, d.total_pagar, d.estado, p.id AS pedido_id, p.condicion, c.nombre AS cliente
          FROM public.dist_dte d
          JOIN public.dist_pedidos p ON p.id = d.pedido_id
          JOIN public.dist_clientes c ON c.id = p.cliente_id
         WHERE p.vendedor_id = p_vendedor AND d.fec_emi = p_fecha
           AND d.tipo IN ('01', '03') AND d.estado NOT IN ('descartado', 'invalidado', 'rechazado')
    ),
    pagos AS (
        SELECT pg.forma, pg.monto, pg.referencia, d.numero_control, c.nombre AS cliente, d.estado = 'invalidado' AS invalidado,
               p.reemplaza_dte_id IS NOT NULL AS reemplazo
          FROM public.dist_dte d
          JOIN public.dist_pedidos p ON p.id = d.pedido_id
          JOIN public.dist_clientes c ON c.id = p.cliente_id
          JOIN public.dist_pagos pg ON pg.pedido_id = p.id
         WHERE p.vendedor_id = p_vendedor AND d.fec_emi = p_fecha
           AND d.tipo IN ('01', '03') AND d.estado NOT IN ('descartado', 'rechazado')
    ),
    cobros AS (
        SELECT r.id, r.forma, r.monto, r.referencia, r.created_at, c.nombre AS cliente
          FROM public.dist_recibos r JOIN public.dist_clientes c ON c.id = r.cliente_id
         WHERE r.recibido_por = p_vendedor AND r.anulado_at IS NULL
           AND r.created_at >= (p_fecha::timestamp AT TIME ZONE 'America/El_Salvador')
           AND r.created_at <  ((p_fecha + 1)::timestamp AT TIME ZONE 'America/El_Salvador')
    ),
    devoluciones AS (
        SELECT dv.id, n.numero_control, dv.total, dv.a_favor, dv.credito_aplicado, dv.motivo, c.nombre AS cliente
          FROM public.dist_devoluciones dv
          JOIN public.dist_dte n ON n.id = dv.nota_id AND n.estado NOT IN ('descartado', 'invalidado')
          JOIN public.dist_dte o ON o.id = dv.dte_origen_id
          JOIN public.dist_pedidos p ON p.id = o.pedido_id
          JOIN public.dist_clientes c ON c.id = p.cliente_id
         WHERE dv.estado = 'emitida' AND p.vendedor_id = p_vendedor AND n.fec_emi = p_fecha
    ),
    correcciones AS (
        SELECT n.id, n.numero_control, c.nombre AS cliente,
               greatest(0,
                   coalesce((SELECT sum((x->>'montoPago')::numeric) FROM jsonb_array_elements(coalesce(n.json->'resumen'->'pagos', '[]'::jsonb)) x
                              WHERE x->>'codigo' = '01'), 0)
                 - coalesce((SELECT sum((x->>'montoPago')::numeric) FROM jsonb_array_elements(coalesce(o.json->'resumen'->'pagos', '[]'::jsonb)) x
                              WHERE x->>'codigo' = '01'), 0)) AS monto
          FROM public.dist_dte n
          JOIN public.dist_pedidos p ON p.id = n.pedido_id
          JOIN public.dist_dte o ON o.id = p.reemplaza_dte_id
          JOIN public.dist_clientes c ON c.id = p.cliente_id
         WHERE p.vendedor_id = p_vendedor AND n.fec_emi = p_fecha
           AND n.tipo IN ('01', '03') AND n.estado NOT IN ('descartado', 'rechazado')
    ),
    reintegros AS (
        SELECT ri.id, ri.monto, ri.created_at, d.numero_control, c.nombre AS cliente
          FROM public.dist_reintegros ri
          JOIN public.dist_dte d ON d.id = ri.dte_id
          JOIN public.dist_clientes c ON c.id = ri.cliente_id
         WHERE ri.destino = 'caja' AND ri.vendedor_id = p_vendedor AND ri.fecha = p_fecha
    ),
    caja AS (
        SELECT k.* FROM public.dist_cajas k WHERE k.vendedor_id = p_vendedor AND k.fecha = p_fecha
    ),
    movs AS (
        SELECT m.* FROM public.dist_caja_movimientos m JOIN caja k ON k.id = m.caja_id WHERE m.anulado_at IS NULL
    ),
    efectivo AS (
        SELECT coalesce((SELECT sum(monto) FROM pagos WHERE forma = '01' AND NOT reemplazo), 0)
             + coalesce((SELECT sum(monto) FROM correcciones), 0) AS ventas,
               coalesce((SELECT sum(monto) FROM correcciones), 0) AS correcciones,
               coalesce((SELECT sum(monto) FROM cobros WHERE forma = '01'), 0) AS cobros,
               coalesce((SELECT fondo FROM caja), 0) AS fondo,
               coalesce((SELECT sum(monto) FROM movs WHERE tipo = 'gasto'), 0) AS gastos,
               coalesce((SELECT sum(monto) FROM movs WHERE tipo = 'entrega'), 0) AS entregas,
               coalesce((SELECT sum(monto) FROM movs WHERE tipo = 'ingreso'), 0) AS ingresos,
               coalesce((SELECT sum(monto) FROM reintegros), 0) AS reintegros
    ),
    cierre AS (
        SELECT l.*, e.name AS cerrada_por_nombre FROM public.dist_liquidaciones l
          LEFT JOIN public.employees e ON e.id = l.cerrada_por
         WHERE l.vendedor_id = p_vendedor AND l.fecha = p_fecha AND l.estado = 'cerrada'
    )
    SELECT json_build_object(
        'vendedor', (SELECT json_build_object('id', id, 'name', name) FROM public.employees WHERE id = p_vendedor),
        'fecha', p_fecha,
        'ventas', json_build_object(
            'total', (SELECT coalesce(sum(total_pagar), 0) FROM ventas),
            'documentos', (SELECT count(*) FROM ventas),
            'lista', (SELECT coalesce(json_agg(json_build_object('id', id, 'tipo', tipo, 'numero_control', numero_control,
                          'hora', hor_emi, 'cliente', cliente, 'total', total_pagar, 'estado', estado) ORDER BY hor_emi), '[]'::json) FROM ventas)),
        'por_forma', (SELECT coalesce(json_agg(json_build_object('forma', forma, 'monto', monto, 'origen', origen) ORDER BY forma, origen), '[]'::json) FROM (
            SELECT forma, sum(monto) AS monto, 'ventas' AS origen FROM pagos WHERE NOT reemplazo GROUP BY forma
            UNION ALL SELECT '01', sum(monto), 'ventas' FROM correcciones HAVING sum(monto) > 0
            UNION ALL SELECT forma, sum(monto), 'cobros' FROM cobros GROUP BY forma) f),
        'cobros', json_build_object(
            'total', (SELECT coalesce(sum(monto), 0) FROM cobros),
            'lista', (SELECT coalesce(json_agg(json_build_object('id', id, 'cliente', cliente, 'forma', forma, 'monto', monto,
                          'referencia', referencia, 'hora', created_at) ORDER BY created_at), '[]'::json) FROM cobros)),
        'devoluciones', json_build_object(
            'total', (SELECT coalesce(sum(total), 0) FROM devoluciones),
            'a_favor', (SELECT coalesce(sum(a_favor), 0) FROM devoluciones),
            'lista', (SELECT coalesce(json_agg(json_build_object('id', id, 'numero_control', numero_control, 'cliente', cliente,
                          'total', total, 'a_favor', a_favor, 'motivo', motivo)), '[]'::json) FROM devoluciones)),
        'correcciones', json_build_object(
            'total', (SELECT coalesce(sum(monto), 0) FROM correcciones),
            'lista', (SELECT coalesce(json_agg(json_build_object('id', id, 'numero_control', numero_control, 'cliente', cliente,
                          'monto', monto)), '[]'::json) FROM correcciones WHERE monto > 0)),
        'reintegros', json_build_object(
            'total', (SELECT coalesce(sum(monto), 0) FROM reintegros),
            'lista', (SELECT coalesce(json_agg(json_build_object('id', id, 'numero_control', numero_control, 'cliente', cliente,
                          'monto', monto, 'hora', created_at) ORDER BY created_at), '[]'::json) FROM reintegros)),
        'cheques', (SELECT coalesce(json_agg(json_build_object('monto', monto, 'referencia', referencia, 'cliente', cliente, 'origen', origen)), '[]'::json) FROM (
            SELECT monto, referencia, cliente, 'venta ' || numero_control AS origen FROM pagos WHERE forma = '04' AND NOT reemplazo
            UNION ALL SELECT monto, referencia, cliente, 'cobro' FROM cobros WHERE forma = '04') ch),
        'credito', (SELECT coalesce(sum(monto), 0) FROM pagos WHERE forma = '13' AND NOT invalidado),
        -- A entregar al cerrar: el fondo vuelve con todo lo demás. Lo entregado
        -- en un corte parcial ya se recibió, lo gastado en ruta ya salió, y lo
        -- devuelto a un cliente por una venta deshecha también.
        'efectivo', (SELECT json_build_object('ventas', ventas, 'correcciones', correcciones, 'cobros', cobros, 'fondo', fondo, 'gastos', gastos,
                         'entregas', entregas, 'ingresos', ingresos, 'reintegros', reintegros,
                         'esperado', fondo + ventas + cobros + ingresos - gastos - entregas - reintegros) FROM efectivo),
        'caja', (SELECT json_build_object('id', k.id, 'fondo', k.fondo, 'estado', k.estado, 'abierta_at', k.abierta_at,
                         'abierta_por', (SELECT name FROM public.employees WHERE id = k.abierta_por), 'nota', k.nota) FROM caja k),
        'movimientos', (SELECT coalesce(json_agg(json_build_object('id', m.id, 'tipo', m.tipo, 'monto', m.monto, 'concepto', m.concepto,
                          'contado', m.contado, 'esperado', m.esperado, 'hora', m.created_at,
                          'quien', (SELECT name FROM public.employees WHERE id = m.creado_por)) ORDER BY m.created_at), '[]'::json) FROM movs m),
        'cierre', (SELECT json_build_object('id', c.id, 'contado', c.efectivo_contado, 'esperado', c.efectivo_esperado,
                       'diferencia', c.diferencia, 'nota', c.nota, 'cerrada_at', c.cerrada_at, 'cerrada_por', c.cerrada_por_nombre,
                       -- Lo que se esperaba al cerrar contra lo que se espera hoy: si difiere, algo entró después.
                       'cambio_despues', c.efectivo_esperado <> (SELECT fondo + ventas + cobros + ingresos - gastos - entregas - reintegros FROM efectivo)
                           OR (c.resumen->'ventas'->>'documentos')::int <> (SELECT count(*) FROM ventas)
                           OR (c.resumen->'cobros'->>'total')::numeric <> (SELECT coalesce(sum(monto), 0) FROM cobros))
                     FROM cierre c),
        'puede_cerrar', v_admin
    ) INTO v_res;
    RETURN v_res;
END $function$;

CREATE OR REPLACE FUNCTION public.dist_liquidaciones_del_dia(p_fecha date)
 RETURNS json
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
    IF NOT (SELECT public.auth_can_edit_any(ARRAY['distribucion_config'])) THEN
        RAISE EXCEPTION 'DIST_SIN_PERMISO: las liquidaciones de todos las ve quien administra';
    END IF;
    RETURN (
        WITH mov AS (
            SELECT p.vendedor_id, CASE WHEN d.estado = 'invalidado' THEN 0 ELSE d.total_pagar END AS venta, 0::numeric AS cobro
              FROM public.dist_dte d JOIN public.dist_pedidos p ON p.id = d.pedido_id
             WHERE d.fec_emi = p_fecha AND d.tipo IN ('01', '03') AND d.estado NOT IN ('descartado', 'rechazado')
            UNION ALL
            SELECT r.recibido_por, 0, r.monto
              FROM public.dist_recibos r
             WHERE r.anulado_at IS NULL
               AND r.created_at >= (p_fecha::timestamp AT TIME ZONE 'America/El_Salvador')
               AND r.created_at <  ((p_fecha + 1)::timestamp AT TIME ZONE 'America/El_Salvador')
            UNION ALL
            -- Un vendedor con caja abierta aparece aunque todavía no venda.
            SELECT k.vendedor_id, 0, 0 FROM public.dist_cajas k WHERE k.fecha = p_fecha
            UNION ALL
            SELECT ri.vendedor_id, 0, 0 FROM public.dist_reintegros ri WHERE ri.destino = 'caja' AND ri.fecha = p_fecha
        )
        SELECT coalesce(json_agg(x ORDER BY x.name), '[]'::json) FROM (
            SELECT g.*, ((public.dist_liquidacion(g.id, p_fecha))->'efectivo'->>'esperado')::numeric AS esperado
              FROM (
                SELECT m.vendedor_id AS id, e.name, e.photo_url, sum(m.venta) AS ventas, sum(m.cobro) AS cobros,
                       l.id AS cierre_id, l.efectivo_contado AS contado, l.diferencia,
                       (SELECT k.estado FROM public.dist_cajas k WHERE k.vendedor_id = m.vendedor_id AND k.fecha = p_fecha) AS caja
                  FROM mov m
                  LEFT JOIN public.employees e ON e.id = m.vendedor_id
                  LEFT JOIN public.dist_liquidaciones l ON l.vendedor_id = m.vendedor_id AND l.fecha = p_fecha AND l.estado = 'cerrada'
                 WHERE m.vendedor_id IS NOT NULL
                 GROUP BY m.vendedor_id, e.name, e.photo_url, l.id, l.efectivo_contado, l.diferencia) g) x);
END $function$;
