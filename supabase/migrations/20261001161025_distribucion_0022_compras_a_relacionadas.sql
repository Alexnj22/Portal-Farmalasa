-- ═══════════════════════════════════════════════════════════════════════════
-- Distribución · 0022 — compras a partes relacionadas (Farmalasa → Torogoz)
-- ═══════════════════════════════════════════════════════════════════════════
-- Entre dos empresas con NIT distinto no existe «pasar» mercadería: es una
-- VENTA de Farmalasa (su Crédito Fiscal, desde su sistema) y una COMPRA de
-- Torogoz (Compras, con el proveedor marcado `relacionada`). Eso ya existía
-- (0015). Lo que faltaba es lo que la ley agrega cuando las dos son del mismo
-- grupo: el precio tiene que ser el de MERCADO —el que se le cobraría a un
-- tercero— (principio de libre competencia, Código Tributario), y si las
-- operaciones con relacionadas del año pasan el monto que fija la ley hay que
-- presentar el informe de precios de transferencia (F-982). El margen concreto
-- y si aplica el F-982 los confirma el contador; esto le da los números.
--
-- ── Las referencias de precio, por unidad ────────────────────────────────
--   · costo de Farmalasa: `product_precios.costo` — el precio NETO (sin IVA)
--     de su factura de compra, de la presentación más chica, ÷ su factor;
--   · mayoreo de Farmalasa: `product_precios.mayoreo` — su precio a terceros,
--     CON IVA (como `vineta`, ver descuentos-erp), ÷ factor ÷ 1.13;
--   · precio de venta de Torogoz: `dist_catalogo.precio_con_iva` ÷ 1.13;
--   · costo promedio de Torogoz (0015).
-- Todo sin IVA, porque lo pagado en un Crédito Fiscal es sin IVA. La regla de
-- qué es «fuera de mercado» vive en la pantalla (`views/distribucion/compras.js`,
-- `evaluarPrecioRelacionada`), UNA vez, y la usan la compra y el reporte.
--
-- DEFINER con permiso de quien administra la distribuidora: son costos de
-- Farmalasa, que el resto de la distribuidora no tiene por qué ver.

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.dist_referencias_relacionada(p_productos integer[])
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, extensions AS $$
BEGIN
    IF NOT (SELECT public.auth_can_edit_any(ARRAY['distribucion_config'])) THEN
        RAISE EXCEPTION 'DIST_SIN_PERMISO: las referencias de precio las ve quien administra la distribuidora';
    END IF;
    RETURN (
        SELECT coalesce(json_object_agg(p.pid, json_build_object(
                'costo_farmalasa', pp.costo_u, 'mayoreo_sin_iva', pp.mayoreo_u,
                'precio_torogoz_sin_iva', round(cat.precio_con_iva / 1.13, 6), 'costo_promedio_torogoz', cat.costo_promedio)), '{}'::json)
          FROM unnest(p_productos) AS p(pid)
          -- Costo: el de la presentación más chica. Mayoreo: el MÁS BAJO por
          -- unidad entre sus presentaciones (hay productos con dos filas de
          -- unidad y mayoreos distintos): la referencia más prudente, que sólo
          -- avisa si se vende bajo el precio más barato que ya se da a otros.
          LEFT JOIN LATERAL (
              SELECT (SELECT round(x.costo / greatest(coalesce(x.factor, 1), 1), 6) FROM public.product_precios x
                       WHERE x.product_id = p.pid AND coalesce(x.activo, true) AND x.costo > 0
                       ORDER BY greatest(coalesce(x.factor, 1), 1), x.id LIMIT 1) AS costo_u,
                     (SELECT round(min(x.mayoreo / greatest(coalesce(x.factor, 1), 1)) / 1.13, 6) FROM public.product_precios x
                       WHERE x.product_id = p.pid AND coalesce(x.activo, true) AND x.mayoreo > 0) AS mayoreo_u) pp ON true
          LEFT JOIN public.dist_catalogo cat ON cat.product_id = p.pid
    );
