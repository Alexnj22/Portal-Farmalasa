SET lock_timeout = '5s';

CREATE TABLE public.medicos (
    id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    numero_junta  text NOT NULL,
    junta         text NOT NULL DEFAULT 'P01'
                  CHECK (junta IN ('P01','P02','P03','P04','P05','P06','P07')),
    nombre        text NOT NULL,
    carrera       text,
    origen        text NOT NULL DEFAULT 'manual' CHECK (origen IN ('cssp','manual')),
    verificado_at timestamptz,
    agregado_por  uuid REFERENCES public.employees(id) ON DELETE SET NULL,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT medicos_unico UNIQUE (junta, numero_junta),
    CONSTRAINT medicos_numero CHECK (btrim(numero_junta) <> ''),
    CONSTRAINT medicos_nombre CHECK (btrim(nombre) <> '')
);
CREATE INDEX medicos_nombre_idx ON public.medicos USING gin (nombre gin_trgm_ops);
CREATE INDEX medicos_agregado_por_idx ON public.medicos (agregado_por);
CREATE TRIGGER medicos_updated_at BEFORE UPDATE ON public.medicos
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.medicos IS
    'Catalogo propio de prescriptores. Se consulta al CSSP solo cuando el numero no esta aca, y si no aparece se agrega a mano. Nunca traba el registro: el dato que la norma exige vive en la receta que se retiene.';

CREATE TABLE public.recetas (
    id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    branch_id     bigint   NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
    anio          smallint NOT NULL,
    correlativo   integer  NOT NULL,
    paciente_nombre    text,
    paciente_edad      smallint CHECK (paciente_edad IS NULL OR paciente_edad BETWEEN 0 AND 130),
    paciente_documento text,
    medico_id     bigint REFERENCES public.medicos(id) ON DELETE RESTRICT,
    fecha_prescripcion date,
    foto_url      text,
    estado        text NOT NULL DEFAULT 'abierta'
                  CHECK (estado IN ('abierta','cerrada','anulada')),
    motivo_pendiente text
                  CHECK (motivo_pendiente IS NULL OR motivo_pendiente IN ('agotamiento_inventario','decision_paciente','otro')),
    notas         text,
    creada_por    uuid NOT NULL REFERENCES public.employees(id) ON DELETE RESTRICT,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT recetas_correlativo_unico UNIQUE (branch_id, anio, correlativo)
);
CREATE INDEX recetas_branch_estado_idx ON public.recetas (branch_id, estado);
CREATE INDEX recetas_medico_idx ON public.recetas (medico_id);
CREATE INDEX recetas_creada_por_idx ON public.recetas (creada_por);
CREATE TRIGGER recetas_updated_at BEFORE UPDATE ON public.recetas
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMENT ON COLUMN public.recetas.correlativo IS
    'Consecutivo por sucursal y anio. Lo exige el item 3.21 de la guia de la SRS para la receta retenida.';

