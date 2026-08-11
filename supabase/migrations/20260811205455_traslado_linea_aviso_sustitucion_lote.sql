SET lock_timeout = '5s';

-- Lo que no frena el envío pero hay que ver después.
--
-- El caso que lo trae: el pedido reserva lotes al generarse y los imprime en la
-- hoja, pero entre que se arma y se despacha la bodega se mueve. Medido sobre
-- el pedido #96: 9 de 476 productos pedían un lote que ya no está — y en los
-- cuatro que revisé **el producto sí estaba, en otro lote** (COLMIBE pedía
-- 75406 y hay 75397; MILEVA pedía 49532 y hay 49791).
--
-- Quien levanta en bodega toma lo que hay en el estante, no consulta la
-- reserva del portal, así que ese producto va en la caja igual. Frenar la línea
-- por eso sería frenar mercadería que sí viaja. Se despacha con el lote
-- disponible —el que vence primero, que es lo que corresponde— y queda el
-- aviso para que Bodega lo revise. Decisión del usuario, 2026-08-11.
ALTER TABLE public.pedido_traslado_linea
    ADD COLUMN IF NOT EXISTS aviso text;

COMMENT ON COLUMN public.pedido_traslado_linea.aviso IS
    'Algo que no frenó el despacho pero hay que mirar — típicamente: se despachó de un lote distinto al que el pedido había reservado.';

CREATE INDEX IF NOT EXISTS pedido_traslado_linea_aviso_idx
    ON public.pedido_traslado_linea (pedido_id, erp_sucursal_id)
    WHERE aviso IS NOT NULL;

-- El resumen cuenta los avisos: sin eso, una sustitución de lote se despacha y
-- nadie se entera nunca, que es justo lo contrario de «avisando».
CREATE OR REPLACE FUNCTION public.resumen_traslado_pedido(
    p_pedido_id   uuid,
    p_sucursal_id integer
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
    SELECT jsonb_build_object(
        'total',         count(*),
        'por_despachar', count(*) FILTER (WHERE estado IN ('planificada', 'enviando')),
        'enviadas',      count(*) FILTER (WHERE estado = 'enviada'),
        'recibidas',     count(*) FILTER (WHERE estado = 'recibida'),
        'omitidas',      count(*) FILTER (WHERE estado = 'omitida'),
        'con_error',     count(*) FILTER (WHERE estado = 'error'),
        'con_aviso',     count(*) FILTER (WHERE aviso IS NOT NULL),
        'sin_id',        count(*) FILTER (WHERE estado IN ('enviada','recibida') AND id_traslado IS NULL),
        'hojas', (
            SELECT coalesce(jsonb_agg(h ORDER BY (h->>'hoja')::int), '[]'::jsonb)
            FROM (
                SELECT jsonb_build_object(
                    'hoja',      hoja,
                    'total',     count(*),
                    'enviadas',  count(*) FILTER (WHERE estado = 'enviada'),
                    'recibidas', count(*) FILTER (WHERE estado = 'recibida'),
                    'pendiente', count(*) FILTER (WHERE estado IN ('planificada','enviando')),
                    'con_error', count(*) FILTER (WHERE estado = 'error'),
                    'con_aviso', count(*) FILTER (WHERE aviso IS NOT NULL)
                ) AS h
                FROM pedido_traslado_linea
                WHERE pedido_id = p_pedido_id AND erp_sucursal_id = p_sucursal_id
                  AND hoja IS NOT NULL
                GROUP BY hoja
            ) s
        )
    )
    FROM pedido_traslado_linea
    WHERE pedido_id = p_pedido_id AND erp_sucursal_id = p_sucursal_id;
$$;

REVOKE EXECUTE ON FUNCTION public.resumen_traslado_pedido(uuid, integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.resumen_traslado_pedido(uuid, integer) TO authenticated, service_role;
