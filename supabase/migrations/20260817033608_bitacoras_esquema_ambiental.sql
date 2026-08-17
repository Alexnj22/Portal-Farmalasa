SET lock_timeout = '5s';

CREATE TABLE public.bitacora_areas (
    id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    branch_id     bigint  NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
    tipo          text    NOT NULL CHECK (tipo IN ('sala_ventas', 'bodega', 'refrigerador')),
    nombre        text    NOT NULL,
    activa        boolean NOT NULL DEFAULT true,
    franjas       jsonb   NOT NULL DEFAULT '[]'::jsonb,
    limpiezas     jsonb   NOT NULL DEFAULT '[]'::jsonb,
    dias_semana   smallint[] NOT NULL DEFAULT '{1,2,3,4,5,6,7}',
    vigente_desde date NOT NULL DEFAULT (now() AT TIME ZONE 'America/El_Salvador')::date,
    temp_min      numeric(5,2),
    temp_max      numeric(5,2),
    hr_min        numeric(5,2),
    hr_max        numeric(5,2),
    mide_humedad  boolean NOT NULL DEFAULT true,
    instrumento     text,
    calibrado_hasta date,
    notas         text,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT bitacora_areas_unicas UNIQUE (branch_id, tipo, nombre),
    CONSTRAINT bitacora_areas_con_franjas CHECK (
        NOT activa OR jsonb_array_length(franjas) > 0
    )
);

CREATE INDEX bitacora_areas_branch_idx ON public.bitacora_areas (branch_id) WHERE activa;

CREATE TRIGGER bitacora_areas_updated_at
    BEFORE UPDATE ON public.bitacora_areas
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.bitacora_areas IS
    'Configuracion por sucursal de las bitacoras ambientales: que areas hay, en que franjas se lee, que rangos aplican y hasta cuando esta calibrado el instrumento. Ver docs/PLAN-BITACORAS-SRS-2026-08-16.md seccion 3.1.';

COMMENT ON COLUMN public.bitacora_areas.vigente_desde IS
    'Desde que dia esta area lleva bitacora. Es un DATO, no created_at: permite configurar un area hoy para que empiece a contar el mes que viene, y evita el desfase UTC/El Salvador que hacia que el resumen del mes informara cero.';

COMMENT ON COLUMN public.bitacora_areas.dias_semana IS
    'ISO 1=lunes..7=domingo. Sin esto una sala cerrada el domingo muestra huecos fantasma, y esos huecos harian que el cierre del mes informe un numero falso.';

CREATE TABLE public.bitacora_lecturas (
    id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    area_id        bigint NOT NULL REFERENCES public.bitacora_areas(id) ON DELETE RESTRICT,
    fecha          date   NOT NULL,
    franja         text   NOT NULL,
    temperatura    numeric(5,2) NOT NULL,
    humedad        numeric(5,2),
    fuera_de_rango boolean NOT NULL DEFAULT false,
    accion_correctiva text,
    registrado_por uuid NOT NULL REFERENCES public.employees(id) ON DELETE RESTRICT,
    registrado_at  timestamptz NOT NULL DEFAULT now(),
    tarde          boolean NOT NULL DEFAULT false,
    created_at     timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT bitacora_lecturas_una_por_franja UNIQUE (area_id, fecha, franja),
    CONSTRAINT bitacora_lecturas_desvio_con_accion CHECK (
        NOT fuera_de_rango OR coalesce(btrim(accion_correctiva), '') <> ''
    )
);

CREATE INDEX bitacora_lecturas_area_fecha_idx ON public.bitacora_lecturas (area_id, fecha DESC);
CREATE INDEX bitacora_lecturas_registrado_por_idx ON public.bitacora_lecturas (registrado_por);
CREATE INDEX bitacora_lecturas_desvios_idx ON public.bitacora_lecturas (fecha DESC) WHERE fuera_de_rango;

COMMENT ON COLUMN public.bitacora_lecturas.registrado_at IS
    'Hora REAL de captura, distinta de la franja. RTS 6.1.14 exige que el registro sea contemporaneo; sin esta columna no hay forma de verificarlo.';

CREATE TABLE public.bitacora_correcciones (
    id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    lectura_id    bigint NOT NULL REFERENCES public.bitacora_lecturas(id) ON DELETE RESTRICT,
    temperatura_antes numeric(5,2),
    humedad_antes     numeric(5,2),
    accion_antes      text,
    temperatura_despues numeric(5,2),
    humedad_despues     numeric(5,2),
    accion_despues      text,
    motivo        text NOT NULL,
    corregido_por uuid NOT NULL REFERENCES public.employees(id) ON DELETE RESTRICT,
    created_at    timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT bitacora_correcciones_motivo CHECK (btrim(motivo) <> '')
);

CREATE INDEX bitacora_correcciones_lectura_idx ON public.bitacora_correcciones (lectura_id);
CREATE INDEX bitacora_correcciones_por_idx ON public.bitacora_correcciones (corregido_por);

CREATE TABLE public.bitacora_limpiezas (
    id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    area_id        bigint NOT NULL REFERENCES public.bitacora_areas(id) ON DELETE RESTRICT,
    fecha          date   NOT NULL,
    turno          text   NOT NULL,
    observaciones  text,
    realizada_por  uuid NOT NULL REFERENCES public.employees(id) ON DELETE RESTRICT,
    registrado_at  timestamptz NOT NULL DEFAULT now(),
    tarde          boolean NOT NULL DEFAULT false,
    created_at     timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT bitacora_limpiezas_una_por_turno UNIQUE (area_id, fecha, turno)
);

