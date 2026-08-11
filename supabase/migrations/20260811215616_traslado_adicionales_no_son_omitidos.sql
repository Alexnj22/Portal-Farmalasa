SET lock_timeout = '5s';

-- «Sin hoja» son DOS cosas distintas, y confundirlas deja producto sin trasladar.
--
-- El PDF imprime dos bloques: las hojas numeradas y, aparte, CAJAS ADICIONALES
-- —las cajas especiales y las de Electrolit—. Un producto de ese segundo bloque
-- **no pertenece a ninguna hoja y sin embargo SÍ se despacha**: va en la caja,
-- rotulado E1, E2…
--
-- El planificador trataba todo «sin hoja» como «no se levantó de bodega» y lo
-- cerraba como no enviado. Medido en el pedido #101 de Salud 3: ELECTROLIT UVA,
-- 12 packs, habría quedado sin trasladar y el pedido habría dicho que no se
-- envió. Lo destapó generar un pedido grande de verdad; el chico no lo mostró
-- porque sus Electrolit no tenían existencia.
--
-- Ahora se distinguen:
--   · adicional            → se planifica igual, con aviso de que viaja aparte
--   · no salió impreso     → omitida (redondea a cero, nadie lo levanta)

-- La definición vive en UN solo lugar y es la MISMA que `isAdicional()` del
-- impresor: `caja_especial` del renglón, o etiqueta de despacho propia con el
-- tipo en CAJA. Si se toca allá, se toca acá.
CREATE OR REPLACE FUNCTION public.es_despacho_adicional(
    p_caja_especial boolean,
    p_dispatch_tipo text,
    p_tiene_label   boolean
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public, extensions
AS $$
    SELECT COALESCE(p_caja_especial, false)
        OR (COALESCE(p_tiene_label, false) AND upper(COALESCE(p_dispatch_tipo, '')) = 'CAJA');
$$;

REVOKE EXECUTE ON FUNCTION public.es_despacho_adicional(boolean, text, boolean) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.es_despacho_adicional(boolean, text, boolean) TO authenticated, service_role;

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
               COALESCE(pi.cantidad_enviada, pi.cantidad_asignada) AS cantidad,
               es_despacho_adicional(pi.caja_especial, pi.dispatch_tipo,
                                     dr.dispatch_label IS NOT NULL) AS adicional
        FROM pedido_items pi
        LEFT JOIN mapa m ON m.pedido_item_id = pi.id
        LEFT JOIN dispatch_rules dr ON dr.erp_product_id = pi.erp_product_id
        WHERE pi.pedido_id       = p_pedido_id
          AND pi.erp_sucursal_id = p_sucursal_id
          AND NOT pi.sin_stock
          AND pi.status <> 'no_enviado'
          AND COALESCE(pi.cantidad_enviada, pi.cantidad_asignada) > 0
    )
    INSERT INTO pedido_traslado_linea
        (run_id, pedido_id, erp_sucursal_id, pedido_item_id, erp_product_id, hoja, cantidad,
         clave, estado, error_msg, aviso)
    SELECT p_run_id, p_pedido_id, p_sucursal_id, c.id, c.erp_product_id, c.hoja, c.cantidad,
           'P' || v_numero || '-S' || p_sucursal_id
             || '-H' || COALESCE(c.hoja::text, CASE WHEN c.adicional THEN 'A' ELSE '0' END)
             || '-I' || c.id,
           -- El adicional NO tiene hoja y SÍ se despacha: viaja en el bloque de
           -- cajas adicionales del PDF.
           CASE WHEN c.hoja IS NULL AND NOT c.adicional THEN 'omitida' ELSE 'planificada' END,
           CASE WHEN c.hoja IS NULL AND NOT c.adicional
                THEN 'No salió en ninguna hoja del despacho, así que no se levantó de bodega.'
                ELSE NULL END,
           CASE WHEN c.adicional
                THEN 'Viaja en las cajas adicionales (E1, E2…), no en una hoja numerada.'
                ELSE NULL END
    FROM candidatos c
    ON CONFLICT (pedido_id, erp_sucursal_id, pedido_item_id) DO NOTHING;

    GET DIAGNOSTICS v_nuevas = ROW_COUNT;

    -- Sólo se cierra lo que de verdad no se levantó — nunca un adicional.
    UPDATE pedido_items pi
    SET status           = 'no_enviado',
        cantidad_enviada = 0,
        cantidad_recibida = 0,
        motivo_no_envio  = 'No salió en ninguna hoja del despacho: lo asignado es menos de una '
                        || 'unidad de despacho, así que no se imprimió y nadie lo levantó.'
    FROM pedido_traslado_linea l
    WHERE l.pedido_item_id  = pi.id
      AND l.pedido_id       = p_pedido_id
      AND l.erp_sucursal_id = p_sucursal_id
      AND l.estado          = 'omitida'
      AND pi.status         = 'pendiente';

    RETURN (
        SELECT jsonb_build_object(
            'nuevas',        v_nuevas,
            'total',         count(*),
            'por_despachar', count(*) FILTER (WHERE estado IN ('planificada', 'enviando')),
            'enviadas',      count(*) FILTER (WHERE estado = 'enviada'),
            'omitidas',      count(*) FILTER (WHERE estado = 'omitida'),
            'adicionales',   count(*) FILTER (WHERE aviso IS NOT NULL AND hoja IS NULL),
            'con_error',     count(*) FILTER (WHERE estado = 'error'),
            'hojas',         count(DISTINCT hoja),
            'chequeo_hojas', v_chequeo
        )
        FROM pedido_traslado_linea
        WHERE pedido_id = p_pedido_id AND erp_sucursal_id = p_sucursal_id
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.planificar_traslado_pedido(uuid, integer, uuid)
    FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.planificar_traslado_pedido(uuid, integer, uuid)
    TO service_role;
