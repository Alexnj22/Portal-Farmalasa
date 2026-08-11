SET lock_timeout = '5s';

-- Una fila por PRODUCTO trasladado, no por pedido.
--
-- El sistema de origen trata un traslado como un hecho binario: o está
-- pendiente o está finalizado (`anulada=0 AND finalizada=0` es su definición de
-- «pendiente»). No hay estado intermedio, así que recibir la mitad de un
-- traslado no es algo que se pueda pedir.
--
-- La salida es no necesitarlo: si cada producto viaja en su propio traslado,
-- recibir uno es recibirlo ENTERO. Confirmar una hoja pasa a ser recibir sus N
-- traslados de un saque, y confirmar un producto suelto —porque la sucursal lo
-- va a vender— es recibir el suyo. La pregunta de si el sistema soporta
-- recepción parcial deja de importar.
--
-- El precio es volumen: ~900 traslados por sucursal contra los 27,284 que tiene
-- el sistema en toda su historia. Por eso `clave` va dentro del concepto: sin
-- ella esos renglones serían ruido irrastreable en la pantalla de traslados.
CREATE TABLE IF NOT EXISTS public.pedido_traslado_linea (
    id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id   uuid REFERENCES public.pedido_traslado_erp(id) ON DELETE SET NULL,

    pedido_id       uuid    NOT NULL REFERENCES public.pedidos(id) ON DELETE CASCADE,
    erp_sucursal_id integer NOT NULL REFERENCES public.erp_sucursal_map(erp_sucursal_id),
    pedido_item_id  integer NOT NULL REFERENCES public.pedido_items(id) ON DELETE CASCADE,
    erp_product_id  integer NOT NULL,

    -- De qué hoja del despacho salió. Es lo que permite «confirmo la hoja 3» y
    -- que se reciban sus productos de un solo golpe.
    hoja     integer,
    cantidad integer NOT NULL,

    -- La llave de idempotencia, y va DENTRO del concepto del traslado. Si la
    -- corrida se corta entre que el sistema creó el traslado y que alcanzamos a
    -- anotar su id, al retomar se la busca en los conceptos de los pendientes en
    -- vez de crear un duplicado. Un traslado duplicado mueve inventario dos
    -- veces y no se deshace solo.
    clave text NOT NULL,

    estado text NOT NULL DEFAULT 'planificada'
        CHECK (estado IN ('planificada', 'enviando', 'enviada', 'recibida', 'error', 'omitida')),

    id_traslado text,
    numero_vale text,
    detalle     jsonb,
    error_msg   text,

    enviado_at   timestamptz,
    recibido_at  timestamptz,
    recibido_por uuid,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now()
);

-- El freno contra el doble despacho, en el esquema: un renglón del pedido no
-- puede tener dos líneas de traslado, pase lo que pase con las corridas.
CREATE UNIQUE INDEX IF NOT EXISTS pedido_traslado_linea_una_por_item
    ON public.pedido_traslado_linea (pedido_id, erp_sucursal_id, pedido_item_id);

CREATE INDEX IF NOT EXISTS pedido_traslado_linea_run_idx  ON public.pedido_traslado_linea (run_id);
CREATE INDEX IF NOT EXISTS pedido_traslado_linea_hoja_idx ON public.pedido_traslado_linea (pedido_id, erp_sucursal_id, hoja);
-- El índice del bucle: «dame la próxima línea que falta despachar».
CREATE INDEX IF NOT EXISTS pedido_traslado_linea_pendientes_idx
    ON public.pedido_traslado_linea (pedido_id, erp_sucursal_id, estado)
    WHERE estado IN ('planificada', 'enviando');
CREATE INDEX IF NOT EXISTS pedido_traslado_linea_item_idx ON public.pedido_traslado_linea (pedido_item_id);

ALTER TABLE public.pedido_traslado_linea ENABLE ROW LEVEL SECURITY;

CREATE POLICY pedido_traslado_linea_select ON public.pedido_traslado_linea
    FOR SELECT TO public
    USING (
        (SELECT auth_has_module_permission('pedidos'::text, 'can_view'::text))
        AND (
            (SELECT auth_module_scope('pedidos'::text)) = 'ALL'::text
            OR erp_sucursal_id = (SELECT auth_employee_erp_sucursal_id())
        )
    );

-- Cuántas veces hubo que retomar la corrida. 900 productos a ~370 ms no entran
-- en los 400 s de techo de una edge function, así que retomar es lo normal, no
-- la excepción — y conviene verlo.
ALTER TABLE public.pedido_traslado_erp
    ADD COLUMN IF NOT EXISTS reanudaciones integer NOT NULL DEFAULT 0;

-- ── El plan: una línea por producto, antes de tocar el sistema ──────────────
-- Se arma entero y de una vez para que el bucle de despacho solo tenga que
-- preguntar «cuál sigue». La hoja sale de `pagina_items`, que es el mapa
-- producto→hoja que se guardó al finalizar.
--
-- NOTA: esta primera versión resuelve la hoja SOLO desde `pagina_items`. La
-- reemplazan `20260811202528` (respaldo desde `paginas`) y `20260811202653`
-- (omitir lo que no salió impreso). Se conserva tal como se aplicó.
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
    v_numero integer;
    v_nuevas integer;
BEGIN
    SELECT numero INTO v_numero FROM pedidos WHERE id = p_pedido_id;
    IF v_numero IS NULL THEN
        RAISE EXCEPTION 'Pedido no encontrado.';
    END IF;

    WITH mapa AS (
        SELECT (jsonb_array_elements_text(v.value))::integer AS pedido_item_id,
               (v.key)::integer AS hoja
        FROM pedido_sucursal_status pss
        CROSS JOIN LATERAL jsonb_each(coalesce(pss.pagina_items, '{}'::jsonb)) AS v(key, value)
        WHERE pss.pedido_id = p_pedido_id AND pss.erp_sucursal_id = p_sucursal_id
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
        (run_id, pedido_id, erp_sucursal_id, pedido_item_id, erp_product_id, hoja, cantidad, clave)
    SELECT p_run_id, p_pedido_id, p_sucursal_id, c.id, c.erp_product_id, c.hoja, c.cantidad,
           'P' || v_numero || '-S' || p_sucursal_id
             || '-H' || COALESCE(c.hoja::text, '0') || '-I' || c.id
    FROM candidatos c
    ON CONFLICT (pedido_id, erp_sucursal_id, pedido_item_id) DO NOTHING;

    GET DIAGNOSTICS v_nuevas = ROW_COUNT;

    RETURN (
        SELECT jsonb_build_object(
            'nuevas',       v_nuevas,
            'total',        count(*),
            'por_despachar', count(*) FILTER (WHERE estado IN ('planificada', 'enviando')),
            'enviadas',     count(*) FILTER (WHERE estado = 'enviada'),
            'con_error',    count(*) FILTER (WHERE estado = 'error'),
            'sin_hoja',     count(*) FILTER (WHERE hoja IS NULL)
        )
        FROM pedido_traslado_linea
        WHERE pedido_id = p_pedido_id AND erp_sucursal_id = p_sucursal_id
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.planificar_traslado_pedido(uuid, integer, uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.planificar_traslado_pedido(uuid, integer, uuid) TO service_role;

COMMENT ON TABLE public.pedido_traslado_linea IS
    'Una fila por producto trasladado al sistema de origen. Un traslado por producto para que recibir uno sea recibirlo entero — el sistema no soporta recepción parcial de un traslado. `clave` va dentro del concepto y es la llave de idempotencia al retomar una corrida cortada.';
