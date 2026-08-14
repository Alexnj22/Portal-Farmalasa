-- Cortes de caja: la bitácora de decisiones y la resolución de la diferencia.
--
-- Por qué hacen falta las tres tablas (2026-08-14):
--
-- 1. `cortes_caja_eventos` — hasta hoy una firma era definitiva: `resolver_corte_
--    caja` rechaza cualquier corte ya resuelto. El usuario pidió poder reabrir
--    «aun confirmado, queda el registro de quién y por qué». `cortes_caja` sólo
--    tiene `resuelto_por`/`resuelto_at`, que guardan la ÚLTIMA decisión: sin esta
--    tabla, reabrir BORRA la firma anterior y con ella el motivo. La bitácora es
--    lo que hace que reabrir sea seguro.
--
-- 2. `cortes_caja_diferencias` — un faltante o un sobrante no se «confirma» y ya:
--    se repone dinero, se retira, o se justifica porque apareció la causa. Es una
--    fila por diferencia resuelta, y vive aparte del corte porque el corte es la
--    foto que mandó el origen y esto es lo que decidió la empresa encima.
--
-- 3. `cortes_caja_diferencia_personas` — «quedarán registrados los del turno, ahí
--    se puede seleccionar o quitar si uno no aportó» (usuario). O sea que una
--    reposición es de VARIAS personas con su parte cada una, no de una sola.
--
-- El ERP recibe UN solo ingreso/vale que cubre varias resoluciones (decisión del
-- usuario: «lo que haríamos es hacer un solo ingreso / vale en el ERP, y en el
-- portal estarían bien definidos»). Por eso `asentado_ref` es el número de ESE
-- asiento y se repite entre filas: acá se guarda el detalle, allá el total.
-- El portal sigue sin escribir en el origen — ver la decisión del 2026-08-14.

SET lock_timeout = '5s';

-- ── 1. La bitácora ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.cortes_caja_eventos (
    id              bigserial PRIMARY KEY,
    corte_id        bigint      NOT NULL REFERENCES public.cortes_caja(id) ON DELETE CASCADE,
    accion          text        NOT NULL CHECK (accion IN (
                        'CONFIRMAR', 'DESCARTAR', 'REABRIR',
                        'RESOLVER_DIFERENCIA', 'ANULAR_DIFERENCIA', 'ASENTAR')),
    estado_antes    text,
    estado_despues  text,
    motivo          text,
    nota            text,
    -- Quién la tomó. Lo pone el servidor (`auth_employee_id()`), nunca el
    -- navegador — ver `rpc_authorship_never_trust_client_param`.
    employee_id     uuid        REFERENCES public.employees(id),
    origen          text,
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cortes_eventos_corte
    ON public.cortes_caja_eventos(corte_id, created_at DESC);

-- ── 2. La diferencia resuelta ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.cortes_caja_diferencias (
    id              bigserial PRIMARY KEY,
    corte_id        bigint      NOT NULL REFERENCES public.cortes_caja(id) ON DELETE CASCADE,
    -- Repetidos del corte a propósito: la pantalla que junta lo pendiente de
    -- asentar agrupa por sala y día, y sin ellos cada fila obligaría a volver al
    -- corte. Los pone el RPC desde el corte, no el llamador.
    branch_id       bigint      NOT NULL REFERENCES public.branches(id),
    fecha           date        NOT NULL,

    -- CON SIGNO, igual que el tramo: negativo = faltante, positivo = sobrante.
    -- Guardar el valor absoluto obligaría a leer `via` para saber de qué lado
    -- está, y entonces una `via` mal escrita cambiaría el signo del dinero.
    monto           numeric(12,2) NOT NULL CHECK (monto <> 0),

    -- REPONE  → entra dinero (faltante que alguien repone)
    -- RETIRA  → sale dinero  (sobrante que se saca de la caja)
    -- JUSTIFICA → no mueve dinero: apareció la causa y ya está corregida
    via             text        NOT NULL CHECK (via IN ('REPONE', 'RETIRA', 'JUSTIFICA')),
    causa           text        NOT NULL CHECK (btrim(causa) <> ''),

    registrado_por  uuid        REFERENCES public.employees(id),
    registrado_at   timestamptz NOT NULL DEFAULT now(),

    -- Cuándo se imprimió el comprobante para anexar al corte. Nulo = todavía no
    -- salió papel. No es lo mismo que resuelta: se puede reimprimir.
    impreso_at      timestamptz,

    -- El asiento único en el sistema. Nulo = todavía no se registró allá.
    asentado_at     timestamptz,
    asentado_por    uuid        REFERENCES public.employees(id),
    asentado_ref    text,

    -- Se anula, no se borra: el papel ya salió y alguien lo firmó.
    anulada_at      timestamptz,
    anulada_por     uuid        REFERENCES public.employees(id),
    anulada_motivo  text,

    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),

    -- Un asiento sin fecha, o una fecha sin asiento, es media resolución.
    CONSTRAINT cortes_dif_asiento_completo
        CHECK ((asentado_at IS NULL) = (asentado_por IS NULL)),
    CONSTRAINT cortes_dif_anulada_con_motivo
        CHECK (anulada_at IS NULL OR btrim(coalesce(anulada_motivo, '')) <> ''),
    -- Justificar no mueve dinero, así que no puede tener asiento en el sistema.
    CONSTRAINT cortes_dif_justifica_no_se_asienta
        CHECK (via <> 'JUSTIFICA' OR asentado_at IS NULL)
);

