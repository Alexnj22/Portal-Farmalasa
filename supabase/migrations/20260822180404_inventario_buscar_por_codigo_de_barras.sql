-- Inventario: buscar por código de barras, sin tocar la vista materializada.
--
-- Tres de las cuatro rutas de `inventory_grouped` —la normal, «próximos a
-- vencer» y el área de vencidos— buscan sobre `inventory_grouped_mv`, que se
-- refresca por cron. Meterle el código adentro obligaría a reconstruirla.
--
-- La salida es `productos_por_codigo`: resuelve el código a ids UNA vez sobre
-- las ~4,400 filas de `products`, y las cuatro rutas sólo comparan contra
-- `erp_product_id`, que la vista ya tiene.
--
-- Va en una VARIABLE del bloque y no en el WHERE: así el planificador la ve
-- como constante y no la evalúa por fila (la trampa del 2026-07-08).
-- Y cuando no hay búsqueda, `v_pats IS NULL` ya hace verdadero el OR entero,
-- así que el término nuevo no cuesta nada en el caso común.
--
-- Medido después de aplicar (6 corridas cada uno, contra producción):
--   sin búsqueda   15 ms   (idéntico a antes: el OR ni se evalúa)
--   por nombre    131 ms
--   por código    129 ms   → 6 filas, el producto en sus 6 salas
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.inventory_grouped(p_erp_id integer DEFAULT NULL::integer, p_vencidos boolean DEFAULT false, p_proximos boolean DEFAULT false, p_search text DEFAULT NULL::text, p_lab_id integer DEFAULT NULL::integer, p_categoria text DEFAULT NULL::text, p_sort text DEFAULT 'descripcion'::text, p_sort_dir text DEFAULT 'asc'::text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0, p_area_vencidos boolean DEFAULT false)
 RETURNS TABLE(total bigint, erp_sucursal_id integer, erp_product_id integer, descripcion text, presentaciones text[], num_lotes bigint, lote_sample text, total_unidades numeric, earliest_venc date, es_antibiotico boolean, laboratorio text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_total bigint;
    v_today date := CURRENT_DATE;
    v_pats text[] := (
        SELECT array_agg('%' || tok || '%')
        FROM unnest(string_to_array(public.norm_search(p_search), ' ')) AS tok
        WHERE tok <> ''
    );
    -- Los productos cuyo CÓDIGO DE BARRAS coincide, resueltos una sola vez.
    --
    -- Tres de las cuatro rutas de abajo buscan sobre `inventory_grouped_mv`,
    -- que es una vista materializada refrescada por cron: meterle el código
    -- obligaría a reconstruirla. Con la lista de ids resuelta acá alcanza con
    -- comparar contra `erp_product_id`, que la vista ya tiene.
    --
    -- Es una variable y no una llamada dentro del WHERE a propósito: así el
    -- planificador la ve como constante y no la evalúa por fila.
    v_cods int[] := public.productos_por_codigo(p_search);
BEGIN

-- ═══════════════════════════════════════════════════════════════
-- PATH D: área de vencidos (ubicación 2, bodega) — MV only
-- ═══════════════════════════════════════════════════════════════
IF p_area_vencidos THEN

    SELECT COUNT(*) INTO v_total
    FROM inventory_grouped_mv m
    WHERE m.vencidos_unidades > 0
      AND (p_erp_id    IS NULL OR m.erp_sucursal_id  = p_erp_id)
      AND (p_lab_id    IS NULL OR m.laboratorio_id   = p_lab_id)
      AND (p_categoria IS NULL OR m.tipo_medicamento = p_categoria)
      AND (v_pats IS NULL OR m.descripcion_norm LIKE ALL (v_pats) OR m.erp_product_id = ANY(v_cods));

    RETURN QUERY
    SELECT v_total,
           m.erp_sucursal_id, m.erp_product_id, m.descripcion,
           m.presentaciones,  m.num_lotes,       m.lote_sample,
           m.total_unidades,  m.earliest_venc,   m.es_antibiotico,
           l.nombre
    FROM inventory_grouped_mv m
    LEFT JOIN laboratorios l ON l.id = m.laboratorio_id
    WHERE m.vencidos_unidades > 0
      AND (p_erp_id    IS NULL OR m.erp_sucursal_id  = p_erp_id)
      AND (p_lab_id    IS NULL OR m.laboratorio_id   = p_lab_id)
      AND (p_categoria IS NULL OR m.tipo_medicamento = p_categoria)
      AND (v_pats IS NULL OR m.descripcion_norm LIKE ALL (v_pats) OR m.erp_product_id = ANY(v_cods))
    ORDER BY
        CASE WHEN p_sort='sucursal' AND p_sort_dir='asc'  THEN
            CASE m.erp_sucursal_id WHEN 6 THEN 1 WHEN 5 THEN 2 WHEN 1 THEN 3 WHEN 2 THEN 4 WHEN 3 THEN 5 WHEN 4 THEN 6 WHEN 7 THEN 7 ELSE 99 END
        END ASC NULLS LAST,
        CASE WHEN p_sort='sucursal' AND p_sort_dir='desc' THEN
            CASE m.erp_sucursal_id WHEN 6 THEN 1 WHEN 5 THEN 2 WHEN 1 THEN 3 WHEN 2 THEN 4 WHEN 3 THEN 5 WHEN 4 THEN 6 WHEN 7 THEN 7 ELSE 99 END
        END DESC NULLS LAST,
        CASE WHEN p_sort='descripcion' AND p_sort_dir='asc'  THEN m.descripcion     END ASC  NULLS LAST,
        CASE WHEN p_sort='descripcion' AND p_sort_dir='desc' THEN m.descripcion     END DESC NULLS LAST,
        CASE WHEN p_sort='laboratorio' AND p_sort_dir='asc'  THEN l.nombre          END ASC  NULLS LAST,
        CASE WHEN p_sort='laboratorio' AND p_sort_dir='desc' THEN l.nombre          END DESC NULLS LAST,
        CASE WHEN p_sort='unidades'    AND p_sort_dir='asc'  THEN m.vencidos_unidades END ASC  NULLS LAST,
        CASE WHEN p_sort='unidades'    AND p_sort_dir='desc' THEN m.vencidos_unidades END DESC NULLS LAST,
        CASE WHEN p_sort='vence'       AND p_sort_dir='asc'  THEN m.earliest_venc   END ASC  NULLS LAST,
        CASE WHEN p_sort='vence'       AND p_sort_dir='desc' THEN m.earliest_venc   END DESC NULLS LAST,
        m.descripcion ASC,
        CASE m.erp_sucursal_id WHEN 6 THEN 1 WHEN 5 THEN 2 WHEN 1 THEN 3 WHEN 2 THEN 4 WHEN 3 THEN 5 WHEN 4 THEN 6 WHEN 7 THEN 7 ELSE 99 END ASC
    LIMIT p_limit OFFSET p_offset;

-- ═══════════════════════════════════════════════════════════════
-- PATH A: normal view — MV only (<10ms)
-- ═══════════════════════════════════════════════════════════════
ELSIF NOT p_vencidos AND NOT p_proximos THEN

    SELECT COUNT(*) INTO v_total
    FROM inventory_grouped_mv m
    WHERE (p_erp_id    IS NULL OR m.erp_sucursal_id  = p_erp_id)
      AND (p_lab_id    IS NULL OR m.laboratorio_id   = p_lab_id)
      AND (p_categoria IS NULL OR m.tipo_medicamento = p_categoria)
      AND (v_pats IS NULL OR m.descripcion_norm LIKE ALL (v_pats) OR m.erp_product_id = ANY(v_cods));

    RETURN QUERY
    SELECT v_total,
           m.erp_sucursal_id, m.erp_product_id, m.descripcion,
           m.presentaciones,  m.num_lotes,       m.lote_sample,
           m.total_unidades,  m.earliest_venc,   m.es_antibiotico,
           l.nombre
    FROM inventory_grouped_mv m
    LEFT JOIN laboratorios l ON l.id = m.laboratorio_id
    WHERE (p_erp_id    IS NULL OR m.erp_sucursal_id  = p_erp_id)
      AND (p_lab_id    IS NULL OR m.laboratorio_id   = p_lab_id)
      AND (p_categoria IS NULL OR m.tipo_medicamento = p_categoria)
      AND (v_pats IS NULL OR m.descripcion_norm LIKE ALL (v_pats) OR m.erp_product_id = ANY(v_cods))
    ORDER BY
        CASE WHEN p_sort='sucursal' AND p_sort_dir='asc'  THEN
            CASE m.erp_sucursal_id WHEN 6 THEN 1 WHEN 5 THEN 2 WHEN 1 THEN 3 WHEN 2 THEN 4 WHEN 3 THEN 5 WHEN 4 THEN 6 WHEN 7 THEN 7 ELSE 99 END
        END ASC NULLS LAST,
        CASE WHEN p_sort='sucursal' AND p_sort_dir='desc' THEN
            CASE m.erp_sucursal_id WHEN 6 THEN 1 WHEN 5 THEN 2 WHEN 1 THEN 3 WHEN 2 THEN 4 WHEN 3 THEN 5 WHEN 4 THEN 6 WHEN 7 THEN 7 ELSE 99 END
        END DESC NULLS LAST,
        CASE WHEN p_sort='descripcion' AND p_sort_dir='asc'  THEN m.descripcion     END ASC  NULLS LAST,
        CASE WHEN p_sort='descripcion' AND p_sort_dir='desc' THEN m.descripcion     END DESC NULLS LAST,
        CASE WHEN p_sort='laboratorio' AND p_sort_dir='asc'  THEN l.nombre          END ASC  NULLS LAST,
        CASE WHEN p_sort='laboratorio' AND p_sort_dir='desc' THEN l.nombre          END DESC NULLS LAST,
        CASE WHEN p_sort='unidades'    AND p_sort_dir='asc'  THEN m.total_unidades  END ASC  NULLS LAST,
        CASE WHEN p_sort='unidades'    AND p_sort_dir='desc' THEN m.total_unidades  END DESC NULLS LAST,
        CASE WHEN p_sort='vence'       AND p_sort_dir='asc'  THEN m.earliest_venc   END ASC  NULLS LAST,
        CASE WHEN p_sort='vence'       AND p_sort_dir='desc' THEN m.earliest_venc   END DESC NULLS LAST,
        m.descripcion ASC,
        CASE m.erp_sucursal_id WHEN 6 THEN 1 WHEN 5 THEN 2 WHEN 1 THEN 3 WHEN 2 THEN 4 WHEN 3 THEN 5 WHEN 4 THEN 6 WHEN 7 THEN 7 ELSE 99 END ASC
    LIMIT p_limit OFFSET p_offset;

-- ═══════════════════════════════════════════════════════════════
-- PATH B: proximos — MV only, zero raw inventory scan (<5ms)
-- ═══════════════════════════════════════════════════════════════
ELSIF p_proximos THEN

    SELECT COUNT(*) INTO v_total
    FROM inventory_grouped_mv m
    WHERE m.soonest_active_venc IS NOT NULL
      AND m.soonest_active_venc < v_today + INTERVAL '180 days'
      AND (p_erp_id    IS NULL OR m.erp_sucursal_id  = p_erp_id)
      AND (p_lab_id    IS NULL OR m.laboratorio_id   = p_lab_id)
      AND (p_categoria IS NULL OR m.tipo_medicamento = p_categoria)
      AND (v_pats IS NULL OR m.descripcion_norm LIKE ALL (v_pats) OR m.erp_product_id = ANY(v_cods));

    RETURN QUERY
    SELECT v_total,
           m.erp_sucursal_id, m.erp_product_id, m.descripcion,
           m.presentaciones,  m.num_lotes,       m.lote_sample,
           m.total_unidades,  m.earliest_venc,   m.es_antibiotico,
           l.nombre
    FROM inventory_grouped_mv m
    LEFT JOIN laboratorios l ON l.id = m.laboratorio_id
    WHERE m.soonest_active_venc IS NOT NULL
      AND m.soonest_active_venc < v_today + INTERVAL '180 days'
      AND (p_erp_id    IS NULL OR m.erp_sucursal_id  = p_erp_id)
      AND (p_lab_id    IS NULL OR m.laboratorio_id   = p_lab_id)
      AND (p_categoria IS NULL OR m.tipo_medicamento = p_categoria)
      AND (v_pats IS NULL OR m.descripcion_norm LIKE ALL (v_pats) OR m.erp_product_id = ANY(v_cods))
    ORDER BY
        CASE WHEN p_sort='sucursal' AND p_sort_dir='asc'  THEN
            CASE m.erp_sucursal_id WHEN 6 THEN 1 WHEN 5 THEN 2 WHEN 1 THEN 3 WHEN 2 THEN 4 WHEN 3 THEN 5 WHEN 4 THEN 6 WHEN 7 THEN 7 ELSE 99 END
        END ASC NULLS LAST,
        CASE WHEN p_sort='sucursal' AND p_sort_dir='desc' THEN
            CASE m.erp_sucursal_id WHEN 6 THEN 1 WHEN 5 THEN 2 WHEN 1 THEN 3 WHEN 2 THEN 4 WHEN 3 THEN 5 WHEN 4 THEN 6 WHEN 7 THEN 7 ELSE 99 END
        END DESC NULLS LAST,
        CASE WHEN p_sort='descripcion' AND p_sort_dir='asc'  THEN m.descripcion     END ASC  NULLS LAST,
        CASE WHEN p_sort='descripcion' AND p_sort_dir='desc' THEN m.descripcion     END DESC NULLS LAST,
        CASE WHEN p_sort='laboratorio' AND p_sort_dir='asc'  THEN l.nombre          END ASC  NULLS LAST,
        CASE WHEN p_sort='laboratorio' AND p_sort_dir='desc' THEN l.nombre          END DESC NULLS LAST,
        CASE WHEN p_sort='unidades'    AND p_sort_dir='asc'  THEN m.total_unidades  END ASC  NULLS LAST,
        CASE WHEN p_sort='unidades'    AND p_sort_dir='desc' THEN m.total_unidades  END DESC NULLS LAST,
        CASE WHEN p_sort='vence'       AND p_sort_dir='asc'  THEN m.soonest_active_venc END ASC  NULLS LAST,
        CASE WHEN p_sort='vence'       AND p_sort_dir='desc' THEN m.soonest_active_venc END DESC NULLS LAST,
        m.soonest_active_venc ASC NULLS LAST,
        m.descripcion ASC,
        CASE m.erp_sucursal_id WHEN 6 THEN 1 WHEN 5 THEN 2 WHEN 1 THEN 3 WHEN 2 THEN 4 WHEN 3 THEN 5 WHEN 4 THEN 6 WHEN 7 THEN 7 ELSE 99 END ASC
    LIMIT p_limit OFFSET p_offset;

-- ═══════════════════════════════════════════════════════════════
-- PATH C: vencidos por fecha (raw scan, semantics differ)
-- ═══════════════════════════════════════════════════════════════
ELSE

    SELECT COUNT(*) INTO v_total
    FROM (
        SELECT 1 FROM inventory i
        LEFT JOIN products p ON p.id = i.erp_product_id
        WHERE i.is_vencidos = false
          AND i.fecha_vencimiento IS NOT NULL
          AND i.fecha_vencimiento < v_today
          AND (p_erp_id    IS NULL OR i.erp_sucursal_id  = p_erp_id::smallint)
          AND (p_lab_id    IS NULL OR p.laboratorio_id   = p_lab_id)
          AND (p_categoria IS NULL OR p.tipo_medicamento = p_categoria)
          AND (v_pats IS NULL OR public.norm_search(i.descripcion) LIKE ALL (v_pats) OR i.erp_product_id = ANY(v_cods))
        GROUP BY i.erp_sucursal_id, i.erp_product_id
    ) sub;

    RETURN QUERY
    WITH base AS (
        SELECT
            i.erp_sucursal_id::int AS b_erp_sucursal_id,
            i.erp_product_id::int AS b_erp_product_id,
            MAX(i.descripcion)::text AS b_descripcion,
            array_remove(array_agg(DISTINCT i.presentacion) FILTER (
                WHERE i.cantidad * COALESCE(NULLIF(split_part(LOWER(COALESCE(i.detalle,'')), 'x', 2), '')::int, 1) > 0
            ), NULL) AS b_presentaciones,
            COUNT(DISTINCT NULLIF(i.lote, '')) AS b_num_lotes,
            CASE WHEN COUNT(DISTINCT NULLIF(i.lote, '')) = 1
                 THEN MIN(NULLIF(i.lote, '')) END AS b_lote_sample,
            COALESCE(SUM(
                i.cantidad::numeric *
                COALESCE(NULLIF(split_part(LOWER(COALESCE(i.detalle,'')), 'x', 2), '')::numeric, 1)
            ), 0) AS b_total_unidades,
            MIN(i.fecha_vencimiento)
                FILTER (WHERE i.fecha_vencimiento IS NOT NULL) AS b_earliest_venc,
            COALESCE(BOOL_OR(p.es_antibiotico), false) AS b_es_antibiotico,
            MAX(l.nombre) AS b_laboratorio
        FROM inventory i
        LEFT JOIN products p ON p.id = i.erp_product_id
        LEFT JOIN laboratorios l ON l.id = p.laboratorio_id
        WHERE i.is_vencidos = false
          AND i.fecha_vencimiento IS NOT NULL
          AND i.fecha_vencimiento < v_today
          AND (p_erp_id    IS NULL OR i.erp_sucursal_id  = p_erp_id::smallint)
          AND (p_lab_id    IS NULL OR p.laboratorio_id   = p_lab_id)
          AND (p_categoria IS NULL OR p.tipo_medicamento = p_categoria)
          AND (v_pats IS NULL OR public.norm_search(i.descripcion) LIKE ALL (v_pats) OR i.erp_product_id = ANY(v_cods))
        GROUP BY i.erp_sucursal_id, i.erp_product_id
    )
    SELECT v_total, b.b_erp_sucursal_id, b.b_erp_product_id, b.b_descripcion,
           b.b_presentaciones, b.b_num_lotes, b.b_lote_sample,
           b.b_total_unidades, b.b_earliest_venc, b.b_es_antibiotico,
           b.b_laboratorio
    FROM base b
    ORDER BY
        CASE WHEN p_sort='sucursal' AND p_sort_dir='asc'  THEN
            CASE b.b_erp_sucursal_id WHEN 6 THEN 1 WHEN 5 THEN 2 WHEN 1 THEN 3 WHEN 2 THEN 4 WHEN 3 THEN 5 WHEN 4 THEN 6 WHEN 7 THEN 7 ELSE 99 END
        END ASC NULLS LAST,
        CASE WHEN p_sort='sucursal' AND p_sort_dir='desc' THEN
            CASE b.b_erp_sucursal_id WHEN 6 THEN 1 WHEN 5 THEN 2 WHEN 1 THEN 3 WHEN 2 THEN 4 WHEN 3 THEN 5 WHEN 4 THEN 6 WHEN 7 THEN 7 ELSE 99 END
        END DESC NULLS LAST,
        CASE WHEN p_sort='descripcion' AND p_sort_dir='asc'  THEN b.b_descripcion     END ASC  NULLS LAST,
        CASE WHEN p_sort='descripcion' AND p_sort_dir='desc' THEN b.b_descripcion     END DESC NULLS LAST,
        CASE WHEN p_sort='laboratorio' AND p_sort_dir='asc'  THEN b.b_laboratorio     END ASC  NULLS LAST,
        CASE WHEN p_sort='laboratorio' AND p_sort_dir='desc' THEN b.b_laboratorio     END DESC NULLS LAST,
        CASE WHEN p_sort='unidades'    AND p_sort_dir='asc'  THEN b.b_total_unidades  END ASC  NULLS LAST,
        CASE WHEN p_sort='unidades'    AND p_sort_dir='desc' THEN b.b_total_unidades  END DESC NULLS LAST,
        CASE WHEN p_sort='vence'       AND p_sort_dir='asc'  THEN b.b_earliest_venc   END ASC  NULLS LAST,
        CASE WHEN p_sort='vence'       AND p_sort_dir='desc' THEN b.b_earliest_venc   END DESC NULLS LAST,
        b.b_descripcion ASC,
        CASE b.b_erp_sucursal_id WHEN 6 THEN 1 WHEN 5 THEN 2 WHEN 1 THEN 3 WHEN 2 THEN 4 WHEN 3 THEN 5 WHEN 4 THEN 6 WHEN 7 THEN 7 ELSE 99 END ASC
    LIMIT p_limit OFFSET p_offset;

END IF;
END;
$function$
;
