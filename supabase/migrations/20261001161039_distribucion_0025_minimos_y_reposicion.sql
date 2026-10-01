-- ═══════════════════════════════════════════════════════════════════════════
-- Distribución · 0025 — mínimos, máximos y reposición
-- ═══════════════════════════════════════════════════════════════════════════
-- Qué comprar y a quién, antes de que falte. Por producto del catálogo:
--
--   · DISPONIBLE = existencia vendible (lotes sin vencer) − lo reservado por
--     ventas en curso (0012). Lo vencido se muestra aparte: está en la bodega,
--     pero no se vende.
--   · VELOCIDAD = unidades vendidas en los últimos 60 días ÷ 60, de las ventas
--     vivas (Factura y Crédito Fiscal), menos lo devuelto con nota de crédito.
--   · MÍNIMO / MÁXIMO = los fijados a mano; si no hay, la velocidad × los días
--     de cobertura de la empresa (15 y 45 por defecto). El automático se
--     redondea hacia arriba: con una venta al mes, el mínimo es 1 y no 0.
--   · SUGERIDO = si el disponible llegó al mínimo, lo que falta para el máximo.
--   · PROVEEDOR HABITUAL = el de la última compra recibida, con su costo.
--
-- A diferencia del MIN·MAX de las farmacias, acá sí se puede fijar a mano: la
-- distribuidora arranca sin historia de ventas, y el automático sólo sirve
-- cuando la hay.

SET lock_timeout = '5s';

ALTER TABLE public.dist_catalogo ADD COLUMN IF NOT EXISTS minimo integer CHECK (minimo >= 0);
ALTER TABLE public.dist_catalogo ADD COLUMN IF NOT EXISTS maximo integer CHECK (maximo >= 0);
DO $$ BEGIN
    ALTER TABLE public.dist_catalogo ADD CONSTRAINT dist_catalogo_minmax CHECK (minimo IS NULL OR maximo IS NULL OR maximo >= minimo);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TABLE public.dist_emisores ADD COLUMN IF NOT EXISTS reposicion_min_dias smallint NOT NULL DEFAULT 15 CHECK (reposicion_min_dias BETWEEN 1 AND 180);
ALTER TABLE public.dist_emisores ADD COLUMN IF NOT EXISTS reposicion_max_dias smallint NOT NULL DEFAULT 45 CHECK (reposicion_max_dias BETWEEN 1 AND 365);