-- UNA diferencia viva por corte. Parcial porque las anuladas se conservan.
CREATE UNIQUE INDEX IF NOT EXISTS idx_cortes_dif_una_viva_por_corte
    ON public.cortes_caja_diferencias(corte_id) WHERE anulada_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_cortes_dif_branch_fecha
    ON public.cortes_caja_diferencias(branch_id, fecha);

-- El índice que sirve a la pantalla de «pendientes de asentar».
CREATE INDEX IF NOT EXISTS idx_cortes_dif_sin_asentar
    ON public.cortes_caja_diferencias(branch_id, fecha)
    WHERE anulada_at IS NULL AND asentado_at IS NULL AND via <> 'JUSTIFICA';

-- ── 3. Quiénes aportan ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.cortes_caja_diferencia_personas (
    id              bigserial PRIMARY KEY,
    diferencia_id   bigint      NOT NULL REFERENCES public.cortes_caja_diferencias(id) ON DELETE CASCADE,
    employee_id     uuid        NOT NULL REFERENCES public.employees(id),
    monto           numeric(12,2) NOT NULL CHECK (monto > 0),
    -- Del turno según el registro, o agregada a mano. Se guarda porque es la
    -- diferencia entre «el sistema dice que estaba» y «alguien dijo que estaba».
    del_turno       boolean     NOT NULL DEFAULT false,
    created_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (diferencia_id, employee_id)
);

CREATE INDEX IF NOT EXISTS idx_cortes_dif_personas_empleado
    ON public.cortes_caja_diferencia_personas(employee_id);

-- ── RLS ────────────────────────────────────────────────────────────────────
-- Las tres se escriben SÓLO por RPC SECURITY DEFINER, así que no llevan policy
-- de INSERT/UPDATE/DELETE: sin policy, nadie escribe directo. Es más estricto
-- que un `WITH CHECK` y no deja el hueco de `attendance`/`audit_logs`.
ALTER TABLE public.cortes_caja_eventos              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cortes_caja_diferencias          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cortes_caja_diferencia_personas  ENABLE ROW LEVEL SECURITY;

-- Toda llamada a `auth_*` envuelta en (SELECT ...): sin el initplan, Postgres la
-- evalúa POR FILA. Es la causa del outage del 2026-07-08.
CREATE POLICY bloqueo_global ON public.cortes_caja_eventos
    AS RESTRICTIVE FOR ALL TO authenticated
    USING ((SELECT auth_no_bloqueado()));
CREATE POLICY bloqueo_global ON public.cortes_caja_diferencias
    AS RESTRICTIVE FOR ALL TO authenticated
    USING ((SELECT auth_no_bloqueado()));
CREATE POLICY bloqueo_global ON public.cortes_caja_diferencia_personas
    AS RESTRICTIVE FOR ALL TO authenticated
    USING ((SELECT auth_no_bloqueado()));

-- Se ve lo mismo que se ve del corte: mismo módulo, mismo alcance de sala.
CREATE POLICY cortes_eventos_select ON public.cortes_caja_eventos
    FOR SELECT TO authenticated
    USING (EXISTS (
        SELECT 1 FROM public.cortes_caja c
        WHERE c.id = cortes_caja_eventos.corte_id
          AND (SELECT auth_has_module_permission('cortes_caja', 'can_view'))
          AND ((SELECT auth_module_scope('cortes_caja')) = 'ALL'
               OR c.branch_id = (SELECT auth_employee_branch_id()))));

CREATE POLICY cortes_dif_select ON public.cortes_caja_diferencias
    FOR SELECT TO authenticated
    USING ((SELECT auth_has_module_permission('cortes_caja', 'can_view'))
       AND ((SELECT auth_module_scope('cortes_caja')) = 'ALL'
            OR branch_id = (SELECT auth_employee_branch_id())));

CREATE POLICY cortes_dif_personas_select ON public.cortes_caja_diferencia_personas
    FOR SELECT TO authenticated
    USING (EXISTS (
        SELECT 1 FROM public.cortes_caja_diferencias d
        WHERE d.id = cortes_caja_diferencia_personas.diferencia_id
          AND (SELECT auth_has_module_permission('cortes_caja', 'can_view'))
          AND ((SELECT auth_module_scope('cortes_caja')) = 'ALL'
               OR d.branch_id = (SELECT auth_employee_branch_id()))));

COMMENT ON TABLE public.cortes_caja_eventos IS
    'Bitácora de cada decisión sobre un corte: firmar, reabrir, resolver su diferencia. Append-only.';
COMMENT ON TABLE public.cortes_caja_diferencias IS
    'Cómo se resolvió el faltante o el sobrante de un corte. `monto` va con signo, igual que el tramo.';
COMMENT ON TABLE public.cortes_caja_diferencia_personas IS
    'Quiénes aportan a una reposición y con cuánto cada uno.';
