-- ═══════════════════════════════════════════════════════════════════════════
-- Distribución · 0016 — el costo de lo vendido, la utilidad y el libro de compras
-- ═══════════════════════════════════════════════════════════════════════════
-- Sigue a 0015 (compras y costo promedio). Con el costo ya entrando por las
-- compras, falta que SALGA con cada venta y leerlo.
--
-- ── El costo se congela al vender ─────────────────────────────────────────
-- Cada unidad que sale de un lote queda en `dist_lote_asignaciones`; ahí se
-- guarda el costo promedio DE ESE MOMENTO. Calcularlo después con el promedio
-- de hoy haría que la utilidad de marzo cambie cada vez que entra una compra:
-- un reporte cerrado que se mueve solo. Los movimientos del kárdex también lo
-- llevan (el de compra ya lo traía de 0015).
--
-- Las ventas anteriores a este borrador no tienen costo guardado: la utilidad
-- usa el promedio actual y lo marca como ESTIMADO, para que se vea y no se
-- confunda con el dato firme. Lo que no tiene costo de ninguna forma (un
-- producto que nunca entró por compra) se informa aparte y no entra al margen:
-- contarlo con costo cero inflaría la utilidad.
--
-- ── Ventas sin IVA ───────────────────────────────────────────────────────
-- El importe del renglón (precio con IVA × cantidad − descuento, igual que el
-- tablero) dividido entre 1.13. Todo el catálogo de la distribuidora es
-- gravado; el día que haya exentos, esa cuenta se abre acá.
--
-- ── El libro de compras ──────────────────────────────────────────────────
-- Lo que pide el Art. 86 sale de `dist_compras` recibidas. Al libro van los
-- Créditos Fiscales (los que dan crédito); una Factura o un Sujeto excluido se
-- listan en pantalla como «fuera del libro». El archivo lo arma la pantalla con
-- el MISMO generador que el libro de compras de las farmacias (23 columnas).

SET lock_timeout = '5s';

ALTER TABLE public.dist_lote_asignaciones ADD COLUMN IF NOT EXISTS costo_unitario numeric(14,6);

-- El costo del momento, en la asignación y en el movimiento. No pisa uno que
-- ya venga puesto (la compra trae el suyo).
CREATE OR REPLACE FUNCTION public.dist_costo_al_mover()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
BEGIN
    IF NEW.costo_unitario IS NOT NULL THEN RETURN NEW; END IF;
    -- Dos IF y no un OR: `NEW.tipo` en una asignación (que no tiene esa
    -- columna) LANZA aunque la otra mitad del OR sea verdadera — plpgsql arma
    -- la expresión entera. Así estuvo diez minutos: nada se podía facturar.
    IF TG_TABLE_NAME = 'dist_lote_movimientos' THEN
        IF NEW.tipo NOT IN ('venta', 'liberacion', 'devolucion', 'ajuste') THEN RETURN NEW; END IF;
    END IF;
    BEGIN
        SELECT c.costo_promedio INTO NEW.costo_unitario
          FROM public.dist_lotes l
          JOIN public.dist_catalogo c ON c.emisor_id = l.emisor_id AND c.product_id = l.product_id
         WHERE l.id = NEW.lote_id;
    END;
    RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.dist_costo_al_mover() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS dist_costo_al_asignar ON public.dist_lote_asignaciones;
CREATE TRIGGER dist_costo_al_asignar BEFORE INSERT ON public.dist_lote_asignaciones
    FOR EACH ROW EXECUTE FUNCTION public.dist_costo_al_mover();
DROP TRIGGER IF EXISTS dist_costo_al_mover ON public.dist_lote_movimientos;
CREATE TRIGGER dist_costo_al_mover BEFORE INSERT ON public.dist_lote_movimientos
    FOR EACH ROW EXECUTE FUNCTION public.dist_costo_al_mover();

