SET lock_timeout = '5s';

-- Las hojas guardadas tienen que ser LAS DEL PDF, y eso se comprueba.
--
-- La hoja impresa es la unidad real de trabajo: es lo que Bodega tiene en la
-- mano cuando arma la caja, y de ahí sale qué producto va en qué caja. El
-- traslado lleva ese número adentro, así que si el mapa producto→hoja no
-- corresponde al papel, el traslado queda apoyado en un dato falso y nadie se
-- entera.
--
-- La prueba es directa, no un proxy de versión: **el PDF nunca imprime las
-- cajas adicionales dentro de la tabla numerada** —van en su propio bloque, al
-- final—. Entonces, si una hoja guardada contiene un producto de caja especial
-- o de Electrolit, esas hojas se calcularon con el defecto que se corrigió el
-- 2026-08-11 y no son las del papel. Tampoco puede haber un producto en dos
-- hojas.
--
-- Lo que SÍ se acepta es que falte alguno: un renglón cuya cantidad asignada es
-- menor que una unidad de despacho se redondea a cero y no sale impreso. Esos
-- se marcan `omitida` y no se trasladan.
CREATE OR REPLACE FUNCTION public.verificar_hojas_pedido(
    p_pedido_id   uuid,
    p_sucursal_id integer
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
WITH hojas AS (
    -- `pagina_items` manda; `paginas` es el respaldo de antes de finalizar.
    SELECT (v.key)::integer AS hoja,
           (jsonb_array_elements_text(v.value))::integer AS item_id
    FROM pedido_sucursal_status pss
    CROSS JOIN LATERAL jsonb_each(coalesce(pss.pagina_items, '{}'::jsonb)) AS v(key, value)
    WHERE pss.pedido_id = p_pedido_id AND pss.erp_sucursal_id = p_sucursal_id
    UNION ALL
    SELECT (pg.ord)::integer,
           (jsonb_array_elements_text(pg.val -> 'ids'))::integer
    FROM pedido_sucursal_status pss
    CROSS JOIN LATERAL jsonb_array_elements(coalesce(pss.paginas, '[]'::jsonb))
         WITH ORDINALITY AS pg(val, ord)
    WHERE pss.pedido_id = p_pedido_id AND pss.erp_sucursal_id = p_sucursal_id
      AND coalesce((SELECT pagina_items FROM pedido_sucursal_status
                    WHERE pedido_id = p_pedido_id AND erp_sucursal_id = p_sucursal_id),
                   '{}'::jsonb) = '{}'::jsonb
),
despachables AS (
    SELECT pi.id, pi.erp_product_id
    FROM pedido_items pi
    WHERE pi.pedido_id = p_pedido_id AND pi.erp_sucursal_id = p_sucursal_id
      AND NOT pi.sin_stock
      AND pi.status <> 'no_enviado'
      AND COALESCE(pi.cantidad_enviada, pi.cantidad_asignada) > 0
),
m AS (
    SELECT
      (SELECT count(DISTINCT hoja) FROM hojas)                                  AS n_hojas,
      (SELECT count(DISTINCT item_id) FROM hojas)                               AS items_en_hojas,
      (SELECT count(*) - count(DISTINCT item_id) FROM hojas)                    AS duplicados,
      (SELECT count(*) FROM hojas h
         JOIN pedido_items pi ON pi.id = h.item_id
         JOIN dispatch_rules dr ON dr.erp_product_id = pi.erp_product_id
        WHERE dr.caja_especial OR upper(coalesce(dr.dispatch_label, '')) = 'CAJA')
                                                                                AS adicionales_dentro,
      (SELECT count(*) FROM despachables d
        WHERE NOT EXISTS (SELECT 1 FROM hojas h WHERE h.item_id = d.id))        AS sin_hoja,
      (SELECT count(*) FROM despachables)                                       AS despachables
)
SELECT jsonb_build_object(
    'confiables', (m.n_hojas > 0 AND m.adicionales_dentro = 0 AND m.duplicados = 0),
    'hojas',              m.n_hojas,
    'despachables',       m.despachables,
    'items_en_hojas',     m.items_en_hojas,
    'adicionales_dentro', m.adicionales_dentro,
    'duplicados',         m.duplicados,
    'sin_hoja',           m.sin_hoja,
    'motivo',
      CASE
        WHEN m.n_hojas = 0 THEN 'El pedido no tiene hojas guardadas.'
        WHEN m.adicionales_dentro > 0 THEN
          m.adicionales_dentro || ' producto(s) de cajas adicionales están dentro de las hojas numeradas. '
          || 'El PDF los imprime en un bloque aparte, así que estas hojas no son las del papel '
          || '(se calcularon antes de la corrección del 2026-08-11). Hay que recalcularlas.'
        WHEN m.duplicados > 0 THEN
          m.duplicados || ' producto(s) aparecen en más de una hoja.'
        ELSE NULL
      END
) FROM m;
$$;

REVOKE EXECUTE ON FUNCTION public.verificar_hojas_pedido(uuid, integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.verificar_hojas_pedido(uuid, integer) TO authenticated, service_role;

-- El planificador ya no confía: comprueba primero y se niega si las hojas no
-- son las del papel. Sin esto, el traslado llevaría un número de hoja que no
-- corresponde a lo que Bodega tuvo en la mano.
CREATE OR REPLACE FUNCTION public.planificar_traslado_pedido(
    p_pedido_id   uuid,
    p_sucursal_id integer,
    p_run_id      uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_numero    integer;
    v_nuevas    integer;
    v_chequeo   jsonb;
BEGIN
    SELECT numero INTO v_numero FROM pedidos WHERE id = p_pedido_id;
    IF v_numero IS NULL THEN
        RAISE EXCEPTION 'Pedido no encontrado.';
    END IF;

    v_chequeo := verificar_hojas_pedido(p_pedido_id, p_sucursal_id);
    IF NOT (v_chequeo->>'confiables')::boolean THEN
        RAISE EXCEPTION 'HOJAS_NO_CONFIABLES: %', v_chequeo->>'motivo';
    END IF;

    WITH desde_items AS (
        SELECT (jsonb_array_elements_text(v.value))::integer AS pedido_item_id,
               (v.key)::integer AS hoja
        FROM pedido_sucursal_status pss
        CROSS JOIN LATERAL jsonb_each(coalesce(pss.pagina_items, '{}'::jsonb)) AS v(key, value)
        WHERE pss.pedido_id = p_pedido_id AND pss.erp_sucursal_id = p_sucursal_id
    ),
    desde_paginas AS (
        SELECT (jsonb_array_elements_text(pg.val -> 'ids'))::integer AS pedido_item_id,
               (pg.ord)::integer AS hoja
        FROM pedido_sucursal_status pss
        CROSS JOIN LATERAL jsonb_array_elements(coalesce(pss.paginas, '[]'::jsonb))
             WITH ORDINALITY AS pg(val, ord)
        WHERE pss.pedido_id = p_pedido_id AND pss.erp_sucursal_id = p_sucursal_id
    ),
    mapa AS (
        SELECT pedido_item_id, hoja FROM desde_items
        UNION
        SELECT pedido_item_id, hoja FROM desde_paginas
        WHERE NOT EXISTS (SELECT 1 FROM desde_items)
    ),
    candidatos AS (
        SELECT pi.id, pi.erp_product_id, m.hoja,
               COALESCE(pi.cantidad_enviada, pi.cantidad_asignada) AS cantidad
        FROM pedido_items pi
        LEFT JOIN mapa m ON m.pedido_item_id = pi.id
        WHERE pi.pedido_id       = p_pedido_id
          AND pi.erp_sucursal_id = p_sucursal_id
          AND NOT pi.sin_stock
          AND pi.status <> 'no_enviado'
          AND COALESCE(pi.cantidad_enviada, pi.cantidad_asignada) > 0
    )
    INSERT INTO pedido_traslado_linea
        (run_id, pedido_id, erp_sucursal_id, pedido_item_id, erp_product_id, hoja, cantidad, clave, estado, error_msg)
    SELECT p_run_id, p_pedido_id, p_sucursal_id, c.id, c.erp_product_id, c.hoja, c.cantidad,
           'P' || v_numero || '-S' || p_sucursal_id
             || '-H' || COALESCE(c.hoja::text, '0') || '-I' || c.id,
           CASE WHEN c.hoja IS NULL THEN 'omitida' ELSE 'planificada' END,
           CASE WHEN c.hoja IS NULL
                THEN 'No salió en ninguna hoja del despacho, así que no se levantó de bodega.'
                ELSE NULL END
    FROM candidatos c
    ON CONFLICT (pedido_id, erp_sucursal_id, pedido_item_id) DO NOTHING;

    GET DIAGNOSTICS v_nuevas = ROW_COUNT;

    RETURN (
        SELECT jsonb_build_object(
            'nuevas',        v_nuevas,
            'total',         count(*),
            'por_despachar', count(*) FILTER (WHERE estado IN ('planificada', 'enviando')),
            'enviadas',      count(*) FILTER (WHERE estado = 'enviada'),
            'omitidas',      count(*) FILTER (WHERE estado = 'omitida'),
            'con_error',     count(*) FILTER (WHERE estado = 'error'),
            'hojas',         count(DISTINCT hoja),
            'chequeo_hojas', v_chequeo
        )
        FROM pedido_traslado_linea
        WHERE pedido_id = p_pedido_id AND erp_sucursal_id = p_sucursal_id
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.planificar_traslado_pedido(uuid, integer, uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.planificar_traslado_pedido(uuid, integer, uuid) TO service_role;