END $$;
REVOKE EXECUTE ON FUNCTION public.dist_referencias_relacionada(integer[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dist_referencias_relacionada(integer[]) TO authenticated, service_role;

-- ── El reporte: lo comprado a relacionadas, con sus referencias ───────────
CREATE OR REPLACE FUNCTION public.dist_relacionadas(p_desde date, p_hasta date)
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, extensions
SET plan_cache_mode = 'force_custom_plan' AS $$
DECLARE v_res json; v_anio date := date_trunc('year', p_hasta)::date;
BEGIN
    IF NOT (SELECT public.auth_can_edit_any(ARRAY['distribucion_config'])) THEN
        RAISE EXCEPTION 'DIST_SIN_PERMISO: el reporte de relacionadas lo ve quien administra la distribuidora';
    END IF;
    WITH compras AS (
        SELECT c.id, c.fecha, c.numero, c.tipo_doc, c.gravada, c.exenta, c.iva, c.total, pv.id AS proveedor_id, pv.nombre AS proveedor, pv.nit
          FROM public.dist_compras c JOIN public.dist_proveedores pv ON pv.id = c.proveedor_id
         WHERE c.estado = 'recibida' AND pv.relacionada AND c.fecha BETWEEN p_desde AND p_hasta
    ),
    renglones AS (
        SELECT i.product_id, pr.nombre, sum(i.cantidad) AS unidades, sum(i.cantidad * i.costo_unitario) AS pagado,
               count(DISTINCT i.compra_id) AS compras
          FROM public.dist_compra_items i JOIN compras c ON c.id = i.compra_id
          LEFT JOIN public.products pr ON pr.id = i.product_id
         GROUP BY i.product_id, pr.nombre
    )
    SELECT json_build_object(
        'resumen', (SELECT json_build_object('compras', count(*), 'gravada', coalesce(sum(gravada), 0), 'exenta', coalesce(sum(exenta), 0),
                                              'iva', coalesce(sum(iva), 0), 'total', coalesce(sum(total), 0)) FROM compras),
        -- Lo del año calendario hasta la fecha: es lo que se compara con el
        -- umbral del F-982.
        'anio', (SELECT json_build_object('desde', v_anio, 'hasta', p_hasta, 'total', coalesce(sum(c.gravada + c.exenta), 0))
                   FROM public.dist_compras c JOIN public.dist_proveedores pv ON pv.id = c.proveedor_id
                  WHERE c.estado = 'recibida' AND pv.relacionada AND c.fecha BETWEEN v_anio AND p_hasta),
        'por_proveedor', (SELECT coalesce(json_agg(x ORDER BY x.monto DESC), '[]'::json) FROM (
                    SELECT proveedor_id AS id, proveedor AS nombre, nit, count(*) AS compras, sum(gravada + exenta) AS monto FROM compras
                     GROUP BY proveedor_id, proveedor, nit) x),
        'por_mes', (SELECT coalesce(json_agg(x ORDER BY x.mes), '[]'::json) FROM (
                    SELECT to_char(fecha, 'YYYY-MM') AS mes, count(*) AS compras, sum(gravada + exenta) AS monto FROM compras GROUP BY 1) x),
        'productos', (SELECT coalesce(json_agg(json_build_object('product_id', r.product_id, 'nombre', r.nombre, 'unidades', r.unidades,
                          'pagado', round(r.pagado, 2), 'pagado_u', round(r.pagado / nullif(r.unidades, 0), 6), 'compras', r.compras)
                        ORDER BY r.pagado DESC), '[]'::json) FROM renglones r),
        'referencias', public.dist_referencias_relacionada((SELECT coalesce(array_agg(product_id), '{}') FROM renglones)),
        'documentos', (SELECT coalesce(json_agg(json_build_object('id', id, 'fecha', fecha, 'numero', numero, 'proveedor', proveedor,
                          'gravada', gravada, 'iva', iva, 'total', total) ORDER BY fecha DESC, id DESC), '[]'::json) FROM compras)
    ) INTO v_res;
    RETURN v_res;
END $$;
REVOKE EXECUTE ON FUNCTION public.dist_relacionadas(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dist_relacionadas(date, date) TO authenticated, service_role;
