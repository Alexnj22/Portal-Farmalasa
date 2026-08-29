SET lock_timeout = '5s';

-- Lo que NO llegó en la bolsa.
--
-- ── El agujero que cierra ──────────────────────────────────────────────────
-- Hasta hoy, quien abría una bolsa y encontraba de menos no tenía dónde
-- decirlo, y las dos salidas que había MENTÍAN:
--
--   · En el envío, «Me la quedo» mete existencia que no está en el estante, y
--     «Devolver» dispara el traslado de regreso de algo que nunca salió de tu
--     sala — o sea que le devuelve a la otra una existencia que tampoco tiene.
--   · En la solicitud es peor: hay un solo botón, «Sí, llegó completa». La
--     función que recibe lo dice en un comentario desde el primer día —«se
--     recibe COMPLETO lo que se despachó: recibir de menos es declarar un
--     faltante, y eso necesita a alguien mirando la caja, no una función»— y
--     nunca hubo dónde declararlo.
--
-- El resultado era el mismo en los dos casos: el faltante quedaba invisible
-- hasta que alguien lo tropezara en un conteo, semanas después, sin forma de
-- saber en qué viaje se perdió.
--
-- ── Lo que esta tabla NO hace, a propósito ─────────────────────────────────
-- **No mueve inventario.** Declarar un faltante es decir qué se vio, no
-- corregir el papel: el traslado ya se despachó y en la solicitud el sistema ya
-- le puso el producto a la sala. Cómo se alinean las dos puntas es la decisión
-- de diferencias que ya existe para el pedido de Bodega (la sala propone,
-- Bodega contesta, supervisión desempata) y todavía no está conectada acá.
-- Mientras tanto lo que esto garantiza es que el faltante EXISTA, con nombre,
-- fecha, cantidad y quién lo vio, y que la sala que despachó se entere el mismo
-- día en vez de un mes después.
--
-- ── Una sola tabla para las dos familias ───────────────────────────────────
-- La solicitud y el envío llegan por caminos distintos y se cierran distinto,
-- pero «faltó esto en la bolsa» es el mismo hecho y quien lo resuelve quiere
-- UNA lista, no dos. Es la misma razón por la que `FilasTraslado` y
-- `FilasEnvio` viven en el mismo módulo del portal.

-- ══════════════════════════════════════════════════════════════════════════
-- 1 · El renglón del envío que no llegó
-- ══════════════════════════════════════════════════════════════════════════
--
-- El CHECK va PRIMERO y en su propia sentencia: una función que escribe un
-- estado que la tabla no acepta no falla al escribirla, falla al ejecutarla —y
-- para entonces ya hay alguien con la caja en la mano.
--
-- `no_llego` no llama a nadie del lado del sistema de origen, y eso es lo
-- correcto por construcción: el traslado de ese renglón salió y nunca se
-- recibió, así que dejarlo despachado-sin-recibir es exactamente la verdad.
-- Aceptar lo metería en el inventario de la sala; devolver crearía el
-- movimiento de vuelta de algo que no está.
ALTER TABLE public.envio_linea DROP CONSTRAINT IF EXISTS envio_linea_estado_check;
ALTER TABLE public.envio_linea ADD CONSTRAINT envio_linea_estado_check
    CHECK (estado = ANY (ARRAY[
        'por_enviar', 'enviada', 'error',
        'aceptada', 'devuelta', 'devuelta_recibida',
        'no_llego'
    ]));

-- ══════════════════════════════════════════════════════════════════════════
-- 2 · La tabla
-- ══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.bolsa_faltante (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id        uuid NOT NULL REFERENCES public.approval_requests(id) ON DELETE CASCADE,
    -- De qué familia viene. Se deriva del `type` de la fila y no lo manda el
    -- llamador: un rótulo que se pasa por parámetro es un rótulo que puede
    -- mentir sobre a qué apunta el `request_id`.
    familia           text NOT NULL CHECK (familia IN ('solicitud', 'envio')),
    posicion          integer NOT NULL,
    erp_product_id    integer,
    descripcion       text,
    presentacion_tipo text,
    -- Lo que FALTÓ, no lo que venía. Un faltante parcial —vinieron 3 de 5— es
    -- el caso normal en una caja armada a mano.
    cantidad          numeric NOT NULL CHECK (cantidad > 0),
    nota              text,

    origen_branch_id  integer REFERENCES public.branches(id),
    destino_branch_id integer REFERENCES public.branches(id),

    declarado_por     uuid REFERENCES public.employees(id),
    declarado_at      timestamptz NOT NULL DEFAULT now(),

    -- `abierto` mientras nadie lo cerró. Los dos finales son los dos únicos
    -- desenlaces reales de una caja: apareció, o no apareció. Cualquier arreglo
    -- de existencias que haga falta después es otro acto y deja su propio
    -- rastro; acá sólo se cierra el hecho.
    estado            text NOT NULL DEFAULT 'abierto'
                      CHECK (estado IN ('abierto', 'aparecio', 'no_aparecio')),
    resolucion        text,
    resuelto_por      uuid REFERENCES public.employees(id),
    resuelto_at       timestamptz,

    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now()
);

-- Un renglón no puede tener DOS faltantes abiertos: dos personas mirando la
-- misma caja declararían el mismo hueco dos veces y la lista contaría doble.
-- Parcial y no total, para que el renglón pueda volver a faltar en otro viaje
-- después de que el primero se cerró.
CREATE UNIQUE INDEX IF NOT EXISTS uq_bolsa_faltante_abierto
    ON public.bolsa_faltante (request_id, posicion)
 WHERE estado = 'abierto';

CREATE INDEX IF NOT EXISTS idx_bolsa_faltante_request   ON public.bolsa_faltante (request_id);
CREATE INDEX IF NOT EXISTS idx_bolsa_faltante_abiertos  ON public.bolsa_faltante (declarado_at DESC) WHERE estado = 'abierto';
CREATE INDEX IF NOT EXISTS idx_bolsa_faltante_origen    ON public.bolsa_faltante (origen_branch_id);
CREATE INDEX IF NOT EXISTS idx_bolsa_faltante_destino   ON public.bolsa_faltante (destino_branch_id);
CREATE INDEX IF NOT EXISTS idx_bolsa_faltante_declarado ON public.bolsa_faltante (declarado_por);
CREATE INDEX IF NOT EXISTS idx_bolsa_faltante_resuelto  ON public.bolsa_faltante (resuelto_por);

DROP TRIGGER IF EXISTS bolsa_faltante_updated_at ON public.bolsa_faltante;
CREATE TRIGGER bolsa_faltante_updated_at
    BEFORE UPDATE ON public.bolsa_faltante
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.bolsa_faltante ENABLE ROW LEVEL SECURITY;

-- Ve el faltante quien ve la bolsa. Copiado de `envio_linea_select` a
-- propósito: el RLS de `approval_requests` ya sabe que un traslado se ve desde
-- su origen o desde su destino, y repetir esa regla acá sería tener dos que se
-- pueden desincronizar.
DROP POLICY IF EXISTS bolsa_faltante_select ON public.bolsa_faltante;
CREATE POLICY bolsa_faltante_select ON public.bolsa_faltante
    FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM public.approval_requests r WHERE r.id = bolsa_faltante.request_id));

-- Sin policy de escritura: se declara y se cierra por función, nunca con un
-- INSERT del navegador. Es la misma razón que en `export_log` — quien declara
-- no puede elegir con el nombre de quién firma, ni contra qué renglón.
