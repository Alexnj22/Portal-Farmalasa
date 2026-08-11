SET lock_timeout = '5s';

-- Cuántas veces hubo que retomar. No es una anomalía: 900 productos a ~370 ms
-- son 333 s contra un techo de 400, así que el despacho se hace en varias
-- corridas por diseño. Verlo sirve para saber si el sistema anduvo lento.
CREATE OR REPLACE FUNCTION public.incrementar_reanudacion_traslado(p_run_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
    UPDATE pedido_traslado_erp
    SET reanudaciones = reanudaciones + 1, updated_at = now()
    WHERE id = p_run_id;
$$;

REVOKE EXECUTE ON FUNCTION public.incrementar_reanudacion_traslado(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.incrementar_reanudacion_traslado(uuid) TO service_role;

-- En qué va el despacho de una sucursal, por estado y por hoja.
--
-- Lo usa la función al cerrar cada corrida para saber si queda algo (y por lo
-- tanto si hay que retomar), y lo usa la pantalla para mostrar el avance. Sale
-- de una sola pasada sobre las líneas.
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
                    'con_error', count(*) FILTER (WHERE estado = 'error')
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