-- ── Utilidad bruta ─────────────────────────────────────────────────────────
-- Un JSON (patrón C). El costo es el margen de la empresa: sólo quien
-- administra la distribuidora lo ve.
CREATE OR REPLACE FUNCTION public.dist_utilidad(p_desde date, p_hasta date, p_ruta text DEFAULT NULL, p_vendedor uuid DEFAULT NULL)
RETURNS json LANGUAGE plpgsql STABLE
SET search_path = public, extensions
SET plan_cache_mode = 'force_custom_plan' AS $$
DECLARE v_res json;
BEGIN
    IF NOT (SELECT public.auth_can_edit_any(ARRAY['distribucion_config'])) THEN
        RAISE EXCEPTION 'DIST_SIN_PERMISO: la utilidad la ve quien administra la distribuidora';
    END IF;
    WITH ventas AS (
        SELECT d.id AS dte_id, d.fec_emi AS fecha, p.id AS pedido_id, p.emisor_id, p.vendedor_id,
               c.id AS cliente_id, c.nombre AS cliente, coalesce(c.ruta, 'Sin ruta') AS ruta
          FROM public.dist_dte d
          JOIN public.dist_pedidos p ON p.id = d.pedido_id
          JOIN public.dist_clientes c ON c.id = p.cliente_id
         WHERE d.tipo IN ('01', '03')
           AND d.estado NOT IN ('descartado', 'invalidado', 'rechazado')
           AND d.fec_emi BETWEEN p_desde AND p_hasta
           AND (p_ruta IS NULL OR coalesce(c.ruta, 'Sin ruta') = p_ruta)
           AND (p_vendedor IS NULL OR p.vendedor_id = p_vendedor)
    ),
    asig AS (
        -- Costo firme por renglón: el promedio ponderado de sus asignaciones vivas.
        SELECT a.item_id, sum(a.unidades * a.costo_unitario) / nullif(sum(a.unidades), 0) AS costo
          FROM public.dist_lote_asignaciones a
         WHERE a.devuelta_at IS NULL AND a.costo_unitario IS NOT NULL
           AND a.pedido_id IN (SELECT pedido_id FROM ventas)
         GROUP BY a.item_id
    ),
    renglones AS (
        SELECT v.*, i.product_id, pr.nombre AS producto,
               (i.cantidad * greatest(coalesce(i.unidades, 1), 1))::numeric AS unidades,
               (round(i.cantidad * i.precio_con_iva, 2) - i.descuento) / 1.13 AS venta,
               coalesce(a.costo, cat.costo_promedio) AS costo_u,
               a.costo IS NULL AND cat.costo_promedio IS NOT NULL AS estimado
          FROM ventas v
          JOIN public.dist_pedido_items i ON i.pedido_id = v.pedido_id
          LEFT JOIN public.products pr ON pr.id = i.product_id
          LEFT JOIN asig a ON a.item_id = i.id
          LEFT JOIN public.dist_catalogo cat ON cat.emisor_id = v.emisor_id AND cat.product_id = i.product_id
    ),
    r AS (
        SELECT *, CASE WHEN costo_u IS NULL THEN NULL ELSE unidades * costo_u END AS costo FROM renglones
    ),
    -- Un grupo: ventas con costo, su costo, y lo que se vendió sin costo (fuera del margen).
    g AS (
        SELECT 'producto' AS por, product_id::text AS clave, max(producto) AS nombre, sum(unidades) AS unidades,
               sum(venta) FILTER (WHERE costo IS NOT NULL) AS venta, sum(costo) AS costo,
               sum(venta) FILTER (WHERE costo IS NULL) AS sin_costo, bool_or(estimado) AS estimado
          FROM r GROUP BY product_id
        UNION ALL
        SELECT 'cliente', cliente_id::text, max(cliente), sum(unidades),
               sum(venta) FILTER (WHERE costo IS NOT NULL), sum(costo), sum(venta) FILTER (WHERE costo IS NULL), bool_or(estimado)
          FROM r GROUP BY cliente_id
        UNION ALL
        SELECT 'ruta', ruta, ruta, sum(unidades),
               sum(venta) FILTER (WHERE costo IS NOT NULL), sum(costo), sum(venta) FILTER (WHERE costo IS NULL), bool_or(estimado)
          FROM r GROUP BY ruta
        UNION ALL
        SELECT 'vendedor', coalesce(r.vendedor_id::text, '—'), max(e.name), sum(unidades),
               sum(venta) FILTER (WHERE costo IS NOT NULL), sum(costo), sum(venta) FILTER (WHERE costo IS NULL), bool_or(estimado)
          FROM r LEFT JOIN public.employees e ON e.id = r.vendedor_id GROUP BY r.vendedor_id
    )
    SELECT json_build_object(
        'resumen', (SELECT json_build_object(
            'venta', round(coalesce(sum(venta) FILTER (WHERE costo IS NOT NULL), 0), 2),
            'costo', round(coalesce(sum(costo), 0), 2),
            'sin_costo', round(coalesce(sum(venta) FILTER (WHERE costo IS NULL), 0), 2),
            'productos_sin_costo', count(DISTINCT product_id) FILTER (WHERE costo IS NULL),
            'estimado', round(coalesce(sum(venta) FILTER (WHERE estimado), 0), 2),
            'documentos', count(DISTINCT dte_id)) FROM r),
        'grupos', (SELECT coalesce(json_agg(json_build_object(
                'por', por, 'clave', clave, 'nombre', coalesce(nombre, '—'), 'unidades', unidades,
                'venta', round(coalesce(venta, 0), 2), 'costo', round(coalesce(costo, 0), 2),
                'sin_costo', round(coalesce(sin_costo, 0), 2), 'estimado', coalesce(estimado, false))
              ORDER BY coalesce(venta, 0) - coalesce(costo, 0) DESC), '[]'::json) FROM g),
        'por_dia', (SELECT coalesce(json_agg(x ORDER BY x.fecha), '[]'::json) FROM (
            SELECT fecha, round(sum(venta) FILTER (WHERE costo IS NOT NULL), 2) AS venta, round(sum(costo), 2) AS costo
              FROM r GROUP BY fecha) x)
    ) INTO v_res;
    RETURN v_res;
