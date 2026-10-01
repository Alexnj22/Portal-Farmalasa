-- ═══════════════════════════════════════════════════════════════════════════
-- Distribución · 0011 — el tablero (Inicio de Torogoz)
-- ═══════════════════════════════════════════════════════════════════════════
-- Pedido del usuario (2026-09-29): «un dashboard en la distribuidora con datos
-- de ventas, clientes, etc.».
--
-- UNA función que devuelve todo el tablero como un solo JSON:
--   · Patrón C de CLAUDE.md: un objeto JSON no cae bajo el techo de 1000 filas
--     de PostgREST, y el navegador no suma miles de renglones.
--   · INVOKER: el RLS de `dist_*` sigue decidiendo quién ve qué.
--   · plpgsql + `force_custom_plan`: el plan bueno depende del rango de fechas
--     (trampas 1 y 4 de CLAUDE.md: nunca `LANGUAGE sql` con `SET`).
--
-- Qué es «venta»: un documento de venta (Factura o Crédito Fiscal) que NO se
-- descartó, invalidó ni rechazó. Los «sin firmar» cuentan: son ventas hechas
-- que esperan salir a Hacienda (en pruebas no hay credenciales de Hacienda).
--
-- Los filtros (ruta, vendedor) valen para todo el tablero; el período anterior
-- es el de igual largo justo antes, para comparar.

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.dist_tablero(
    p_desde date, p_hasta date, p_ruta text DEFAULT NULL, p_vendedor uuid DEFAULT NULL)
RETURNS json
LANGUAGE plpgsql STABLE
SET search_path = public, extensions
SET plan_cache_mode = 'force_custom_plan'
AS $$
DECLARE
    v_dias     integer := greatest(1, p_hasta - p_desde + 1);
    v_ant_des  date := p_desde - greatest(1, p_hasta - p_desde + 1);
    v_ant_has  date := p_desde - 1;
    v_res      json;
