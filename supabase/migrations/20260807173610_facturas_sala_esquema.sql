-- Facturas de mi Sala — esquema.
--
-- El problema, medido el 2026-08-07 sobre datos reales: las salas necesitan la
-- factura del proveedor para cargar la compra, y hoy no hay forma de saber cuál
-- le toca a cada una ni si otra ya la cargó.
--
-- Por qué NO alcanza con cruzar por número o por monto (las dos salidas obvias):
--
--   · `purchase_receipts.documento_numero` viene CORTADO a 20 caracteres y cada
--     sala lo escribe distinto. Para las mismas facturas de COFARSAL conviven
--     siete formatos: 'DTE-03-M001P001-0000', '03-M001P001-00000000',
--     '000000012590', 'DTE-11662', '13130', '13130.' y 'C09DCEC3-2D29-479B-A'.
--     O sea que el número no es llave de nada.
--
--   · Los montos se repiten. $184.68 aparece en 9 de los 21 documentos de
--     recargas del bimestre — es siempre "200 × RECARGA CLARO $1.00". Al cruzar
--     documento contra compra por fecha ±5 días y monto exacto, tres documentos
--     de $184.68 emparejaron cada uno con tres salas distintas y NO hay forma en
--     los datos de decidir si son tres facturas o una cargada tres veces.
--
-- Entonces esta tabla no es un registro administrativo: es LA LLAVE que hoy no
-- existe. Una vez escrito el reclamo, «¿ya la tomó otra sala?» tiene respuesta.

SET lock_timeout = '5s';

