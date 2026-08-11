SET lock_timeout = '5s';

-- El traslado del pedido al sistema de origen: una fila por intento.
--
-- Existe como tabla propia y no como columnas de pedido_sucursal_status porque
-- guarda DOS cosas que esa tabla no sabría separar: el resultado del simulacro
-- (verifica las ~450 líneas contra el sistema sin escribir nada) y el del
-- traslado real. Y porque el índice único de más abajo es el candado: un pedido
-- no se puede despachar dos veces aunque dos personas finalicen a la vez.
CREATE TABLE IF NOT EXISTS public.pedido_traslado_erp (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    pedido_id       uuid NOT NULL REFERENCES public.pedidos(id) ON DELETE CASCADE,
    erp_sucursal_id integer NOT NULL REFERENCES public.erp_sucursal_map(erp_sucursal_id),

    -- 'simulacro' verifica y no escribe; 'real' despacha.
    modo   text NOT NULL CHECK (modo  IN ('simulacro', 'real')),
    -- Las dos mitades que el sistema distingue: sale de Bodega y se recibe.
    paso   text NOT NULL CHECK (paso  IN ('enviar', 'recibir')),
    estado text NOT NULL CHECK (estado IN ('en_curso', 'verificado', 'despachado', 'recibido', 'error')),

    id_traslado text,
    numero_vale text,

    productos integer NOT NULL DEFAULT 0,
    lineas    integer NOT NULL DEFAULT 0,
    unidades  numeric NOT NULL DEFAULT 0,
    total     numeric NOT NULL DEFAULT 0,

    -- Lo que NO se pudo resolver, producto por producto y con el motivo. Es la
    -- salida útil del simulacro: un traslado que se cae en la línea 300 no dice
    -- nada, una lista de los 4 productos problemáticos sí.
    hallazgos jsonb NOT NULL DEFAULT '[]'::jsonb,
    -- Las líneas armadas, tal como irían al sistema.
    detalle   jsonb,

    -- Cuánto tardó de punta a punta. Es el número que dice si el modo background
    -- alcanza o si hay que partir el pedido en tandas.
    ms_total  integer,
    error_msg text,

    creado_por uuid,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pedido_traslado_erp_pedido_suc_idx
    ON public.pedido_traslado_erp (pedido_id, erp_sucursal_id);
CREATE INDEX IF NOT EXISTS pedido_traslado_erp_sucursal_idx
    ON public.pedido_traslado_erp (erp_sucursal_id);

-- El candado real, en el esquema y no en el código: mientras un traslado real
-- de esta sucursal esté vivo (en curso, despachado o recibido) no entra otro.
-- Un intento que falló queda en 'error' y libera el lugar para reintentar.
CREATE UNIQUE INDEX IF NOT EXISTS pedido_traslado_erp_uno_vivo
    ON public.pedido_traslado_erp (pedido_id, erp_sucursal_id, paso)
    WHERE modo = 'real' AND estado <> 'error';

ALTER TABLE public.pedido_traslado_erp ENABLE ROW LEVEL SECURITY;

-- Solo se LEE desde el portal. Lo escribe la edge function con la llave de
-- servicio, que no pasa por RLS — misma forma que el historial de pedidos.
CREATE POLICY pedido_traslado_erp_select ON public.pedido_traslado_erp
    FOR SELECT
    TO public
    USING (
        (SELECT auth_has_module_permission('pedidos'::text, 'can_view'::text))
        AND (
            (SELECT auth_module_scope('pedidos'::text)) = 'ALL'::text
            OR erp_sucursal_id = (SELECT auth_employee_erp_sucursal_id())
        )
    );

COMMENT ON TABLE public.pedido_traslado_erp IS
    'Traslado de un pedido al sistema de origen, una fila por intento. modo=simulacro verifica sin escribir; modo=real despacha. El índice único (pedido, sucursal, paso) WHERE estado<>error es el candado contra el doble despacho.';
