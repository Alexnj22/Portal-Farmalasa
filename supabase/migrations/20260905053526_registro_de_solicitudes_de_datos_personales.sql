SET lock_timeout = '5s';

-- ═══════════════════════════════════════════════════════════════════════════
-- El registro de solicitudes sobre datos personales.
--
-- Nace de un hueco concreto: el formulario de la sala tiene un espacio
-- «Formulario n.º» y NADIE lo genera ni lo lleva. Sin ese número no hay forma
-- de saber cuántas solicitudes entraron, cuáles vencen esta semana ni cuáles
-- quedaron sin responder, y el Art. 54 de la Ley para la Protección de Datos
-- Personales pone sobre la Empresa la carga de probar que respondió a tiempo.
-- Un cuaderno de hojas sueltas no lo prueba.
--
-- La fila nace AL IMPRIMIR: el portal toma el correlativo, lo estampa en la
-- hoja y en el acuse, y la sala recibe un papel ya numerado. Nadie escribe el
-- número a mano ni puede repetirlo.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── El correlativo ─────────────────────────────────────────────────────────
-- Por AÑO y no por sala: el delegado es uno solo para toda la empresa, así que
-- un correlativo por sala daría siete series que nadie puede ordenar entre sí.
CREATE TABLE IF NOT EXISTS public.solicitudes_datos_folios (
    anio       smallint PRIMARY KEY,
    ultimo     integer  NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.solicitudes_datos_folios ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.solicitudes_datos_folios IS
'Contador del correlativo de solicitudes de datos, por anio. RLS SIN POLICIES a proposito: se toca solo por `solicitud_datos_tomar_folio`, que es SECURITY DEFINER. Expuesta, el contador se podria editar a mano y la serie dejaria de probar nada.';

CREATE TABLE IF NOT EXISTS public.solicitudes_datos (
    id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    anio      smallint NOT NULL,
    folio     integer  NOT NULL,
    -- Lo que se imprime en el papel y lo que la persona lee en su acuse.
    folio_txt text GENERATED ALWAYS AS (anio::text || '-' || lpad(folio::text, 4, '0')) STORED,

    estado text NOT NULL DEFAULT 'IMPRESA'
           CHECK (estado IN ('IMPRESA','RECIBIDA','PREVENIDA','RESUELTA','ANULADA')),

    -- ── Impresión ─────────────────────────────────────────────────────────
    branch_id   bigint REFERENCES public.branches(id),
    impresa_por uuid   REFERENCES public.employees(id),
    impresa_at  timestamptz NOT NULL DEFAULT now(),

    -- ── Recepción ─────────────────────────────────────────────────────────
    -- `recibida_at` es la fecha del acuse, la que HACE CORRER los veinte días
    -- hábiles. Se guarda aparte de `impresa_at` a propósito: una hoja puede
    -- imprimirse hoy y llenarse mañana, y el plazo no cuenta desde la impresora.
    recibida_at  timestamptz,
    recibida_por uuid REFERENCES public.employees(id),

    -- ── Quien solicita (Art. 18 letras a y b) ─────────────────────────────
    solicitante_nombre    text,
    solicitante_documento text,
    solicitante_numero    text,
    solicitante_direccion text,
    solicitante_telefono  text,
    solicitante_correo    text,
    por_representacion    boolean NOT NULL DEFAULT false,
    representacion_doc    text,

    -- ── Qué pide (Art. 18 letras d y e) ───────────────────────────────────
    derechos     text[] NOT NULL DEFAULT '{}'
                 CHECK (derechos <@ ARRAY['acceso','rectificacion','cancelacion',
                                          'oposicion','portabilidad','olvido',
                                          'limitacion','retiro_permiso']),
    descripcion  text,
    via_respuesta text CHECK (via_respuesta IN ('SALA','CORREO','IMPRESA')),

    -- ── Comprobación de identidad (Art. 16 letra c) ───────────────────────
    -- Se guarda QUÉ documento se vio y su número, nunca una copia: el Art. 5
    -- letra d) manda no recoger lo que no hace falta para resolver.
    identidad_documento    text,
    identidad_numero       text,
    identidad_cotejada_por uuid REFERENCES public.employees(id),

    -- ── Prevención (Art. 18) y prórroga (Art. 20) ─────────────────────────
    prevenida_at  timestamptz,
    prevencion    text,
    prorrogada_at timestamptz,

    -- ── Resolución ────────────────────────────────────────────────────────
    resuelta_at     timestamptz,
    resuelta_por    uuid REFERENCES public.employees(id),
    resolucion      text,
    negada          boolean NOT NULL DEFAULT false,
    motivo_negativa text,

    notas      text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    UNIQUE (anio, folio)
);

COMMENT ON TABLE public.solicitudes_datos IS
'Solicitudes ARCO-POL sobre datos personales. La fila nace al IMPRIMIR el formulario, con su correlativo ya estampado en el papel. `recibida_at` es la fecha del acuse y la que hace correr los veinte dias habiles del Art. 20; `impresa_at` no cuenta plazos.';