-- ── 1 · Qué documentos entran al widget ──────────────────────────────────────
-- No es una lista de proveedores. Las recargas de Tigo y Claro NO las emite
-- Tigo ni Claro: viajan como renglón dentro de una factura de COFARSAL, que es
-- también el proveedor de medicamento más grande (202 facturas en 60 días). Por
-- eso la regla es emisor + patrón del renglón, y cualquiera de los dos puede ir
-- en NULL.
--
-- Verificado antes de escribir esto: de las 202 facturas de COFARSAL, 21 traen
-- recargas y NINGUNA mezcla recargas con medicamento. El patrón selecciona esas
-- 21 exactas y no ensucia el widget con las compras de Bodega.
CREATE TABLE IF NOT EXISTS public.purchase_claim_rules (
    id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    etiqueta     text    NOT NULL,          -- lo que ve la sala: "Agua", "Recarga Tigo"
    emisor_nit   text,                      -- NULL = cualquier emisor
    -- Se compara con ILIKE contra `items_norm`, que viene en minúsculas y sin
    -- puntuación: "RECARGA CLARO $1.00" se guarda como "recarga claro $100".
    -- Por eso el patrón se escribe en minúsculas y sin puntos.
    item_patron  text,                      -- NULL = cualquier renglón
    -- 'reclamo' → la sala la toma a mano (el agua y las recargas no traen ninguna
    --             seña de a quién le tocan: el renglón dice "4 GARRAFA DE AGUA").
    -- 'linea'   → el documento SÍ dice de quién es (el número de teléfono), así
    --             que se asigna sola contra purchase_claim_lines y nadie reclama.
    asignacion   text    NOT NULL DEFAULT 'reclamo'
                         CHECK (asignacion IN ('reclamo', 'linea')),
    activo       boolean NOT NULL DEFAULT true,
    orden        integer NOT NULL DEFAULT 0,
    notas        text,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    -- Una regla que no dice ni emisor ni patrón agarraría TODAS las facturas de
    -- compra de la empresa y las ofrecería para reclamar. No es un caso de uso.
    CONSTRAINT purchase_claim_rules_algun_criterio
        CHECK (emisor_nit IS NOT NULL OR item_patron IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS purchase_claim_rules_activo_idx
    ON public.purchase_claim_rules (activo) WHERE activo;

-- ── 2 · La línea telefónica dice de quién es el documento ────────────────────
-- Movistar factura cada recarga con el número adentro:
--   "Artículo: RECARGA ELECTRONICA. Núm. Teléfono: 78370041"
-- Mapeado el número una vez, esos documentos llegan ya asignados y nadie tiene
-- que reclamar nada. Es la mitad del problema resuelta sin fricción.
CREATE TABLE IF NOT EXISTS public.purchase_claim_lines (
    id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    rule_id    bigint NOT NULL REFERENCES public.purchase_claim_rules(id) ON DELETE CASCADE,
    linea      text   NOT NULL,             -- solo dígitos, sin guiones ni espacios
    branch_id  bigint NOT NULL REFERENCES public.branches(id),
    nota       text,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT purchase_claim_lines_solo_digitos CHECK (linea ~ '^[0-9]{4,}$'),
    CONSTRAINT purchase_claim_lines_una_por_regla UNIQUE (rule_id, linea)
);

CREATE INDEX IF NOT EXISTS purchase_claim_lines_rule_idx   ON public.purchase_claim_lines (rule_id);
CREATE INDEX IF NOT EXISTS purchase_claim_lines_branch_idx ON public.purchase_claim_lines (branch_id);

-- ── 3 · El reclamo ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.purchase_dte_claims (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    document_id     bigint NOT NULL REFERENCES public.purchase_dte_documents(id) ON DELETE CASCADE,
    rule_id         bigint REFERENCES public.purchase_claim_rules(id),
    branch_id       bigint NOT NULL REFERENCES public.branches(id),
    origen          text   NOT NULL DEFAULT 'reclamo'
                           CHECK (origen IN ('reclamo', 'linea')),

    -- Quién y cuándo. La identidad SIEMPRE sale del JWT dentro del RPC, nunca
    -- de un parámetro del navegador.
    claimed_by      uuid REFERENCES public.employees(id),
    claimed_by_name text,
    claimed_at      timestamptz NOT NULL DEFAULT now(),

    -- Alguien va a tomar la que no era. Soltar tiene que ser barato, y tiene que
    -- dejar rastro: no se borra la fila, se cierra.
    released_at     timestamptz,
    released_by     uuid REFERENCES public.employees(id),
    released_motivo text,

    -- El cierre del circuito: la compra registrada que corresponde a este
    -- documento. La escribe `verificar_facturas_reclamadas`, y SOLO cuando el
    -- candidato es único — con montos que se repiten, una coincidencia ambigua
    -- no es una verificación.
    receipt_id      integer REFERENCES public.purchase_receipts(id) ON DELETE SET NULL,
    verificado_at   timestamptz,

    created_at      timestamptz NOT NULL DEFAULT now()
);

-- ── EL CANDADO ──────────────────────────────────────────────────────────────
-- Índice único parcial, NO un trigger ni un SELECT previo. Dos salas que aprietan
-- Confirmar en el mismo segundo: el índice deja pasar una y la otra recibe 23505.
-- Un `SELECT ... WHERE no reclamada` seguido de un INSERT pierde esa carrera
-- siempre, porque entre las dos sentencias no hay nada que sostenga la decisión.
-- Es la misma lección que `approval_requests_una_pendiente_por_factura`.
CREATE UNIQUE INDEX IF NOT EXISTS purchase_dte_claims_uno_vivo
    ON public.purchase_dte_claims (document_id) WHERE released_at IS NULL;

CREATE INDEX IF NOT EXISTS purchase_dte_claims_document_idx ON public.purchase_dte_claims (document_id);
CREATE INDEX IF NOT EXISTS purchase_dte_claims_rule_idx     ON public.purchase_dte_claims (rule_id);
CREATE INDEX IF NOT EXISTS purchase_dte_claims_receipt_idx  ON public.purchase_dte_claims (receipt_id);
CREATE INDEX IF NOT EXISTS purchase_dte_claims_branch_vivo_idx
    ON public.purchase_dte_claims (branch_id, claimed_at DESC) WHERE released_at IS NULL;
-- Lo que busca el aviso «tomada y nunca cargada».
CREATE INDEX IF NOT EXISTS purchase_dte_claims_sin_verificar_idx
    ON public.purchase_dte_claims (claimed_at)
    WHERE released_at IS NULL AND receipt_id IS NULL;

-- ── RLS ─────────────────────────────────────────────────────────────────────
-- Las tres escriben SOLO por RPC SECURITY DEFINER. Por eso no llevan policy de
-- INSERT/UPDATE/DELETE: no es un olvido, es el cierre. `WITH CHECK (true)` en un
-- INSERT es exactamente el agujero que la auditoría del 2026-07-30 encontró en
-- `attendance` y `audit_logs`.
ALTER TABLE public.purchase_claim_rules  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_claim_lines  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_dte_claims   ENABLE ROW LEVEL SECURITY;

-- Las reglas y las líneas son catálogo: sin ellas el widget no puede ni dibujar
-- el nombre del proveedor. Lectura para autenticados, escritura por RPC.
CREATE POLICY purchase_claim_rules_select ON public.purchase_claim_rules
    FOR SELECT TO authenticated USING (true);

CREATE POLICY purchase_claim_lines_select ON public.purchase_claim_lines
    FOR SELECT TO authenticated USING (true);

-- El reclamo lo ve quien tiene el widget, o quien administra las facturas de
-- compra. El `(SELECT ...)` alrededor de cada auth_* NO es cosmético: sin él
-- Postgres evalúa la función POR FILA y cada llamada consulta employees +
-- role_permissions. Fue la causa del pico de CPU del 7-8 jul 2026.
CREATE POLICY purchase_dte_claims_select ON public.purchase_dte_claims
    FOR SELECT TO authenticated
    USING (
        (SELECT public.auth_has_module_permission('dash_facturas_sala', 'can_view'))
        OR (SELECT public.auth_has_module_permission('facturas_compra', 'can_view'))
    );

COMMENT ON TABLE public.purchase_claim_rules IS
    'Qué documentos de compra puede tomar una sala: emisor y/o patrón del renglón. Las recargas de Tigo/Claro llegan como renglón dentro de facturas de COFARSAL, no como emisor propio.';
COMMENT ON TABLE public.purchase_claim_lines IS
    'Número de línea telefónica → sala. Los documentos de Movistar traen el número adentro, así que se asignan solos y no hace falta reclamarlos.';
COMMENT ON TABLE public.purchase_dte_claims IS
    'Qué sala tomó qué documento de compra, y si esa compra terminó registrada. Es la llave documento↔compra que el número de documento no puede dar (viene cortado a 20 caracteres y cada sala lo escribe distinto).';
