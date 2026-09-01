SET lock_timeout = '5s';

-- ═══════════════════════════════════════════════════════════════════════════
-- LOS TIPOS DE MOVIMIENTO DEL CAJÓN — lo que entra y lo que sale, con nombre.
--
-- ── Por qué existe ────────────────────────────────────────────────────────
-- El concepto del cajón era TEXTO LIBRE. Medido sobre 60 días de movimientos
-- reales, la aplicación de inyección —el ingreso más frecuente de todos, ~600
-- veces— está escrita de QUINCE maneras: «APLICACION DE INYECCION»,
-- «APLICACION», «INYECCION», «APLIC DE INYEC», «APLICACION D EINYECCION»,
-- «APLIC D EINYEC», «2 APLICACIONES DE INYECCION»… La prueba de glucosa, de
-- cuatro. Y eso no es un problema de prolijidad: **no se puede contar**. Nadie
-- puede decir cuánto entró por aplicaciones este mes sin leer 600 renglones a
-- mano y decidir uno por uno.
--
-- Es la misma regla que ya está escrita para los catálogos: una lista de
-- opciones que existe como tabla NO se escribe a mano — sale de la tabla, y el
-- valor elegido coincide con la base por construcción y no por suerte.
--
-- ── El concepto libre NO se va ────────────────────────────────────────────
-- Sigue existiendo, pero como DETALLE del tipo, no como la única identidad.
-- «Aplicación de inyección» es el tipo; «Neurobion 25000» es el detalle. Así
-- se puede sumar por tipo sin perder lo que la sala quería anotar.
--
-- ── `sentido` y no dos tablas ─────────────────────────────────────────────
-- Entrar y salir de la caja son el mismo acto con el signo dado vuelta, y ya
-- comparten camino en `operar-caja`. Dos tablas obligarían a mantener dos veces
-- las mismas columnas para que se vean iguales en la misma pantalla.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.caja_tipos_movimiento (
    codigo        text        PRIMARY KEY,
    etiqueta      text        NOT NULL,
    sentido       text        NOT NULL CHECK (sentido IN ('ENTRADA','SALIDA')),

    -- Qué le pide a quien lo anota. Cada uno existe porque SIN él el registro
    -- queda sin la mitad del dato, no porque quede más completo.
    pide_boleta   boolean     NOT NULL DEFAULT false,   -- el número del recibo
    pide_persona  boolean     NOT NULL DEFAULT false,   -- quién recibió o quién pagó
    foto          text        NOT NULL DEFAULT 'OPCIONAL'
                              CHECK (foto IN ('NO','OPCIONAL','OBLIGATORIA')),

    -- El que abre el circuito del abono: pide cliente, renglones y saca papel.
    -- Es una bandera y no un `codigo = 'ABONO_CLIENTE'` en el frente, para que
    -- el día que haya un segundo tipo con comprobante no haya que tocar la
    -- pantalla.
    lleva_comprobante boolean NOT NULL DEFAULT false,

    -- Una leyenda que la pantalla muestra al elegirlo. Sirve para lo que sólo
    -- se explica en el momento: qué cuenta como qué.
    leyenda       text,

    orden         integer     NOT NULL DEFAULT 100,
    activo        boolean     NOT NULL DEFAULT true,
    created_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.caja_tipos_movimiento IS
    'Catálogo de lo que entra y sale del cajón. El concepto libre pasa a ser el detalle del tipo, no la identidad.';

CREATE INDEX IF NOT EXISTS caja_tipos_activos_idx
    ON public.caja_tipos_movimiento (sentido, orden) WHERE activo;

ALTER TABLE public.caja_tipos_movimiento ENABLE ROW LEVEL SECURITY;

-- Lo lee cualquiera que pueda ver la caja: es un catálogo, no un dato de sala.
CREATE POLICY caja_tipos_select ON public.caja_tipos_movimiento
    FOR SELECT TO authenticated
    USING ((SELECT auth_has_module_permission('caja_vales', 'can_view')));

CREATE POLICY bloqueo_global ON public.caja_tipos_movimiento
    AS RESTRICTIVE FOR ALL TO public
    USING ((SELECT auth_no_bloqueado()));

GRANT SELECT ON public.caja_tipos_movimiento TO authenticated;
REVOKE ALL ON public.caja_tipos_movimiento FROM anon;

-- ── La semilla, y de dónde sale cada renglón ──────────────────────────────
--
-- NO es una lista imaginada: cada tipo sale de lo que las salas ya anotaron en
-- los últimos 60 días, con su cuenta al lado. Un catálogo inventado deja fuera
-- lo que la gente hace de verdad y obliga a usar «Otro» para la mitad.
INSERT INTO public.caja_tipos_movimiento
    (codigo, etiqueta, sentido, pide_boleta, pide_persona, foto, lleva_comprobante, leyenda, orden)
VALUES
    -- ~600 movimientos, escritos de 15 formas. Es el ingreso más frecuente.
    ('APLICACION',    'Aplicacion de inyeccion',   'ENTRADA', false, false, 'NO',        false,
     'En el detalle va qué se aplicó.', 10),
    -- 41 movimientos, 4 formas.
    ('GLUCOSA',       'Prueba de glucosa',         'ENTRADA', false, false, 'NO',        false, NULL, 20),
    -- 101 movimientos, $1,768.90. El cliente paga lo que debía de un crédito.
    ('ABONO_CREDITO', 'Abono a un credito',        'ENTRADA', false, true,  'OPCIONAL',  false,
     'El cliente paga algo de lo que ya debía.', 30),
    -- El circuito nuevo: dinero que el cliente deja para apartar un producto.
    ('ABONO_CLIENTE', 'Abono para apartar producto','ENTRADA', false, true, 'NO',        true,
     'Sale un comprobante para el cliente.', 40),
    -- 19 movimientos.
    ('DOMICILIO',     'Servicio a domicilio',      'ENTRADA', false, false, 'NO',        false, NULL, 50),
    -- El pago de un recibo (CAESS, agua): el dinero entra y la boleta lo prueba.
    ('PAGO_SERVICIO', 'Pago de un recibo',         'ENTRADA', true,  false, 'OPCIONAL',  false,
     'Luz, agua, teléfono. El número de la boleta es lo que lo prueba.', 60),
    ('OTRO_ENTRADA',  'Otro',                      'ENTRADA', false, false, 'OPCIONAL',  false,
     'Escribe en el detalle de qué se trata.', 99),

    -- ── Lo que sale del cajón ────────────────────────────────────────────
    ('COMPRA',        'Compra o gasto urgente',    'SALIDA',  true,  true,  'OPCIONAL',  false,
     'Agua, saldo telefónico, un mandado. La boleta es el respaldo.', 10),
    ('PAGO_PROVEEDOR','Pago a proveedor',          'SALIDA',  true,  false, 'OPCIONAL',  false, NULL, 20),
    ('ANTICIPO',      'Anticipo a un empleado',    'SALIDA',  false, true,  'OPCIONAL',  false, NULL, 30),
    ('BONIFICACION',  'Pago de bonificacion',      'SALIDA',  false, true,  'OPCIONAL',  false,
     'Comisión de línea autorizada.', 40),
    ('DEVOLUCION',    'Devolucion a un cliente',   'SALIDA',  false, true,  'OPCIONAL',  false,
     'Se le regresa dinero a un cliente.', 50),
    ('OTRO_SALIDA',   'Otro',                      'SALIDA',  false, true,  'OPCIONAL',  false,
     'Escribe en el detalle de qué se trata.', 99)
ON CONFLICT (codigo) DO NOTHING;

-- El tipo elegido queda en el movimiento. `NULL` en las filas viejas NO es un
-- dato faltante que haya que rellenar: son los que se anotaron cuando el
-- concepto era todo lo que había, y adivinarles un tipo hoy sería inventar una
-- clasificación que nadie hizo.
ALTER TABLE public.caja_movimientos_portal
    ADD COLUMN IF NOT EXISTS tipo_codigo text REFERENCES public.caja_tipos_movimiento(codigo);

CREATE INDEX IF NOT EXISTS caja_mov_portal_tipo_idx
    ON public.caja_movimientos_portal (tipo_codigo) WHERE tipo_codigo IS NOT NULL;