BEGIN
    WITH ventas AS (
        -- Cada documento de venta vivo, con su cliente y quien vendió.
        SELECT d.id AS dte_id, d.fec_emi AS fecha, d.hor_emi AS hora, d.total_pagar AS total, d.tipo,
               p.id AS pedido_id, p.vendedor_id, c.id AS cliente_id, c.nombre AS cliente, c.tipo AS cliente_tipo,
               coalesce(c.ruta, 'Sin ruta') AS ruta
          FROM public.dist_dte d
          JOIN public.dist_pedidos p ON p.id = d.pedido_id
          JOIN public.dist_clientes c ON c.id = p.cliente_id
         WHERE d.tipo IN ('01', '03')
           AND d.estado NOT IN ('descartado', 'invalidado', 'rechazado')
           AND d.fec_emi BETWEEN v_ant_des AND p_hasta
           AND (p_ruta IS NULL OR coalesce(c.ruta, 'Sin ruta') = p_ruta)
           AND (p_vendedor IS NULL OR p.vendedor_id = p_vendedor)
    ),
    actual AS (SELECT * FROM ventas WHERE fecha BETWEEN p_desde AND p_hasta),
    anterior AS (SELECT * FROM ventas WHERE fecha BETWEEN v_ant_des AND v_ant_has),
    renglones AS (
        SELECT a.pedido_id, a.fecha, i.product_id, i.cantidad * greatest(coalesce(i.unidades, 1), 1) AS unidades,
               round(i.cantidad * i.precio_con_iva, 2) - i.descuento AS importe
          FROM actual a JOIN public.dist_pedido_items i ON i.pedido_id = a.pedido_id
    ),
    dias AS (SELECT g::date AS fecha FROM generate_series(p_desde, p_hasta, interval '1 day') g),
    ultima AS (
        -- Última compra de cada cliente (en toda la historia, con los mismos filtros).
        SELECT c.id, c.nombre, c.tipo, coalesce(c.ruta, 'Sin ruta') AS ruta, max(d.fec_emi) AS ultima,
               coalesce(sum(d.total_pagar), 0) AS historico
          FROM public.dist_clientes c
          LEFT JOIN public.dist_pedidos p ON p.cliente_id = c.id AND (p_vendedor IS NULL OR p.vendedor_id = p_vendedor)
          LEFT JOIN public.dist_dte d ON d.id = p.dte_id AND d.tipo IN ('01','03')
                AND d.estado NOT IN ('descartado','invalidado','rechazado') AND d.fec_emi <= p_hasta
         -- Sólo a quien se le puede vender: el tablero ofrece «Vender» sobre esta lista.
         WHERE c.activo AND c.licencia_srs IS NOT NULL
           AND (c.licencia_srs_vence IS NULL OR c.licencia_srs_vence >= current_date)
           AND (p_ruta IS NULL OR coalesce(c.ruta, 'Sin ruta') = p_ruta)
         GROUP BY c.id
    )
    SELECT json_build_object(
        'periodo', json_build_object('desde', p_desde, 'hasta', p_hasta, 'dias', v_dias,
                                     'anterior_desde', v_ant_des, 'anterior_hasta', v_ant_has),
        'resumen', (SELECT json_build_object(
                'ventas', coalesce(sum(total), 0), 'documentos', count(*), 'clientes', count(DISTINCT cliente_id),
                'ticket', coalesce(round(avg(total), 2), 0),
                'unidades', (SELECT coalesce(sum(unidades), 0) FROM renglones)) FROM actual),
        'anterior', (SELECT json_build_object(
                'ventas', coalesce(sum(total), 0), 'documentos', count(*), 'clientes', count(DISTINCT cliente_id),
                'ticket', coalesce(round(avg(total), 2), 0)) FROM anterior),
        'serie', (SELECT coalesce(json_agg(json_build_object(
                    'fecha', dd.fecha, 'ventas', coalesce(x.ventas, 0), 'documentos', coalesce(x.docs, 0),
                    'anterior', coalesce(y.ventas, 0)) ORDER BY dd.fecha), '[]'::json)
                    FROM dias dd
                    LEFT JOIN (SELECT fecha, sum(total) AS ventas, count(*) AS docs FROM actual GROUP BY fecha) x ON x.fecha = dd.fecha
                    LEFT JOIN (SELECT fecha, sum(total) AS ventas FROM anterior GROUP BY fecha) y ON y.fecha = dd.fecha - v_dias),
        'por_ruta', (SELECT coalesce(json_agg(r ORDER BY r.ventas DESC), '[]'::json) FROM (
                    SELECT ruta, sum(total) AS ventas, count(*) AS documentos, count(DISTINCT cliente_id) AS clientes
                      FROM actual GROUP BY ruta) r),
        'por_tipo', (SELECT coalesce(json_agg(t ORDER BY t.ventas DESC), '[]'::json) FROM (
                    SELECT cliente_tipo AS tipo, sum(total) AS ventas, count(*) AS documentos, count(DISTINCT cliente_id) AS clientes
                      FROM actual GROUP BY cliente_tipo) t),
        'por_vendedor', (SELECT coalesce(json_agg(v ORDER BY v.ventas DESC), '[]'::json) FROM (
                    SELECT a.vendedor_id AS id, e.name, e.photo_url, sum(a.total) AS ventas, count(*) AS documentos,
                           count(DISTINCT a.cliente_id) AS clientes
                      FROM actual a LEFT JOIN public.employees e ON e.id = a.vendedor_id
                     GROUP BY a.vendedor_id, e.name, e.photo_url) v),
        'por_dia_semana', (SELECT coalesce(json_agg(w ORDER BY w.dia), '[]'::json) FROM (
                    SELECT extract(isodow FROM fecha)::int AS dia, sum(total) AS ventas, count(*) AS documentos
                      FROM actual GROUP BY 1) w),
        'por_hora', (SELECT coalesce(json_agg(h ORDER BY h.hora), '[]'::json) FROM (
                    SELECT extract(hour FROM hora)::int AS hora, count(*) AS documentos, sum(total) AS ventas
                      FROM actual GROUP BY 1) h),
        'top_productos', (SELECT coalesce(json_agg(tp ORDER BY tp.ventas DESC), '[]'::json) FROM (
                    SELECT r.product_id, pr.nombre, sum(r.unidades) AS unidades, sum(r.importe) AS ventas,
                           count(DISTINCT r.pedido_id) AS documentos
                      FROM renglones r JOIN public.products pr ON pr.id = r.product_id
                     GROUP BY r.product_id, pr.nombre ORDER BY sum(r.importe) DESC LIMIT 10) tp),
        'top_clientes', (SELECT coalesce(json_agg(tc ORDER BY tc.ventas DESC), '[]'::json) FROM (
                    SELECT cliente_id AS id, cliente AS nombre, cliente_tipo AS tipo, ruta, sum(total) AS ventas,
                           count(*) AS documentos, max(fecha) AS ultima
                      FROM actual GROUP BY cliente_id, cliente, cliente_tipo, ruta ORDER BY sum(total) DESC LIMIT 10) tc),
        'formas_pago', (SELECT coalesce(json_agg(f ORDER BY f.monto DESC), '[]'::json) FROM (
                    SELECT pg.forma, sum(pg.monto) AS monto, count(DISTINCT pg.pedido_id) AS documentos
                      FROM public.dist_pagos pg WHERE pg.pedido_id IN (SELECT pedido_id FROM actual)
                     GROUP BY pg.forma) f),
        'inactivos', (SELECT json_build_object(
                    'total', count(*),
                    'lista', coalesce(json_agg(json_build_object('id', id, 'nombre', nombre, 'tipo', tipo, 'ruta', ruta,
                                                'ultima', ultima, 'historico', historico) ORDER BY ultima NULLS FIRST)
                              FILTER (WHERE rn <= 8), '[]'::json))
                    FROM (SELECT *, row_number() OVER (ORDER BY ultima NULLS FIRST) AS rn FROM ultima
                           WHERE ultima IS NULL OR ultima < p_hasta - 30) u),
        'preventas', (SELECT json_build_object('total', count(DISTINCT p.id),
                    'monto', coalesce(sum(round(i.cantidad * i.precio_con_iva, 2) - i.descuento), 0))
                    FROM public.dist_pedidos p JOIN public.dist_clientes c ON c.id = p.cliente_id
                    LEFT JOIN public.dist_pedido_items i ON i.pedido_id = p.id
                    WHERE p.estado = 'confirmado' AND p.created_at >= now() - interval '60 days'
                      AND (p_ruta IS NULL OR coalesce(c.ruta, 'Sin ruta') = p_ruta)
                      AND (p_vendedor IS NULL OR p.vendedor_id = p_vendedor)),
        'inventario', json_build_object(
                'valor', (SELECT coalesce(sum(l.existencia * cat.precio_con_iva), 0)
                            FROM public.dist_lotes l JOIN public.dist_catalogo cat
                              ON cat.product_id = l.product_id AND cat.emisor_id = l.emisor_id WHERE l.existencia > 0),
                'unidades', (SELECT coalesce(sum(existencia), 0) FROM public.dist_lotes WHERE existencia > 0),
                'sin_existencia', (SELECT count(*) FROM public.dist_catalogo cat WHERE cat.activo
                                     AND NOT EXISTS (SELECT 1 FROM public.dist_lotes l WHERE l.product_id = cat.product_id
                                                      AND l.emisor_id = cat.emisor_id AND l.existencia > 0)),
                'por_vencer', (SELECT coalesce(json_agg(pv ORDER BY pv.vence), '[]'::json) FROM (
                        SELECT l.id, l.lote, l.vence, l.existencia, pr.nombre, (l.vence - current_date) AS dias
                          FROM public.dist_lotes l JOIN public.products pr ON pr.id = l.product_id
                         WHERE l.existencia > 0 AND l.vence IS NOT NULL AND l.vence <= current_date + 90
                         ORDER BY l.vence LIMIT 8) pv),
                'por_vencer_total', (SELECT count(*) FROM public.dist_lotes
                                      WHERE existencia > 0 AND vence IS NOT NULL AND vence <= current_date + 90)),
        'perdidas', json_build_object(
                'pendientes', (SELECT count(*) FROM public.dist_ventas_perdidas WHERE estado = 'pendiente'),
                'top', (SELECT coalesce(json_agg(vp ORDER BY vp.cantidad DESC), '[]'::json) FROM (
                        SELECT producto, sum(cantidad) AS cantidad, count(*) AS veces
                          FROM public.dist_ventas_perdidas WHERE estado = 'pendiente'
                         GROUP BY producto ORDER BY sum(cantidad) DESC LIMIT 5) vp)),
        'filtros', json_build_object(
                'rutas', (SELECT coalesce(json_agg(DISTINCT coalesce(ruta, 'Sin ruta')), '[]'::json) FROM public.dist_clientes WHERE activo),
                'vendedores', (SELECT coalesce(json_agg(json_build_object('id', e.id, 'name', e.name) ORDER BY e.name), '[]'::json)
                                 FROM public.employees e WHERE e.id IN (SELECT DISTINCT vendedor_id FROM public.dist_pedidos)))
    ) INTO v_res;
    RETURN v_res;
END $$;

REVOKE EXECUTE ON FUNCTION public.dist_tablero(date, date, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dist_tablero(date, date, text, uuid) TO authenticated, service_role;