CREATE TABLE public.receta_items (
    id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    receta_id     bigint NOT NULL REFERENCES public.recetas(id) ON DELETE CASCADE,
    erp_product_id integer REFERENCES public.products(id) ON DELETE SET NULL,
    descripcion   text NOT NULL,
    cantidad_prescrita numeric(10,3) NOT NULL CHECK (cantidad_prescrita > 0),
    forma_farmaceutica text,
    created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX receta_items_receta_idx ON public.receta_items (receta_id);
CREATE INDEX receta_items_producto_idx ON public.receta_items (erp_product_id);

CREATE TABLE public.bitacora_folios (
    branch_id bigint   NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
    anio      smallint NOT NULL,
    serie     text     NOT NULL,
    ultimo    integer  NOT NULL DEFAULT 0,
    PRIMARY KEY (branch_id, anio, serie)
);
COMMENT ON TABLE public.bitacora_folios IS
    'Contador de folios por sucursal, anio y serie. El folio se toma DENTRO de la transaccion que inserta el renglon: si esa transaccion falla, el folio vuelve, y el libro no queda con huecos.';

CREATE TABLE public.bitacora_dispensaciones (
    id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    branch_id     bigint   NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
    anio          smallint NOT NULL,
    folio         integer  NOT NULL,
    folio_txt     text GENERATED ALWAYS AS (anio::text || '-' || lpad(folio::text, 5, '0')) STORED,

    sales_invoice_item_id bigint NOT NULL REFERENCES public.sales_invoice_items(id) ON DELETE RESTRICT,
    invoice_id    bigint NOT NULL REFERENCES public.sales_invoices(id) ON DELETE RESTRICT,

    fecha         date NOT NULL,
    hora          time,

    erp_product_id  integer REFERENCES public.products(id) ON DELETE SET NULL,
    producto_nombre text NOT NULL,
    laboratorio     text,
    presentacion    text,
    cantidad        numeric(10,3) NOT NULL,
    lote            text,
    fecha_vencimiento date,

    codigo_generacion uuid,
    correlativo_doc   text,
    tipo_documento    text,
    documento_estado  text,

    cliente_texto   text,
    customer_id     bigint REFERENCES public.customers(id) ON DELETE SET NULL,
    cod_vendedor    text,
    vendedor_nombre text,

    receta_item_id  bigint REFERENCES public.receta_items(id) ON DELETE SET NULL,
    estado          text NOT NULL DEFAULT 'pendiente'
                    CHECK (estado IN ('pendiente','completa','anulada','sin_receta')),
    completada_por  uuid REFERENCES public.employees(id) ON DELETE SET NULL,
    completada_at   timestamptz,
    notas           text,

    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT bitacora_disp_folio_unico UNIQUE (branch_id, anio, folio),
    CONSTRAINT bitacora_disp_una_por_linea UNIQUE (sales_invoice_item_id),
    CONSTRAINT bitacora_disp_completa_con_receta CHECK (
        estado <> 'completa' OR receta_item_id IS NOT NULL
    )
);
CREATE INDEX bitacora_disp_branch_fecha_idx ON public.bitacora_dispensaciones (branch_id, fecha DESC);
CREATE INDEX bitacora_disp_estado_idx ON public.bitacora_dispensaciones (branch_id, estado) WHERE estado = 'pendiente';
CREATE INDEX bitacora_disp_folio_txt_idx ON public.bitacora_dispensaciones (folio_txt);
CREATE INDEX bitacora_disp_receta_item_idx ON public.bitacora_dispensaciones (receta_item_id);
CREATE INDEX bitacora_disp_invoice_idx ON public.bitacora_dispensaciones (invoice_id);
CREATE INDEX bitacora_disp_customer_idx ON public.bitacora_dispensaciones (customer_id);
CREATE INDEX bitacora_disp_producto_idx ON public.bitacora_dispensaciones (erp_product_id);
CREATE INDEX bitacora_disp_completada_por_idx ON public.bitacora_dispensaciones (completada_por);
CREATE TRIGGER bitacora_disp_updated_at BEFORE UPDATE ON public.bitacora_dispensaciones
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.bitacora_dispensaciones IS
    'El renglon foliado del libro de dispensacion bajo receta. Los datos del producto y del documento se COPIAN aca a proposito: un libro legal debe decir lo que se entrego ese dia aunque despues cambie el catalogo. Es el adjetivo ORIGINAL del RTS 6.1.14.';

COMMENT ON COLUMN public.bitacora_dispensaciones.folio_txt IS
    'El folio como se busca y se imprime: 2026-00007.';

ALTER TABLE public.medicos                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recetas                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.receta_items             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bitacora_folios          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bitacora_dispensaciones  ENABLE ROW LEVEL SECURITY;

CREATE POLICY bloqueo_global ON public.medicos                 AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT public.auth_no_bloqueado()));
CREATE POLICY bloqueo_global ON public.recetas                 AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT public.auth_no_bloqueado()));
CREATE POLICY bloqueo_global ON public.receta_items            AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT public.auth_no_bloqueado()));
CREATE POLICY bloqueo_global ON public.bitacora_folios         AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT public.auth_no_bloqueado()));
CREATE POLICY bloqueo_global ON public.bitacora_dispensaciones AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT public.auth_no_bloqueado()));

CREATE POLICY medicos_select ON public.medicos
    FOR SELECT TO authenticated
    USING ((SELECT public.auth_has_module_permission('bitacoras', 'can_view')));

CREATE POLICY recetas_select ON public.recetas
    FOR SELECT TO authenticated
    USING (
        (SELECT public.auth_has_module_permission('bitacoras', 'can_view'))
        AND ((SELECT public.auth_module_scope('bitacoras')) = 'ALL'
             OR branch_id = (SELECT public.auth_employee_branch_id()))
    );

CREATE POLICY receta_items_select ON public.receta_items
    FOR SELECT TO authenticated
    USING (
        (SELECT public.auth_has_module_permission('bitacoras', 'can_view'))
        AND ((SELECT public.auth_module_scope('bitacoras')) = 'ALL'
             OR EXISTS (SELECT 1 FROM public.recetas r
                         WHERE r.id = receta_id
                           AND r.branch_id = (SELECT public.auth_employee_branch_id())))
    );

CREATE POLICY bitacora_disp_select ON public.bitacora_dispensaciones
    FOR SELECT TO authenticated
    USING (
        (SELECT public.auth_has_module_permission('bitacoras', 'can_view'))
        AND ((SELECT public.auth_module_scope('bitacoras')) = 'ALL'
             OR branch_id = (SELECT public.auth_employee_branch_id()))
    );