END $$;
REVOKE EXECUTE ON FUNCTION public.dist_utilidad(date, date, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dist_utilidad(date, date, text, uuid) TO authenticated, service_role;

-- ── Libro de compras ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.dist_libro_compras(p_desde date, p_hasta date)
RETURNS json LANGUAGE plpgsql STABLE
SET search_path = public, extensions AS $$
BEGIN
    IF NOT (SELECT public.auth_can_edit_any(ARRAY['distribucion_config'])) THEN
        RAISE EXCEPTION 'DIST_SIN_PERMISO: el libro de compras lo ve quien administra la distribuidora';
    END IF;
    RETURN (SELECT coalesce(json_agg(json_build_object(
            'id', c.id, 'fecha', c.fecha, 'tipo_doc', c.tipo_doc, 'numero', c.numero, 'codigo_generacion', c.codigo_generacion,
            'proveedor', p.nombre, 'nit', p.nit, 'nrc', p.nrc, 'relacionada', p.relacionada,
            'exenta', c.exenta, 'gravada', c.gravada, 'iva', c.iva, 'percepcion', c.percepcion, 'retencion', c.retencion,
            'total', c.total, 'en_libro', c.tipo_doc = '03')
          ORDER BY c.fecha, c.id), '[]'::json)
      FROM public.dist_compras c JOIN public.dist_proveedores p ON p.id = c.proveedor_id
     WHERE c.estado = 'recibida' AND c.fecha BETWEEN p_desde AND p_hasta);
END $$;
REVOKE EXECUTE ON FUNCTION public.dist_libro_compras(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dist_libro_compras(date, date) TO authenticated, service_role;
