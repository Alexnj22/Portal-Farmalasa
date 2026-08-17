SET lock_timeout = '5s';

-- ═══════════════════════════════════════════════════════════════════════════
-- La decisión de una diferencia del pedido — el circuito de acuerdo
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Regla del usuario (2026-08-17), después de mirar el pedido 116 de La Popular:
--
--   Toda diferencia tiene DOS salidas. La propone la SALA —que es la que está
--   revisando—, Bodega acepta o contrapropone la otra, y si no se ponen de
--   acuerdo decide SUPERVISIÓN. El movimiento sale cuando los dos coincidieron.
--   El renglón cierra cuando el movimiento TERMINÓ, o cuando el producto LLEGÓ.
--
-- Lo que corrigió el usuario y le dio la forma: el traslado del pedido YA se
-- hizo y se confirmó, así que un faltante no es «un arreglo de papeles» — el
-- sistema ya le puso el producto a la sala. Quedan desalineadas las DOS puntas
-- (el sistema dice sala, el estante dice bodega) y hay dos maneras legítimas de
-- alinearlas: que el producto viaje, o que el traslado vuelva. Cuál de las dos
-- es una decisión de negocio, no un detalle de implementación — por eso se
-- acuerda y no se elige apretando un botón.

-- ── 1 · El catálogo de opciones ────────────────────────────────────────────
-- Va en una tabla y no escrito a mano en la pantalla: es la regla de
-- «una lista que existe como tabla NO se escribe a mano» (CLAUDE.md). La
-- pantalla la lee, la RPC valida contra ella, y así el valor que se elige
-- coincide con el que la base acepta POR CONSTRUCCIÓN.
CREATE TABLE IF NOT EXISTS public.diferencia_opcion (
    error_tipo   text    NOT NULL,
    valor        text    NOT NULL,
    rotulo       text    NOT NULL,
    ayuda        text,
    orden        smallint NOT NULL,
    -- Qué movimiento dispara al quedar acordada.
    mueve        text    NOT NULL CHECK (mueve IN ('ninguno', 'devolucion', 'traslado_a_sala')),
    -- Quién cierra el renglón, y con qué gesto.
    cierra_con   text    NOT NULL CHECK (cierra_con IN ('acuerdo', 'llegada_sala', 'llegada_bodega', 'entrada_bodega', 'automatico')),
    created_at   timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (error_tipo, valor)
);

ALTER TABLE public.diferencia_opcion ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS diferencia_opcion_select ON public.diferencia_opcion;
CREATE POLICY diferencia_opcion_select ON public.diferencia_opcion
    FOR SELECT TO authenticated USING (true);

COMMENT ON TABLE public.diferencia_opcion IS
'Las dos salidas de cada tipo de diferencia del pedido. Es la ÚNICA lista: la '
'pantalla la lee y la RPC valida contra ella. Regla del usuario 2026-08-17.';

INSERT INTO public.diferencia_opcion (error_tipo, valor, rotulo, ayuda, orden, mueve, cierra_con) VALUES
    -- FALTANTE — el sistema ya se lo dio a la sala; el producto está en bodega.
    ('faltante', 'enviar_producto',   'Que bodega mande el producto',
     'Va en la próxima caja. No se mueve nada en el sistema: ya está a nombre de la sala.', 1, 'ninguno',    'llegada_sala'),
    ('faltante', 'regresar_traslado', 'Regresar el traslado',
     'El producto se queda en bodega y el sistema vuelve a decir lo mismo.',                2, 'devolucion', 'entrada_bodega'),

    -- SOBRANTE — el sistema lo tiene en bodega; el producto está en la sala.
    ('sobrante', 'sala_se_queda',     'La sala se queda con lo de más',
     'Sale un traslado de bodega a la sala por la diferencia.',                             1, 'traslado_a_sala', 'automatico'),
    ('sobrante', 'devolver_producto', 'Devolver el producto',
     'Vuelve en la próxima caja. No hay nada que mover: el sistema nunca se lo dio a la sala.', 2, 'ninguno',   'llegada_bodega'),

    -- DAÑADO — bodega decide con la foto.
    ('danado',   'devolver_bodega',   'Devolver a bodega',
     'El producto vuelve y entra a la ubicación de trabajo de bodega.',                     1, 'devolucion', 'entrada_bodega'),
    ('danado',   'queda_en_sala',     'Se queda en la sala — todavía se vende',
     'Bodega miró la foto y el daño no amerita la devolución.',                             2, 'ninguno',    'acuerdo'),

    -- VENCIDO
    ('vencido',  'devolver_bodega',   'Devolver a bodega',
     'El producto vuelve y entra a la ubicación de trabajo de bodega.',                     1, 'devolucion', 'entrada_bodega'),
    ('vencido',  'queda_en_sala',     'Se queda en la sala',
     'Bodega lo resuelve con la sala por fuera del pedido.',                                2, 'ninguno',    'acuerdo'),

    -- Los dos que ya existían y no mueven inventario. Se portan igual que antes:
    -- el acuerdo los cierra.
    ('presentacion', 'ajuste_sistema',   'Ajuste en el sistema',
     'La presentación no coincide y se corrige en el sistema.',                             1, 'ninguno',    'acuerdo'),
    ('presentacion', 'aceptar_dif_pres', 'Aceptar la diferencia',
     'Se deja como está.',                                                                  2, 'ninguno',    'acuerdo'),
    ('otro',     'resuelto',          'Resuelto',
     'Se aclaró entre las dos partes y no hay nada que mover.',                             1, 'ninguno',    'acuerdo'),
    ('otro',     'no_aplica',         'Sin solución',
     'Queda anotado y no se mueve nada.',                                                   2, 'ninguno',    'acuerdo')
ON CONFLICT (error_tipo, valor) DO UPDATE
   SET rotulo = EXCLUDED.rotulo, ayuda = EXCLUDED.ayuda, orden = EXCLUDED.orden,
       mueve  = EXCLUDED.mueve,  cierra_con = EXCLUDED.cierra_con;

-- ── 2 · Lo que le falta al renglón para llevar la conversación ─────────────
ALTER TABLE public.pedido_items
    ADD COLUMN IF NOT EXISTS resolucion_ronda    smallint NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS resolucion_vence_at timestamptz,
    ADD COLUMN IF NOT EXISTS supervisado_por     uuid REFERENCES public.employees(id),
    ADD COLUMN IF NOT EXISTS supervisado_at      timestamptz;

COMMENT ON COLUMN public.pedido_items.resolucion_ronda IS
'Vueltas de la conversación: 1 = propuso la sala, 2 = contrapropuso bodega. '
'A la tercera no hay acuerdo y decide supervisión.';
COMMENT ON COLUMN public.pedido_items.resolucion_vence_at IS
'Sólo para «que bodega mande el producto»: a los 3 días sin que llegue, el '
'portal propone solo pasarlo a devolución. Decisión del usuario 2026-08-17.';

CREATE INDEX IF NOT EXISTS idx_pedido_items_resolucion_vence
    ON public.pedido_items (resolucion_vence_at)
    WHERE resolucion_vence_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_pedido_items_supervisado_por
    ON public.pedido_items (supervisado_por)
    WHERE supervisado_por IS NOT NULL;
