SET lock_timeout = '5s';

-- ═══════════════════════════════════════════════════════════════════════════
-- ABONOS DE CLIENTE — el dinero que un cliente deja para apartar un producto.
--
-- ── El circuito, decidido por el usuario (2026-09-01) ──────────────────────
--
--   ABONO   el cliente deja $X → es un INGRESO de caja. El dinero entra al
--           cajón y cuenta para el corte del día como cualquier otro ingreso.
--   RETIRO  el cliente vuelve, se factura el total y paga la diferencia. Como
--           los $X ya habían entrado días antes, se anota un VALE (salida) por
--           ese monto: sin él, la caja esperaría el total de la venta y sólo
--           habría recibido la diferencia. El vale es lo que explica el hueco.
--
-- ── Lo que NO hace, y es deliberado ───────────────────────────────────────
-- **No toca existencias.** El producto se aparta a mano en la sala; el
-- disponible del sistema lo sigue contando. Es la decisión del usuario, y
-- evita el problema que no tiene buena respuesta: qué hacer con la existencia
-- de una reserva que vence — devolverla al disponible sin que nadie mire el
-- estante es inventar stock.
--
-- ── Los renglones van en `jsonb` y no en una tabla hija ───────────────────
-- Un renglón puede ser un producto del catálogo O un nombre escrito a mano —
-- el encargo que todavía no existe como producto—, así que la mitad de las
-- filas no tendría FK. Y **nunca se consultan por separado**: se leen enteros
-- con su abono, para reimprimir el papel. Una tabla hija daría un join en cada
-- lectura para no contestar ninguna pregunta propia.
--
-- ── El papel es el contrato, así que se guarda como se imprimió ───────────
-- `cliente_nombre` y `cliente_telefono` se copian a la fila aunque el cliente
-- tenga ficha en el sistema de origen. Si mañana alguien le corrige el nombre,
-- el comprobante que el cliente tiene en la mano sigue siendo reconstruible —
-- que es justamente lo que un comprobante tiene que poder hacer.
-- ═══════════════════════════════════════════════════════════════════════════

-- El folio es SOLO letras y dígitos, sin guion, porque va adentro del código de
-- barras: `limpiarValorDeBarras` deja `[A-Z0-9]` y nada más (es el alfabeto que
-- las dos simbologías del rollo aceptan sin cambiar de juego de caracteres). Con
-- un guion, el papel diría `S3-1000` y el lector devolvería `S31000` — y la
-- búsqueda por folio fallaría sólo al escanear, nunca al teclear.
CREATE SEQUENCE IF NOT EXISTS public.abonos_folio_seq START 1000;

CREATE TABLE IF NOT EXISTS public.abonos_de_cliente (
    id                    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    folio                 text        NOT NULL UNIQUE,
    branch_id             integer     NOT NULL REFERENCES public.branches(id),
    fecha                 date        NOT NULL,

    -- A quién. `cliente_erp_id` liga con la ficha del sistema de origen cuando
    -- se pudo reconocer; el nombre y el teléfono se guardan siempre.
    cliente_erp_id        integer,
    cliente_nombre        text        NOT NULL CHECK (length(btrim(cliente_nombre)) >= 3),
    cliente_telefono      text,

    -- Cuánto. `total` es NULL cuando el precio quedó «por definir» — y eso NO
    -- es un dato faltante: es un estado del acuerdo, y el papel no imprime
    -- ningún monto de ese renglón a propósito.
    total                 numeric(12,2) CHECK (total IS NULL OR total >= 0),
    abonado               numeric(12,2) NOT NULL CHECK (abonado > 0),

    renglones             jsonb       NOT NULL DEFAULT '[]'::jsonb
                                      CHECK (jsonb_typeof(renglones) = 'array'),

    estado                text        NOT NULL DEFAULT 'ABIERTO'
                                      CHECK (estado IN ('ABIERTO','RETIRADO','VENCIDO','ANULADO')),
    vence_el              date        NOT NULL,

    -- Quién lo recibió y con qué movimiento de caja entró el dinero.
    anotado_por           uuid        NOT NULL REFERENCES public.employees(id),
    movimiento_ingreso_id bigint      REFERENCES public.caja_movimientos_portal(id),

    -- Quién lo entregó y con qué vale salió el dinero que ya había entrado.
    retirado_at           timestamptz,
    retirado_por          uuid        REFERENCES public.employees(id),
    movimiento_vale_id    bigint      REFERENCES public.caja_movimientos_portal(id),

    -- Por qué se anuló, cuando se anula. Un abono anulado NO se borra: el
    -- cliente tiene un papel con ese folio, y borrar la fila deja el papel sin
    -- nada detrás.
    anulado_motivo        text,

    created_at            timestamptz NOT NULL DEFAULT now(),
    updated_at            timestamptz NOT NULL DEFAULT now(),

    -- Un abono retirado tiene que decir CUÁNDO y QUIÉN. Sin esto, el estado se
    -- puede mover a mano y quedar sin firma, que es la mitad del control.
    CONSTRAINT abono_retirado_con_firma CHECK (
        estado <> 'RETIRADO' OR (retirado_at IS NOT NULL AND retirado_por IS NOT NULL)
    )
);

