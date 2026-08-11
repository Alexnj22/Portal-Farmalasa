SET lock_timeout = '5s';

-- Lo que no salió impreso en ninguna hoja NO se traslada.
--
-- Hay renglones con cantidad asignada que no aparecen en el PDF: cuando lo
-- asignado es menos de una unidad de despacho, la conversión los redondea a
-- cero y el impresor los descarta. Medido: DOLACO 10MG con 2 unidades y factor
-- de despacho 10 → round(2/10) = 0. Salen del papel, pero se quedan en el
-- pedido como pendientes.
--
-- Para el traslado eso es peligroso: si no está en ninguna hoja, nadie lo
-- levantó de la bodega, y crearle un traslado movería inventario que no se
-- movió. Se marcan `omitida` — quedan registrados y a la vista, no se borran ni
-- se despachan.
--
-- El respaldo importa: si el pedido no tiene NINGUNA hoja (uno viejo, o uno
-- cuya captura falló) no se puede concluir nada de la ausencia, así que ahí se
-- planifica todo.
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
    v_numero  integer;
    v_nuevas  integer;
    v_hay_hojas boolean;
BEGIN
    SELECT numero INTO v_numero FROM pedidos WHERE id = p_pedido_id;
    IF v_numero IS NULL THEN
        RAISE EXCEPTION 'Pedido no encontrado.';
    END IF;

    SELECT EXISTS (
        SELECT 1 FROM pedido_sucursal_status
        WHERE pedido_id = p_pedido_id AND erp_sucursal_id = p_sucursal_id
          AND (coalesce(pagina_items, '{}'::jsonb) <> '{}'::jsonb
               OR jsonb_array_length(coalesce(paginas, '[]'::jsonb)) > 0)
    ) INTO v_hay_hojas;

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
           CASE WHEN v_hay_hojas AND c.hoja IS NULL THEN 'omitida' ELSE 'planificada' END,
           CASE WHEN v_hay_hojas AND c.hoja IS NULL
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
            'hojas',         count(DISTINCT hoja)
        )
        FROM pedido_traslado_linea
        WHERE pedido_id = p_pedido_id AND erp_sucursal_id = p_sucursal_id
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.planificar_traslado_pedido(uuid, integer, uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.planificar_traslado_pedido(uuid, integer, uuid) TO service_role;