CREATE INDEX IF NOT EXISTS solicitudes_datos_estado_idx   ON public.solicitudes_datos (estado, recibida_at DESC);
CREATE INDEX IF NOT EXISTS solicitudes_datos_branch_idx   ON public.solicitudes_datos (branch_id);
CREATE INDEX IF NOT EXISTS solicitudes_datos_folio_idx    ON public.solicitudes_datos (anio DESC, folio DESC);

DROP TRIGGER IF EXISTS solicitudes_datos_touch ON public.solicitudes_datos;
CREATE TRIGGER solicitudes_datos_touch
    BEFORE UPDATE ON public.solicitudes_datos
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.solicitudes_datos ENABLE ROW LEVEL SECURITY;

-- ── Quien las ve y quien las escribe ───────────────────────────────────────
-- Sin policy de DELETE: una solicitud no se borra, se ANULA. Lo que se borra
-- no se puede enseñar en una inspeccion, y esa es justo la funcion de la tabla.
DROP POLICY IF EXISTS solicitudes_datos_select ON public.solicitudes_datos;
CREATE POLICY solicitudes_datos_select ON public.solicitudes_datos
    FOR SELECT TO authenticated
    USING ((SELECT public.auth_has_module_permission('datos_personales','can_view')));

DROP POLICY IF EXISTS solicitudes_datos_insert ON public.solicitudes_datos;
CREATE POLICY solicitudes_datos_insert ON public.solicitudes_datos
    FOR INSERT TO authenticated
    WITH CHECK ((SELECT public.auth_has_module_permission('datos_personales','can_edit')));

DROP POLICY IF EXISTS solicitudes_datos_update ON public.solicitudes_datos;
CREATE POLICY solicitudes_datos_update ON public.solicitudes_datos
    FOR UPDATE TO authenticated
    USING ((SELECT public.auth_has_module_permission('datos_personales','can_edit')))
    WITH CHECK ((SELECT public.auth_has_module_permission('datos_personales','can_edit')));

-- ── Tomar el siguiente correlativo ─────────────────────────────────────────
-- DEFINER porque `solicitudes_datos_folios` no se expone a nadie: el numero se
-- pide por aca o no se pide. INVOKER dejaria que el contador se editara a mano.
CREATE OR REPLACE FUNCTION public.solicitud_datos_tomar_folio(p_anio smallint)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE v_folio integer;
BEGIN
    IF NOT (SELECT public.auth_has_module_permission('datos_personales','can_edit')) THEN
        RAISE EXCEPTION 'FORBIDDEN' USING errcode = '42501';
    END IF;

    INSERT INTO public.solicitudes_datos_folios (anio, ultimo)
    VALUES (p_anio, 1)
    ON CONFLICT (anio)
    DO UPDATE SET ultimo = public.solicitudes_datos_folios.ultimo + 1
    RETURNING ultimo INTO v_folio;

    RETURN v_folio;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.solicitud_datos_tomar_folio(smallint) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.solicitud_datos_tomar_folio(smallint) TO authenticated, service_role;

-- ── Crear la solicitud y su folio en un solo paso ──────────────────────────
-- Juntas y no separadas: si el folio se tomara aparte y el INSERT fallara, el
-- numero quedaria quemado y la serie tendria un hueco que nadie puede explicar.
CREATE OR REPLACE FUNCTION public.crear_solicitud_datos(p_branch_id bigint)
RETURNS public.solicitudes_datos
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_anio  smallint := extract(year from (now() AT TIME ZONE 'America/El_Salvador'))::smallint;
    v_folio integer;
    v_fila  public.solicitudes_datos;
BEGIN
    IF NOT (SELECT public.auth_has_module_permission('datos_personales','can_edit')) THEN
        RAISE EXCEPTION 'FORBIDDEN' USING errcode = '42501';
    END IF;

    v_folio := public.solicitud_datos_tomar_folio(v_anio);

    INSERT INTO public.solicitudes_datos (anio, folio, branch_id, impresa_por)
    VALUES (v_anio, v_folio, p_branch_id, public.auth_employee_id())
    RETURNING * INTO v_fila;

    RETURN v_fila;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.crear_solicitud_datos(bigint) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.crear_solicitud_datos(bigint) TO authenticated, service_role;

-- ── El permiso ─────────────────────────────────────────────────────────────
-- Arranca sólo para Gerente General y Administrador. El delegado todavía no
-- está nombrado; el día que se nombre, se le da a su cargo desde Permisos.
INSERT INTO public.role_permissions (role_id, module_key, can_view, can_edit, can_approve, scope)
SELECT r.id, 'datos_personales', true, true, false, 'ALL'
FROM public.roles r
WHERE r.name IN ('Gerente General', 'Administrador')
ON CONFLICT (role_id, module_key) DO NOTHING;