COMMENT ON TABLE public.abonos_de_cliente IS
    'Abonos de cliente para apartar producto. El abono entra como INGRESO de caja; al retirar se anota un VALE por el mismo monto. No toca existencias.';

-- Las FK con índice que las cubra (regla 2 de la estructura). `anotado_por` y
-- `retirado_por` son auditoría pura y la tabla es chica: sin índice.
CREATE INDEX IF NOT EXISTS abonos_branch_fecha_idx
    ON public.abonos_de_cliente (branch_id, fecha DESC);
-- El índice con el que se entra a esta tabla: «los que siguen esperando». Va
-- parcial porque un abono retirado no se vuelve a buscar por estado, y los
-- abiertos son la minoría permanente.
CREATE INDEX IF NOT EXISTS abonos_abiertos_idx
    ON public.abonos_de_cliente (branch_id, vence_el)
    WHERE estado = 'ABIERTO';
CREATE INDEX IF NOT EXISTS abonos_cliente_erp_idx
    ON public.abonos_de_cliente (cliente_erp_id)
    WHERE cliente_erp_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS abonos_mov_ingreso_idx
    ON public.abonos_de_cliente (movimiento_ingreso_id);
CREATE INDEX IF NOT EXISTS abonos_mov_vale_idx
    ON public.abonos_de_cliente (movimiento_vale_id);

ALTER TABLE public.abonos_de_cliente ENABLE ROW LEVEL SECURITY;

/* Lo ve quien ve la caja, y con el alcance de la caja: un abono es dinero de
 * una sala. `(SELECT …)` alrededor de cada `auth_*` NO es estilo — sin el
 * initplan, Postgres evalúa la función POR FILA (incidente 2026-07-08). */
CREATE POLICY abonos_select ON public.abonos_de_cliente
    FOR SELECT TO authenticated
    USING (
        (SELECT auth_has_module_permission('caja_vales', 'can_view'))
        AND (
            (SELECT auth_module_scope('caja_vales')) = 'ALL'
            OR branch_id = (SELECT auth_employee_branch_id())
        )
    );

/* Se escribe por la edge function con `service_role` —es ella la que anota el
 * ingreso en el sistema de la caja y sólo entonces puede escribir acá—, así que
 * `authenticated` NO tiene INSERT ni UPDATE. Un `WITH CHECK` permisivo dejaría
 * fabricar un abono sin que entrara un centavo a la caja. */

CREATE POLICY abonos_bloqueo_global ON public.abonos_de_cliente
    AS RESTRICTIVE FOR ALL TO public
    USING ((SELECT auth_no_bloqueado()));

GRANT SELECT ON public.abonos_de_cliente TO authenticated;
REVOKE ALL ON public.abonos_de_cliente FROM anon;

CREATE OR REPLACE FUNCTION public.touch_abonos_updated_at()
RETURNS trigger LANGUAGE plpgsql
SET search_path = public, extensions AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS abonos_touch ON public.abonos_de_cliente;
CREATE TRIGGER abonos_touch BEFORE UPDATE ON public.abonos_de_cliente
    FOR EACH ROW EXECUTE FUNCTION public.touch_abonos_updated_at();

/**
 * El folio de un abono: el código de la sala y un correlativo global.
 *
 * `S3` + `1000` → `S31000`. Sin guion, por lo del código de barras. El
 * correlativo es global y no por sala a propósito: dos salas con su propia
 * serie darían `S31000` y `S41000` el mismo día, y al escanear uno con el otro
 * en la mano nadie notaría que son abonos distintos del mismo número.
 *
 * DEFINER porque `nextval` sobre la secuencia no se le concede a nadie más: el
 * folio no puede depender de que el cliente lo pida bien.
 */
CREATE OR REPLACE FUNCTION public.siguiente_folio_de_abono(p_branch_id integer)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE
    v_codigo text;
BEGIN
    SELECT codigo INTO v_codigo FROM public.branches WHERE id = p_branch_id;
    -- Sin código de sala el folio saldría `1000` a secas y chocaría con el de
    -- otra sala el día que a alguien se le olvide poner el código. Se para.
    IF v_codigo IS NULL OR btrim(v_codigo) = '' THEN
        RAISE EXCEPTION 'La sucursal % no tiene código, y el folio del abono sale de ahí.', p_branch_id;
    END IF;
    RETURN upper(regexp_replace(v_codigo, '[^A-Za-z0-9]', '', 'g'))
        || nextval('public.abonos_folio_seq')::text;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.siguiente_folio_de_abono(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.siguiente_folio_de_abono(integer) TO service_role;
