SET lock_timeout = '5s';

-- ── 1. REVOKE FROM PUBLIC no le quita el permiso a `authenticated` ──────────
-- Supabase concede EXECUTE a `authenticated` por privilegio por omisión sobre
-- todo lo nuevo en `public`, y un `REVOKE ... FROM PUBLIC` no lo toca. Estas
-- dos funciones son internas del despacho —las llama la edge function con la
-- llave de servicio— y son SECURITY DEFINER sin chequeo de permiso adentro:
-- quedaban invocables por cualquier sesión del portal.
--
-- `planificar_traslado_pedido` es la que importa: escribe las líneas del
-- traslado de cualquier pedido. No mueve inventario por sí sola, pero es la
-- antesala del que sí lo mueve. Lo destapó la reauditoría del 2026-08-11.
REVOKE EXECUTE ON FUNCTION public.planificar_traslado_pedido(uuid, integer, uuid)
    FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.planificar_traslado_pedido(uuid, integer, uuid)
    TO service_role;

REVOKE EXECUTE ON FUNCTION public.incrementar_reanudacion_traslado(uuid)
    FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.incrementar_reanudacion_traslado(uuid)
    TO service_role;

-- ── 2. Lo que no salió impreso también hay que CERRARLO en el pedido ────────
-- El planificador marcaba la línea `omitida` y no tocaba el renglón del pedido,
-- que venía de `confirmar_envio_pedido` con `cantidad_enviada = cantidad_asignada`.
-- O sea: el pedido decía «se enviaron 2» sobre algo que no se movió, y el
-- renglón se quedaba en 'pendiente' para siempre — el mismo atraso que hubo que
-- limpiar a mano.
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

    -- El renglón del pedido tiene que decir lo mismo que su línea: si no se
    -- levantó de bodega, no se envió. Cerrarlo acá evita que quede pendiente
    -- para siempre y que el pedido afirme un envío que no ocurrió.
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
