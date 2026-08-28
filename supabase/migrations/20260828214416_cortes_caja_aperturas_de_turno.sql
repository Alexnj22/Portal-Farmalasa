-- El turno de caja de cada sala — F3 de docs/PLAN-CAJA-EN-EL-PORTAL-2026-08-28.md
--
-- Hoy el portal no sabe quién tiene la caja abierta, y el sistema de la caja
-- tampoco sabe siempre quién es: medido el 28-ago, TRES de las seis salas
-- cortan bajo una cuenta compartida —«MI CAJA LA POPULAR», «MI CAJA LA SALUD 2»,
-- «MI CAJA LA SALUD 5»—, o sea 185 de los 452 cortes desde el 14-ago. Y en los
-- 452, sin excepción, `cortes_caja.employee_id` está en NULL.
--
-- Esta tabla es lo que hace posible contestar «¿quién abrió la caja, a qué hora,
-- y había marcado entrada?» sin escribir una sola línea del otro lado.
--
-- ── Los nombres dicen lo que se OBSERVÓ, no lo que pasó ─────────────────────
-- `vista_at` es la última vez que la captura la encontró abierta y
-- `cerrada_at` es cuándo se la vio cerrada — NO cuándo la cerraron. La
-- diferencia importa: con una corrida cada media hora, un turno cerrado a las
-- 19:03 se ve cerrado a las 19:30, y un campo llamado `cerrada_at` a secas
-- invitaría a restar horas de turno con media hora inventada. La hora real de
-- APERTURA sí es exacta: la trae el propio sistema en el panel.
--
-- `empleado_texto` guarda lo que dice el sistema aunque sea una cuenta
-- compartida, y `employee_id` la ficha sólo cuando se pudo resolver. Son dos
-- columnas y no una a propósito: «no se pudo resolver» y «lo abrió una cuenta
-- que no es una persona» son hallazgos distintos y los dos hay que poder verlos.

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.cortes_caja_aperturas (
    id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    branch_id        integer NOT NULL REFERENCES public.branches(id),
    erp_apertura_id  integer NOT NULL,
    caja_erp         integer,
    turno            smallint,
    -- Lo que dice el sistema de la caja, tal cual.
    empleado_texto   text,
    -- La ficha del portal, cuando el nombre se pudo resolver a una persona.
    employee_id      uuid REFERENCES public.employees(id),
    abierta_el       date NOT NULL,
    abierta_a        time,
    monto_apertura   numeric(12,2),
    -- Lo que el sistema esperaba en la caja la última vez que se miró.
    monto_registrado numeric(12,2),
    vista_at         timestamptz NOT NULL DEFAULT now(),
    cerrada_at       timestamptz,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT cortes_caja_apertura_unica UNIQUE (branch_id, erp_apertura_id)
);

CREATE INDEX IF NOT EXISTS cortes_caja_aper_branch_idx
    ON public.cortes_caja_aperturas (branch_id, abierta_el DESC);
-- Para «¿cuáles siguen abiertas?», que es la pregunta de cada mañana.
CREATE INDEX IF NOT EXISTS cortes_caja_aper_abiertas_idx
    ON public.cortes_caja_aperturas (branch_id) WHERE cerrada_at IS NULL;
CREATE INDEX IF NOT EXISTS cortes_caja_aper_empleado_idx
    ON public.cortes_caja_aperturas (employee_id);

COMMENT ON COLUMN public.cortes_caja_aperturas.vista_at IS
    'Última vez que la captura la encontró abierta.';
COMMENT ON COLUMN public.cortes_caja_aperturas.cerrada_at IS
    'Cuándo se la VIO cerrada, no cuándo la cerraron: la captura no corre continuamente.';
COMMENT ON COLUMN public.cortes_caja_aperturas.empleado_texto IS
    'El nombre tal como lo da el sistema de la caja. En tres salas es una cuenta compartida, no una persona.';

ALTER TABLE public.cortes_caja_aperturas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bloqueo_global ON public.cortes_caja_aperturas;
CREATE POLICY bloqueo_global ON public.cortes_caja_aperturas
    AS RESTRICTIVE FOR ALL TO public USING ((SELECT auth_no_bloqueado()));

-- Mismo alcance que los cortes: la sala ve el suyo, supervisión ve todo.
DROP POLICY IF EXISTS cortes_caja_aper_select ON public.cortes_caja_aperturas;
CREATE POLICY cortes_caja_aper_select ON public.cortes_caja_aperturas
    FOR SELECT TO authenticated
    USING (
        (SELECT auth_has_module_permission('cortes_caja','can_view'))
        AND ((SELECT auth_module_scope('cortes_caja')) = 'ALL'
             OR branch_id = (SELECT auth_employee_branch_id()))
    );

-- Sin policy de escritura: la única que escribe es la captura con service_role.
REVOKE ALL ON public.cortes_caja_aperturas FROM anon;
GRANT SELECT ON public.cortes_caja_aperturas TO authenticated;
GRANT ALL    ON public.cortes_caja_aperturas TO service_role;

COMMENT ON TABLE public.cortes_caja_aperturas IS
    'El turno de caja de cada sala, leído del sistema de origen. Contesta quién abrió, a qué hora y si sigue abierta — que hoy no se puede saber desde ningún lado.';