CREATE OR REPLACE FUNCTION public.dist_reposicion()
RETURNS json LANGUAGE plpgsql STABLE
SET search_path = public, extensions AS $$
DECLARE v_hoy date := (now() AT TIME ZONE 'America/El_Salvador')::date; v_res json;
BEGIN
    IF NOT (SELECT public.auth_has_module_permission('distribucion', 'can_view')) THEN
        RAISE EXCEPTION 'DIST_SIN_PERMISO: no tienes acceso a la distribuidora';
    END IF;
    WITH cfg AS (SELECT reposicion_min_dias AS dmin, reposicion_max_dias AS dmax FROM public.dist_emisores ORDER BY id LIMIT 1),
    stock AS (
        SELECT l.emisor_id, l.product_id,
               coalesce(sum(l.existencia) FILTER (WHERE l.vence IS NULL OR l.vence > v_hoy), 0) AS vendible,
               coalesce(sum(l.existencia) FILTER (WHERE l.vence <= v_hoy), 0) AS vencido,
               min(l.vence) FILTER (WHERE l.existencia > 0 AND l.vence > v_hoy) AS proximo_vence
          FROM public.dist_lotes l GROUP BY l.emisor_id, l.product_id
    ),
    reservado AS (
        SELECT l.product_id, sum(r.unidades) AS unidades
          FROM public.dist_reservas r JOIN public.dist_lotes l ON l.id = r.lote_id
         WHERE r.vence_at > now() GROUP BY l.product_id
    ),
    vendido AS (
        SELECT i.product_id, sum(i.cantidad * greatest(coalesce(i.unidades, 1), 1)) AS unidades
          FROM public.dist_dte d JOIN public.dist_pedido_items i ON i.pedido_id = d.pedido_id
         WHERE d.tipo IN ('01', '03') AND d.estado NOT IN ('descartado', 'invalidado', 'rechazado')
           AND d.fec_emi > v_hoy - 60
         GROUP BY i.product_id
    ),
    devuelto AS (
        SELECT di.product_id, sum(di.unidades) AS unidades
          FROM public.dist_devolucion_items di JOIN public.dist_devoluciones dv ON dv.id = di.devolucion_id
          JOIN public.dist_dte n ON n.id = dv.nota_id
         WHERE dv.estado = 'emitida' AND n.fec_emi > v_hoy - 60 GROUP BY di.product_id
    ),
    ultima_compra AS (
        SELECT DISTINCT ON (i.product_id) i.product_id, pv.id AS proveedor_id, pv.nombre AS proveedor, i.costo_unitario, c.fecha
          FROM public.dist_compra_items i JOIN public.dist_compras c ON c.id = i.compra_id AND c.estado = 'recibida'
          JOIN public.dist_proveedores pv ON pv.id = c.proveedor_id
         ORDER BY i.product_id, c.fecha DESC, c.id DESC
    ),
    base AS (
        SELECT cat.product_id, pr.nombre, cat.minimo, cat.maximo, cat.costo_promedio,
               coalesce(s.vendible, 0) - coalesce(rv.unidades, 0) AS disponible,
               coalesce(s.vendible, 0) AS vendible, coalesce(s.vencido, 0) AS vencido, coalesce(rv.unidades, 0) AS reservado,
               s.proximo_vence,
               greatest(coalesce(v.unidades, 0) - coalesce(dv.unidades, 0), 0) / 60.0 AS velocidad,
               uc.proveedor_id, uc.proveedor, uc.costo_unitario AS ultimo_costo, uc.fecha AS ultima_compra
          FROM public.dist_catalogo cat
          JOIN public.products pr ON pr.id = cat.product_id
          LEFT JOIN stock s ON s.product_id = cat.product_id AND s.emisor_id = cat.emisor_id
          LEFT JOIN reservado rv ON rv.product_id = cat.product_id
          LEFT JOIN vendido v ON v.product_id = cat.product_id
          LEFT JOIN devuelto dv ON dv.product_id = cat.product_id
          LEFT JOIN ultima_compra uc ON uc.product_id = cat.product_id
         WHERE cat.activo
    ),
    calc AS (
        SELECT b.*,
               coalesce(b.minimo, ceil(b.velocidad * (SELECT dmin FROM cfg))::int) AS minimo_ef,
               coalesce(b.maximo, ceil(b.velocidad * (SELECT dmax FROM cfg))::int) AS maximo_ef,
               b.minimo IS NOT NULL OR b.maximo IS NOT NULL AS manual
          FROM base b
    )
    SELECT json_build_object(
        'config', (SELECT json_build_object('min_dias', dmin, 'max_dias', dmax) FROM cfg),
        'productos', (SELECT coalesce(json_agg(json_build_object(
                'product_id', product_id, 'nombre', nombre, 'disponible', disponible, 'vendible', vendible, 'vencido', vencido,
                'reservado', reservado, 'proximo_vence', proximo_vence, 'velocidad', round(velocidad, 3),
                'dias', CASE WHEN velocidad > 0 THEN floor(disponible / velocidad)::int END,
                'minimo', minimo_ef, 'maximo', greatest(maximo_ef, minimo_ef), 'manual', manual,
                'sugerido', CASE WHEN disponible <= minimo_ef AND greatest(maximo_ef, minimo_ef) > 0
                                 THEN greatest(greatest(maximo_ef, minimo_ef) - disponible, 0) ELSE 0 END,
                'costo', coalesce(ultimo_costo, costo_promedio), 'proveedor_id', proveedor_id, 'proveedor', proveedor, 'ultima_compra', ultima_compra)
              ORDER BY (disponible <= minimo_ef AND greatest(maximo_ef, minimo_ef) > 0) DESC, nombre), '[]'::json) FROM calc)
    ) INTO v_res;
    RETURN v_res;
END $$;
REVOKE EXECUTE ON FUNCTION public.dist_reposicion() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dist_reposicion() TO authenticated, service_role;

-- Fijar a mano (NULL = automático). Sólo quien administra.
CREATE OR REPLACE FUNCTION public.dist_fijar_minmax(p_product integer, p_minimo integer, p_maximo integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
BEGIN
    IF NOT (SELECT public.auth_can_edit_any(ARRAY['distribucion_config'])) THEN
        RAISE EXCEPTION 'DIST_SIN_PERMISO: el mínimo y el máximo los fija quien administra';
    END IF;
    IF p_minimo < 0 OR p_maximo < 0 THEN RAISE EXCEPTION 'DIST_MINMAX: no puede ser negativo'; END IF;
    IF p_minimo IS NOT NULL AND p_maximo IS NOT NULL AND p_maximo < p_minimo THEN
        RAISE EXCEPTION 'DIST_MINMAX: el máximo no puede ser menor que el mínimo';
    END IF;
    UPDATE public.dist_catalogo SET minimo = p_minimo, maximo = p_maximo, updated_at = now() WHERE product_id = p_product;
    IF NOT FOUND THEN RAISE EXCEPTION 'DIST_MINMAX: ese producto no está en el catálogo'; END IF;
END $$;
REVOKE EXECUTE ON FUNCTION public.dist_fijar_minmax(integer, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dist_fijar_minmax(integer, integer, integer) TO authenticated, service_role;
