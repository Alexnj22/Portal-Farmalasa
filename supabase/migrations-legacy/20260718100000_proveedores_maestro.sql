-- Maestro de Proveedores (auto-registro desde DTE) — PLAN-PROVEEDORES-2026-07.md Fase 1.1
-- proveedores_categorias (seed §3) + proveedores_maestro (§4.1) + proveedor_id en
-- purchase_dte_documents. RLS/índices/nombre_norm siguiendo el patrón de
-- 20260717_purchase_dte_email_sync.sql / 20260717023200_search_norm_products_generated_columns.sql
SET lock_timeout = '5s';

-- 1. Categorías contables (seed fijo; agregar una es un INSERT aparte, sin CRUD en v1)
CREATE TABLE public.proveedores_categorias (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    clase text NOT NULL CHECK (clase IN ('costo', 'gasto_operativo', 'gasto_admin', 'otro')),
    nombre text NOT NULL UNIQUE,
    created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.proveedores_categorias ENABLE ROW LEVEL SECURITY;

CREATE POLICY proveedores_categorias_select ON public.proveedores_categorias
    FOR SELECT TO authenticated
    USING ((SELECT auth_has_module_permission('proveedores', 'can_view')));

INSERT INTO public.proveedores_categorias (clase, nombre) VALUES
    ('costo', 'Mercadería para reventa'),
    ('gasto_operativo', 'Energía eléctrica'),
    ('gasto_operativo', 'Agua'),
    ('gasto_operativo', 'Telecomunicaciones'),
    ('gasto_operativo', 'Alquileres'),
    ('gasto_operativo', 'Mantenimiento y reparaciones'),
    ('gasto_operativo', 'Limpieza'),
    ('gasto_operativo', 'Combustible y transporte'),
    ('gasto_operativo', 'Vigilancia/seguridad'),
    ('gasto_admin', 'Servicios profesionales y honorarios'),
    ('gasto_admin', 'Servicios financieros/bancarios'),
    ('gasto_admin', 'Seguros'),
    ('gasto_admin', 'Papelería y útiles'),
    ('gasto_admin', 'Publicidad'),
    ('gasto_admin', 'Impuestos y tasas municipales'),
    ('otro', 'Otros');

-- 2. Maestro de proveedores
CREATE TABLE public.proveedores_maestro (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    -- Identidad fiscal (del DTE, no editable a mano salvo excepción)
    nit text UNIQUE,
    dui text,
    nrc text,
    nombre text NOT NULL,
    nombre_comercial text,
    cod_actividad text,
    desc_actividad text,
    tipo_establecimiento text,
    departamento text,
    municipio text,
    direccion text,
    telefono text,
    correo text,
    -- Flags fiscales observados de los DTE (auto)
    percibe_1 boolean NOT NULL DEFAULT false,
    retiene_renta boolean NOT NULL DEFAULT false,
    -- Curación manual
    categoria_id bigint REFERENCES public.proveedores_categorias(id),
    supplier_id integer REFERENCES public.suppliers(id),
    contacto_nombre text,
    telefono2 text,
    nombre_cheques text,
    notas text,
    activo boolean NOT NULL DEFAULT true,
    pais text NOT NULL DEFAULT 'SV',
    -- Trazabilidad
    source text NOT NULL DEFAULT 'dte' CHECK (source IN ('dte', 'manual')),
    primera_vez_visto date,
    ultima_vez_visto date,
    docs_count integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (nit IS NOT NULL OR dui IS NOT NULL)
);

-- Dedupe de FSE sin NIT (§7 riesgos)
CREATE UNIQUE INDEX idx_proveedores_maestro_dui_sin_nit ON public.proveedores_maestro (dui) WHERE nit IS NULL;

CREATE INDEX idx_proveedores_maestro_nrc ON public.proveedores_maestro (nrc);
CREATE INDEX idx_proveedores_maestro_categoria ON public.proveedores_maestro (categoria_id);
CREATE INDEX idx_proveedores_maestro_supplier ON public.proveedores_maestro (supplier_id);

ALTER TABLE public.proveedores_maestro
  ADD COLUMN nombre_norm text GENERATED ALWAYS AS (public.norm_search(nombre)) STORED;
CREATE INDEX idx_proveedores_maestro_nombre_norm ON public.proveedores_maestro (nombre_norm);

ALTER TABLE public.proveedores_maestro ENABLE ROW LEVEL SECURITY;

CREATE POLICY proveedores_maestro_select ON public.proveedores_maestro
    FOR SELECT TO authenticated
    USING ((SELECT auth_has_module_permission('proveedores', 'can_view')));

-- 3. purchase_dte_documents: nueva columna proveedor_id (maestro), convive con supplier_id (ERP)
ALTER TABLE public.purchase_dte_documents
  ADD COLUMN proveedor_id bigint REFERENCES public.proveedores_maestro(id);
CREATE INDEX idx_purchase_dte_docs_proveedor ON public.purchase_dte_documents (proveedor_id);