CREATE INDEX bitacora_limpiezas_area_fecha_idx ON public.bitacora_limpiezas (area_id, fecha DESC);
CREATE INDEX bitacora_limpiezas_por_idx ON public.bitacora_limpiezas (realizada_por);

CREATE TABLE public.bitacora_cierres (
    id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    branch_id  bigint NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
    periodo    text   NOT NULL CHECK (periodo ~ '^\d{4}-(0[1-9]|1[0-2])$'),
    accion     text   NOT NULL CHECK (accion IN ('cerrar', 'reabrir')),
    resumen    jsonb,
    motivo     text,
    actor_id   uuid NOT NULL REFERENCES public.employees(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT bitacora_cierres_reabrir_con_motivo CHECK (
        accion <> 'reabrir' OR coalesce(btrim(motivo), '') <> ''
    ),
    CONSTRAINT bitacora_cierres_cerrar_con_resumen CHECK (
        accion <> 'cerrar' OR resumen IS NOT NULL
    )
);

CREATE INDEX bitacora_cierres_periodo_idx ON public.bitacora_cierres (branch_id, periodo, created_at DESC);
CREATE INDEX bitacora_cierres_actor_idx ON public.bitacora_cierres (actor_id);

COMMENT ON TABLE public.bitacora_cierres IS
    'Append-only: una fila por cierre o reapertura. El estado de un periodo es el ultimo evento. Ver docs/PLAN-BITACORAS-SRS-2026-08-16.md seccion 7.';

ALTER TABLE public.bitacora_areas         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bitacora_lecturas      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bitacora_correcciones  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bitacora_limpiezas     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bitacora_cierres       ENABLE ROW LEVEL SECURITY;

CREATE POLICY bloqueo_global ON public.bitacora_areas        AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT public.auth_no_bloqueado()));
CREATE POLICY bloqueo_global ON public.bitacora_lecturas     AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT public.auth_no_bloqueado()));
CREATE POLICY bloqueo_global ON public.bitacora_correcciones AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT public.auth_no_bloqueado()));
CREATE POLICY bloqueo_global ON public.bitacora_limpiezas    AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT public.auth_no_bloqueado()));
CREATE POLICY bloqueo_global ON public.bitacora_cierres      AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT public.auth_no_bloqueado()));

CREATE POLICY bitacora_areas_select ON public.bitacora_areas
    FOR SELECT TO authenticated
    USING (
        (SELECT public.auth_has_module_permission('bitacoras', 'can_view'))
        AND ((SELECT public.auth_module_scope('bitacoras')) = 'ALL'
             OR branch_id = (SELECT public.auth_employee_branch_id()))
    );

CREATE POLICY bitacora_areas_insert ON public.bitacora_areas
    FOR INSERT TO authenticated
    WITH CHECK ((SELECT public.auth_has_module_permission('bitacoras_configurar', 'can_edit')));

CREATE POLICY bitacora_areas_update ON public.bitacora_areas
    FOR UPDATE TO authenticated
    USING ((SELECT public.auth_has_module_permission('bitacoras_configurar', 'can_edit')))
    WITH CHECK ((SELECT public.auth_has_module_permission('bitacoras_configurar', 'can_edit')));

CREATE POLICY bitacora_lecturas_select ON public.bitacora_lecturas
    FOR SELECT TO authenticated
    USING (
        (SELECT public.auth_has_module_permission('bitacoras', 'can_view'))
        AND ((SELECT public.auth_module_scope('bitacoras')) = 'ALL'
             OR EXISTS (SELECT 1 FROM public.bitacora_areas a
                         WHERE a.id = area_id
                           AND a.branch_id = (SELECT public.auth_employee_branch_id())))
    );

CREATE POLICY bitacora_limpiezas_select ON public.bitacora_limpiezas
    FOR SELECT TO authenticated
    USING (
        (SELECT public.auth_has_module_permission('bitacoras', 'can_view'))
        AND ((SELECT public.auth_module_scope('bitacoras')) = 'ALL'
             OR EXISTS (SELECT 1 FROM public.bitacora_areas a
                         WHERE a.id = area_id
                           AND a.branch_id = (SELECT public.auth_employee_branch_id())))
    );

CREATE POLICY bitacora_correcciones_select ON public.bitacora_correcciones
    FOR SELECT TO authenticated
    USING (
        (SELECT public.auth_has_module_permission('bitacoras', 'can_view'))
        AND ((SELECT public.auth_module_scope('bitacoras')) = 'ALL'
             OR EXISTS (SELECT 1 FROM public.bitacora_lecturas l
                        JOIN public.bitacora_areas a ON a.id = l.area_id
                         WHERE l.id = lectura_id
                           AND a.branch_id = (SELECT public.auth_employee_branch_id())))
    );

CREATE POLICY bitacora_cierres_select ON public.bitacora_cierres
    FOR SELECT TO authenticated
    USING (
        (SELECT public.auth_has_module_permission('bitacoras', 'can_view'))
        AND ((SELECT public.auth_module_scope('bitacoras')) = 'ALL'
             OR branch_id = (SELECT public.auth_employee_branch_id()))
    );
