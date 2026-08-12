SET lock_timeout = '5s';

-- La devolución de un renglón del pedido, de la sala a Bodega.
--
-- ── Por qué hace falta ──────────────────────────────────────────────────────
-- El traslado es todo o nada: la recepción ingresa la cantidad COMPLETA que
-- salió de Bodega, aunque la sala haya contado menos. Hoy esa diferencia se
-- anota en el portal y ahí muere — nunca toca las existencias—, así que si la
-- sala contó 28 de 30, el sistema sigue diciendo 30 para siempre.
--
-- Y esos 2 casi siempre están en Bodega: un faltante suele ser que se empacó de
-- menos, no que la mercadería se perdió. Por eso la salida no es recibir menos
-- —eso las haría desaparecer de los dos lados— sino devolverlas: un traslado
-- sala → Bodega que deja cada unidad con dueño.
--
-- ── Una fila por producto ───────────────────────────────────────────────────
-- Igual que el despacho (`pedido_traslado_linea`): el sistema trata el traslado
-- como un hecho binario —pendiente o finalizado, no existe «recibí la mitad»—,
-- así que un traslado por producto es lo que permite que uno falle, se reintente
-- o se reciba sin arrastrar a los demás.
--
-- ── Dos sabores, y la solicitud tiene que decir cuál ────────────────────────
-- Decisión del usuario (2026-08-12):
--
--   `viaja = false` (faltante) — el producto NUNCA salió de Bodega. No viaja
--   nada: es un arreglo en el sistema y Bodega lo confirma en el momento, sin
--   esperar a ver ninguna caja.
--
--   `viaja = true` (dañado, vencido) — el producto está en la sala y vuelve
--   físicamente. Bodega lo confirma CUANDO LO TENGA, no antes.
--
-- Quien recibe en Bodega necesita saber cuál de las dos está mirando, o va a
-- esperar una caja que no viene — o a dar por recibida una que todavía va en el
-- camión. Por eso el dato vive en la fila y se pinta en la pantalla.
--
-- ── El daño se muestra ──────────────────────────────────────────────────────
-- Decisión del usuario (2026-08-12): el motivo `danado` exige foto. No es
-- burocracia: es lo que deja a Bodega decidir si el daño amerita la devolución
-- o si el producto todavía se puede vender. Sin la foto, la decisión sería a
-- ciegas. Lo exige la RPC con un mensaje claro y lo garantiza el CHECK de acá.
CREATE TABLE IF NOT EXISTS public.pedido_devolucion (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    pedido_id        uuid    NOT NULL REFERENCES public.pedidos(id) ON DELETE CASCADE,
    erp_sucursal_id  integer NOT NULL,
    pedido_item_id   integer NOT NULL REFERENCES public.pedido_items(id) ON DELETE CASCADE,
    erp_product_id   integer NOT NULL,

    motivo           text    NOT NULL CHECK (motivo IN ('faltante', 'danado', 'vencido')),
    -- Se deriva del motivo y no se recibe del cliente. El CHECK está para que no
    -- puedan divergir: una devolución marcada «sólo en el sistema» sobre
    -- mercadería que sí viaja es exactamente la que queda en tránsito.
    viaja            boolean NOT NULL,
    -- En la presentación del pedido (packs), igual que `cantidad_asignada` y
    -- `cantidad_enviada`. El factor sale del ítem al armar el movimiento.
    cantidad         integer NOT NULL CHECK (cantidad > 0),
    nota             text,
    -- URLs formato-público del bucket privado `inventario-evidencia` (regla 10
    -- de CLAUDE.md: en la base nunca se guarda una URL firmada, que expira).
    evidencia_urls   jsonb   NOT NULL DEFAULT '[]'::jsonb,

    estado           text    NOT NULL DEFAULT 'solicitada'
        CHECK (estado IN ('solicitada', 'rechazada', 'aceptada',
                          'enviando', 'enviada', 'recibida', 'error')),

    solicitada_por   uuid REFERENCES public.employees(id),
    solicitada_at    timestamptz NOT NULL DEFAULT now(),
    decidida_por     uuid REFERENCES public.employees(id),
    decidida_at      timestamptz,
    decision_nota    text,
    motivo_rechazo   text,

    -- La llave de idempotencia. Viaja PRIMERO en el concepto del movimiento:
    -- es lo que permite encontrarlo en el sistema y lo que se busca antes de
    -- reintentar una línea cortada, para no moverla dos veces.
    clave            text NOT NULL,
    id_traslado      text,
    numero_vale      text,
    detalle          jsonb,
    aviso            text,
    error_msg        text,
    enviado_at       timestamptz,
    enviado_por      uuid REFERENCES public.employees(id),
    recibido_at      timestamptz,
    recibido_por     uuid REFERENCES public.employees(id),

    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT pedido_devolucion_viaja_segun_motivo
        CHECK (viaja = (motivo <> 'faltante')),
    CONSTRAINT pedido_devolucion_danado_con_foto
        CHECK (motivo <> 'danado' OR jsonb_array_length(evidencia_urls) > 0),
    CONSTRAINT pedido_devolucion_rechazo_con_motivo
        CHECK (estado <> 'rechazada' OR nullif(btrim(coalesce(motivo_rechazo, '')), '') IS NOT NULL)
);

-- Una devolución VIVA por renglón. La rechazada no cuenta: si Bodega dice que
-- el daño no amerita, la sala puede volver a proponer con más información.
-- La que quedó en `error` SÍ cuenta, y a propósito: puede haber entrado en el
-- sistema y no haberse alcanzado a anotar, así que se reintenta esa misma fila
-- —nunca se abre otra— hasta que alguien mire con la clave en la mano.
CREATE UNIQUE INDEX IF NOT EXISTS pedido_devolucion_una_viva
    ON public.pedido_devolucion(pedido_id, erp_sucursal_id, pedido_item_id)
    WHERE estado <> 'rechazada';

CREATE INDEX IF NOT EXISTS pedido_devolucion_item_idx
    ON public.pedido_devolucion(pedido_item_id);

-- Las dos colas de Bodega: lo que falta decidir y lo que falta recibir.
CREATE INDEX IF NOT EXISTS pedido_devolucion_abiertas_idx
    ON public.pedido_devolucion(estado, solicitada_at)
    WHERE estado IN ('solicitada', 'aceptada', 'enviada', 'error');

ALTER TABLE public.pedido_devolucion ENABLE ROW LEVEL SECURITY;

-- Verla puede cualquiera que vea Pedidos: la sala necesita saber qué contestó
-- Bodega y Bodega necesita ver lo que le mandan. Las dos puntas del mismo hilo.
DROP POLICY IF EXISTS pedido_devolucion_select ON public.pedido_devolucion;
CREATE POLICY pedido_devolucion_select ON public.pedido_devolucion
    FOR SELECT TO authenticated
    USING ((SELECT auth_has_module_permission('pedidos', 'can_view')));

-- Escribir SOLO por las RPC y por la edge function (service_role). Sin policy
-- de INSERT/UPDATE/DELETE: nadie fabrica una devolución a mano ni la marca
-- recibida sin que el movimiento haya entrado de verdad.
