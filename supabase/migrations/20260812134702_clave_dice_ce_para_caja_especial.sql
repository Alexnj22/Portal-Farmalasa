SET lock_timeout = '5s';

-- La caja especial se llama CE en la clave, y manda sobre la hoja.
--
-- Decía `HA` —«hoja A»— que no es ninguna hoja y no dice qué es. Ahora dice
-- `CE`: `P101-S3-CE-I71417`. La `H` desaparece porque una caja especial no es
-- una hoja; el segmento pasa a decir POR DÓNDE viaja el renglón, y tiene dos
-- respuestas: `H<n>` una hoja numerada, `CE` una caja especial (las que llevan
-- su etiqueta E1, E2… independiente).
--
-- Y el orden se invierte: antes la hoja ganaba (`COALESCE(hoja, 'A')`), así que
-- un producto de caja especial que además figuraba en la foto de las hojas
-- impresas salía con hoja. Eso produjo `P100-S3-H3-I70667` para un ELECTROLIT
-- UVA. Era un dato mal puesto —la regla del producto no tenía el interruptor de
-- caja especial y ya se corrigió—, pero la fórmula no debe depender de que el
-- dato esté bien: si el producto ES de caja especial, la clave lo dice, punto.
-- Es además lo que hace el PDF, que evalúa la regla de HOY (`isAdicional` en
-- `pedidoPrint.js`) y no la foto de lo que se imprimió alguna vez.
CREATE OR REPLACE FUNCTION public.planificar_traslado_pedido(p_pedido_id uuid, p_sucursal_id integer, p_run_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_numero    integer;
    v_suc       text;
    v_nuevas    integer;
    v_chequeo   jsonb;
BEGIN
    SELECT numero INTO v_numero FROM pedidos WHERE id = p_pedido_id;
    IF v_numero IS NULL THEN
        RAISE EXCEPTION 'Pedido no encontrado.';
    END IF;

    -- El código de la sala, del registro. Si falta, se para acá: es preferible
    -- no despachar a escribir en el kardex una clave que nadie puede leer.
    SELECT codigo INTO v_suc FROM erp_sucursal_map WHERE erp_sucursal_id = p_sucursal_id;
    IF v_suc IS NULL THEN
        RAISE EXCEPTION 'SALA_SIN_CODIGO: la sala % no tiene código en el registro de salas', p_sucursal_id;
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
           'P' || v_numero || '-' || v_suc || '-'
             || CASE WHEN c.adicional        THEN 'CE'
                     WHEN c.hoja IS NOT NULL THEN 'H' || c.hoja::text
                     ELSE 'H0' END
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
$function$;

-- Sólo cambia un comentario que quedó viejo: la clave del despacho ya no dice
-- `HA` sino `CE`. El cuerpo es idéntico al de 20260812132050.
COMMENT ON FUNCTION public.solicitar_devolucion_pedido(integer, text, integer, text, jsonb) IS
  'Reusa la clave del despacho (pedido_traslado_linea.clave) con DEV- adelante, que ya trae resuelto por dónde viajó el renglón: H<n> una hoja numerada, CE una caja especial.';
