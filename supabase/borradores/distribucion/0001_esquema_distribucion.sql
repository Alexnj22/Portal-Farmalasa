-- ════════════════════════════════════════════════════════════════════════════
-- Venta en ruta de la S.A.S. de distribución — esquema base
-- ════════════════════════════════════════════════════════════════════════════
--
-- Prefijo `dist_` y módulo `distribucion`, NO `ruta_`: en el portal «ruta» ya
-- es el reparto de Bodega a las salas (`rutas`, `ruta_pedidos`,
-- `ruta_locations`). Mismo nombre para dos cosas es la forma de que un permiso
-- o una migración toque la equivocada.
--
-- BORRADOR: vive en `supabase/borradores/` y NO en `supabase/migrations/`
-- porque todavía no se aplicó a producción. Se prueba en el branch de pruebas
-- con `execute_sql` (nunca `apply_migration`: ver CLAUDE.md). El día que pase a
-- producción se aplica con `apply_migration` y se archiva con la versión de 14
-- dígitos que devuelva el servidor.
--
-- Tablas nuevas, ninguna caliente: no toca `sales_invoices`, `inventory` ni
-- `products` (sólo las referencia), así que no pide lock sobre ellas salvo el
-- SHARE ROW EXCLUSIVE breve de una FK hacia `products`/`employees`.
--
-- ── Quién escribe qué ──────────────────────────────────────────────────────
-- · Clientes, catálogo y pedidos: la pantalla, con el permiso `distribucion`.
-- · DTE, correlativos y token de Hacienda: SÓLO el servidor (service_role, en
--   la edge function `distribucion-dte`). Un DTE es un documento fiscal: si el
--   navegador pudiera insertarlo, podría inventar un sello.
-- · Lo que se le puede vender a cada cliente lo decide un TRIGGER, no la
--   pantalla: una tienda sólo recibe lo marcado como venta libre y nunca un
--   antibiótico ni un producto regulado (Ley de Medicamentos art. 57 b; listado
--   de venta sin receta de la SRS).

SET lock_timeout = '5s';

-- ── Emisor: la S.A.S. ───────────────────────────────────────────────────────
CREATE TABLE public.dist_emisores (
    id                  smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nombre              text NOT NULL,
    nombre_comercial    text,
    nit                 text NOT NULL UNIQUE CHECK (nit ~ '^[0-9]{9}$|^[0-9]{14}$'),
    nrc                 text NOT NULL CHECK (nrc ~ '^[0-9]{2,8}$'),
    cod_actividad       text NOT NULL CHECK (cod_actividad ~ '^[0-9]{5,6}$'),
    desc_actividad      text NOT NULL,
    departamento        text NOT NULL,
    municipio           text NOT NULL,
    distrito            text NOT NULL,
    complemento         text NOT NULL,
    telefono            text NOT NULL,
    correo              text NOT NULL,
    -- Número de control: letra + 3 dígitos / P + 3 dígitos (Manual §XI).
    establecimiento     text NOT NULL DEFAULT 'B001' CHECK (establecimiento ~ '^[MBSP][0-9]{3}$'),
    punto_venta         text NOT NULL DEFAULT 'P001' CHECK (punto_venta ~ '^P[0-9]{3}$'),
    -- CAT-009 (01 sucursal, 02 matriz, 04 bodega, 07 patio) — lo pide el evento de contingencia.
    tipo_establecimiento text NOT NULL DEFAULT '04' CHECK (tipo_establecimiento IN ('01','02','04','07')),
    -- Los que asigna Hacienda al registrar el establecimiento (4 caracteres).
    cod_estable_mh      text CHECK (cod_estable_mh IS NULL OR length(cod_estable_mh) = 4),
    cod_punto_venta_mh  text CHECK (cod_punto_venta_mh IS NULL OR length(cod_punto_venta_mh) = 4),
    -- 00 pruebas / 01 producción. Cambiarlo es una decisión, no un detalle.
    ambiente            text NOT NULL DEFAULT '00' CHECK (ambiente IN ('00','01')),
    -- Si Hacienda nos califica gran contribuyente, PERCIBIMOS el 1% (Art. 163).
    gran_contribuyente  boolean NOT NULL DEFAULT false,
    activo              boolean NOT NULL DEFAULT true,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.dist_emisores IS
  'La S.A.S. que emite los DTE de la venta en ruta. Las credenciales de Hacienda NO viven acá: son secretos de la edge function distribucion-dte.';

-- ── Clientes de ruta ────────────────────────────────────────────────────────
CREATE TABLE public.dist_clientes (
    id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    emisor_id           smallint NOT NULL REFERENCES public.dist_emisores(id),
    tipo                text NOT NULL CHECK (tipo IN ('tienda','supermercado','farmacia','otro')),
    nombre              text NOT NULL CHECK (btrim(nombre) <> ''),
    nombre_comercial    text,
    tipo_documento      text CHECK (tipo_documento IN ('36','13','37','03','02')),  -- CAT-022
    num_documento       text,
    nrc                 text CHECK (nrc IS NULL OR nrc ~ '^[0-9]{2,8}$'),
    cod_actividad       text CHECK (cod_actividad IS NULL OR cod_actividad ~ '^[0-9]{5,6}$'),
    desc_actividad      text,
    -- Contribuyente de IVA = tiene NRC → se le emite Crédito Fiscal; si no, Factura.
    contribuyente       boolean GENERATED ALWAYS AS (nrc IS NOT NULL) STORED,
    -- Gran contribuyente: nos RETIENE el 1% en compras de $100 o más (Art. 162).
    gran_contribuyente  boolean NOT NULL DEFAULT false,
    departamento        text,
    municipio           text,
    distrito            text,
    complemento         text,
    telefono            text,
    correo              text,
    -- Autorización del establecimiento ante la SRS. Sin ella no se le vende
    -- medicamento (RTS 11.02.04:24 §5.9.2; Ley de Medicamentos art. 57 b).
    licencia_srs        text,
    licencia_srs_vence  date,
    limite_credito      numeric(12,2) NOT NULL DEFAULT 0 CHECK (limite_credito >= 0),
    plazo_dias          smallint NOT NULL DEFAULT 0 CHECK (plazo_dias BETWEEN 0 AND 120),
    ruta                text,
    lat                 double precision,
    lng                 double precision,
    notas               text,
    activo              boolean NOT NULL DEFAULT true,
    creado_por          uuid   DEFAULT public.auth_employee_id() REFERENCES public.employees(id),
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    -- Un contribuyente sin NIT ni actividad no puede recibir un CCF: se exige al guardar,
    -- no se descubre al facturar.
    CONSTRAINT dist_clientes_ccf_completo CHECK (
        nrc IS NULL OR (tipo_documento = '36' AND num_documento IS NOT NULL
                        AND cod_actividad IS NOT NULL AND desc_actividad IS NOT NULL
                        AND departamento IS NOT NULL AND municipio IS NOT NULL
                        AND distrito IS NOT NULL AND complemento IS NOT NULL)),
    CONSTRAINT dist_clientes_doc_par CHECK ((tipo_documento IS NULL) = (num_documento IS NULL))
);
CREATE UNIQUE INDEX dist_clientes_documento_unico
    ON public.dist_clientes (emisor_id, tipo_documento, num_documento) WHERE num_documento IS NOT NULL;
CREATE INDEX dist_clientes_emisor ON public.dist_clientes (emisor_id);
CREATE INDEX dist_clientes_creado_por ON public.dist_clientes (creado_por);

-- ── Catálogo de ruta: precio y a quién se le puede vender ───────────────────
CREATE TABLE public.dist_catalogo (
    emisor_id       smallint NOT NULL REFERENCES public.dist_emisores(id),
    product_id      integer  NOT NULL REFERENCES public.products(id),
    precio_sin_iva  numeric(14,6) NOT NULL CHECK (precio_sin_iva >= 0),
    -- En el listado de venta sin receta de la SRS (acuerdo SI.2026.02.06-01):
    -- lo único que puede ir a una tienda o un supermercado.
    venta_libre     boolean NOT NULL DEFAULT false,
    activo          boolean NOT NULL DEFAULT true,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (emisor_id, product_id)
);
CREATE INDEX dist_catalogo_producto ON public.dist_catalogo (product_id);

-- ── DTE emitidos por la S.A.S. ──────────────────────────────────────────────
CREATE TABLE public.dist_dte (
    id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    emisor_id           smallint NOT NULL REFERENCES public.dist_emisores(id),
    ambiente            text NOT NULL CHECK (ambiente IN ('00','01')),
    tipo                text NOT NULL CHECK (tipo IN ('01','03','04','05','06')),
    codigo_generacion   uuid NOT NULL UNIQUE,
    numero_control      text NOT NULL CHECK (length(numero_control) = 31),
    fec_emi             date NOT NULL,
    hor_emi             time NOT NULL,
    anio                smallint GENERATED ALWAYS AS (extract(year FROM fec_emi)::smallint) STORED,
    cliente_id          bigint REFERENCES public.dist_clientes(id),
    pedido_id           bigint,  -- FK abajo, después de crear dist_pedidos
    relacionado_id      bigint REFERENCES public.dist_dte(id),  -- NC/ND → el CCF que corrigen
    total_pagar         numeric(14,2) NOT NULL,
    json                jsonb NOT NULL,
    firmado             text,        -- JWS compacto; NULL mientras no hay certificado
    -- sin_firmar: armado, falta el certificado · firmado: listo para transmitir
    -- sellado: Hacienda lo aceptó · rechazado: Hacienda lo rechazó (se corrige y se emite otro)
    -- contingencia: firmado sin poder transmitir, va en el próximo evento
    -- invalidado: anulado en Hacienda
    estado              text NOT NULL CHECK (estado IN ('sin_firmar','firmado','sellado','rechazado','contingencia','invalidado')),
    sello_recibido      text CHECK (sello_recibido IS NULL OR length(sello_recibido) = 40),
    fh_procesamiento    text,
    codigo_msg          text,
    descripcion_msg     text,
    observaciones_mh    jsonb NOT NULL DEFAULT '[]'::jsonb,
    intentos            smallint NOT NULL DEFAULT 0,
    ultimo_intento_at   timestamptz,
    contingencia_id     bigint,      -- FK abajo
    invalidado_at       timestamptz,
    invalidacion_json   jsonb,
    creado_por          uuid   REFERENCES public.employees(id),
    created_at          timestamptz NOT NULL DEFAULT now(),
    -- El sello es lo que hace «sellado»: sin él el estado miente.
    CONSTRAINT dist_dte_sellado_con_sello CHECK (estado NOT IN ('sellado','invalidado') OR sello_recibido IS NOT NULL),
    CONSTRAINT dist_dte_firmado_con_firma CHECK (estado = 'sin_firmar' OR firmado IS NOT NULL)
);
-- El número de control no se repite en el año calendario (Manual §XI).
CREATE UNIQUE INDEX dist_dte_numero_control_anio ON public.dist_dte (emisor_id, ambiente, numero_control, anio);
-- Un pedido tiene UN documento de venta vivo. Dos clics a «Facturar» al mismo
-- tiempo: entra uno y el otro choca acá (la edge function lo traduce a «ya se
-- está facturando»). Un rechazado o invalidado no cuenta: se re-emite.
CREATE UNIQUE INDEX dist_dte_un_documento_por_pedido ON public.dist_dte (pedido_id)
    WHERE tipo IN ('01','03') AND estado NOT IN ('rechazado','invalidado');
CREATE INDEX dist_dte_estado ON public.dist_dte (estado) WHERE estado IN ('sin_firmar','firmado','contingencia');
CREATE INDEX dist_dte_cliente ON public.dist_dte (cliente_id);
CREATE INDEX dist_dte_pedido ON public.dist_dte (pedido_id);
CREATE INDEX dist_dte_relacionado ON public.dist_dte (relacionado_id);
CREATE INDEX dist_dte_emisor_fecha ON public.dist_dte (emisor_id, fec_emi DESC);
CREATE INDEX dist_dte_creado_por ON public.dist_dte (creado_por);

-- Cada llamada a Hacienda, con su respuesta cruda. Es la evidencia de qué se
-- mandó y qué contestó: historial fiscal, NO se purga.
CREATE TABLE public.dist_dte_intentos (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    dte_id      bigint REFERENCES public.dist_dte(id),
    operacion   text NOT NULL CHECK (operacion IN ('transmitir','consultar','invalidar','contingencia','auth')),
    http        smallint,          -- NULL = sin respuesta
    respuesta   jsonb,
    error       text,
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX dist_dte_intentos_dte ON public.dist_dte_intentos (dte_id, created_at DESC);

-- Eventos de contingencia enviados.
CREATE TABLE public.dist_contingencias (
    id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    emisor_id         smallint NOT NULL REFERENCES public.dist_emisores(id),
    ambiente          text NOT NULL CHECK (ambiente IN ('00','01')),
    codigo_generacion uuid NOT NULL UNIQUE,
    tipo              smallint NOT NULL CHECK (tipo BETWEEN 1 AND 5),
    desde             timestamptz NOT NULL,
    hasta             timestamptz NOT NULL,
    json              jsonb NOT NULL,
    firmado           text NOT NULL,
    estado            text NOT NULL CHECK (estado IN ('enviado','recibido','rechazado')),
    sello             text,
    respuesta         jsonb,
    created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX dist_contingencias_emisor ON public.dist_contingencias (emisor_id);
ALTER TABLE public.dist_dte
    ADD CONSTRAINT dist_dte_contingencia_fk FOREIGN KEY (contingencia_id) REFERENCES public.dist_contingencias(id);
CREATE INDEX dist_dte_contingencia ON public.dist_dte (contingencia_id);

-- Correlativo por emisor, ambiente, tipo, establecimiento, punto de venta y año.
CREATE TABLE public.dist_correlativos (
    emisor_id        smallint NOT NULL REFERENCES public.dist_emisores(id),
    ambiente         text NOT NULL,
    tipo             text NOT NULL,
    establecimiento  text NOT NULL,
    punto_venta      text NOT NULL,
    anio             smallint NOT NULL,
    ultimo           bigint NOT NULL DEFAULT 0,
    created_at       timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (emisor_id, ambiente, tipo, establecimiento, punto_venta, anio)
);

-- El token de Hacienda vive 24 h y se pide una vez al día. Sólo el servidor.
CREATE TABLE public.dist_mh_token (
    emisor_id   smallint NOT NULL REFERENCES public.dist_emisores(id),
    ambiente    text NOT NULL,
    token       text NOT NULL,
    obtenido_at timestamptz NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (emisor_id, ambiente)
);

-- ── Pedidos (preventa) ──────────────────────────────────────────────────────
CREATE TABLE public.dist_pedidos (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    emisor_id       smallint NOT NULL REFERENCES public.dist_emisores(id),
    cliente_id      bigint NOT NULL REFERENCES public.dist_clientes(id),
    -- La pone la base: la ficha de quien inserta. La pantalla conoce la CUENTA
    -- y para la mayoría del personal no es el mismo id que la ficha.
    vendedor_id     uuid   NOT NULL DEFAULT public.auth_employee_id() REFERENCES public.employees(id),
    estado          text NOT NULL DEFAULT 'confirmado'
                    CHECK (estado IN ('confirmado','facturado','entregado','anulado')),
    condicion       smallint NOT NULL DEFAULT 1 CHECK (condicion IN (1,2)),   -- CAT-016
    forma_pago      text NOT NULL DEFAULT '01',                              -- CAT-017
    plazo_dias      smallint CHECK (plazo_dias IS NULL OR plazo_dias BETWEEN 1 AND 120),
    observaciones   text,
    -- Idempotencia: el teléfono genera el UUID antes de mandar. Si la señal se
    -- corta y reintenta, el pedido no se duplica.
    client_uuid     uuid NOT NULL UNIQUE,
    lat             double precision,
    lng             double precision,
    dte_id          bigint REFERENCES public.dist_dte(id),
    anulado_motivo  text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT dist_pedidos_credito_con_plazo CHECK (condicion = 1 OR plazo_dias IS NOT NULL),
    CONSTRAINT dist_pedidos_facturado_con_dte CHECK (estado NOT IN ('facturado','entregado') OR dte_id IS NOT NULL)
);
CREATE INDEX dist_pedidos_cliente ON public.dist_pedidos (cliente_id);
CREATE INDEX dist_pedidos_vendedor ON public.dist_pedidos (vendedor_id, created_at DESC);
CREATE INDEX dist_pedidos_emisor ON public.dist_pedidos (emisor_id);
CREATE INDEX dist_pedidos_dte ON public.dist_pedidos (dte_id);
CREATE INDEX dist_pedidos_por_facturar ON public.dist_pedidos (created_at) WHERE estado = 'confirmado';
ALTER TABLE public.dist_dte
    ADD CONSTRAINT dist_dte_pedido_fk FOREIGN KEY (pedido_id) REFERENCES public.dist_pedidos(id);

CREATE TABLE public.dist_pedido_items (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    pedido_id       bigint NOT NULL REFERENCES public.dist_pedidos(id) ON DELETE CASCADE,
    product_id      integer NOT NULL REFERENCES public.products(id),
    cantidad        numeric(14,4) NOT NULL CHECK (cantidad > 0),
    -- Lo copia el trigger desde el catálogo: el navegador no pone precios.
    precio_sin_iva  numeric(14,6) NOT NULL,
    descuento       numeric(14,6) NOT NULL DEFAULT 0 CHECK (descuento >= 0),
    descripcion     text NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (pedido_id, product_id)
);
CREATE INDEX dist_pedido_items_producto ON public.dist_pedido_items (product_id);

-- ── El juez de «qué se le puede vender a quién» ─────────────────────────────
CREATE OR REPLACE FUNCTION public.dist_validar_item()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE
    v_cliente   public.dist_clientes%ROWTYPE;
    v_pedido    public.dist_pedidos%ROWTYPE;
    v_cat       public.dist_catalogo%ROWTYPE;
    v_prod      public.products%ROWTYPE;
BEGIN
    SELECT * INTO v_pedido FROM public.dist_pedidos WHERE id = NEW.pedido_id;
    IF v_pedido.estado <> 'confirmado' THEN
        RAISE EXCEPTION 'DIST_PEDIDO_CERRADO: el pedido ya está %', v_pedido.estado;
    END IF;
    SELECT * INTO v_cliente FROM public.dist_clientes WHERE id = v_pedido.cliente_id;
    SELECT * INTO v_cat FROM public.dist_catalogo
     WHERE emisor_id = v_pedido.emisor_id AND product_id = NEW.product_id AND activo;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'DIST_FUERA_DE_CATALOGO: el producto % no está en el catálogo de ruta', NEW.product_id;
    END IF;
    SELECT * INTO v_prod FROM public.products WHERE id = NEW.product_id;
    IF v_cliente.tipo IN ('tienda','supermercado') AND (
        NOT v_cat.venta_libre OR coalesce(v_prod.es_antibiotico, false)
        OR coalesce(v_prod.regulado, false) OR coalesce(v_prod.requiere_receta, false)) THEN
        RAISE EXCEPTION 'DIST_NO_VENTA_LIBRE: «%» no es de venta libre y el cliente es %', v_prod.nombre, v_cliente.tipo;
    END IF;
    -- El precio sale del catálogo, siempre. Un descuento no puede pasar del importe.
    NEW.precio_sin_iva := v_cat.precio_sin_iva;
    NEW.descripcion := coalesce(nullif(btrim(NEW.descripcion), ''), v_prod.nombre);
    IF NEW.descuento > NEW.cantidad * NEW.precio_sin_iva THEN
        RAISE EXCEPTION 'DIST_DESCUENTO: el descuento pasa del importe del renglón';
    END IF;
    RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.dist_validar_item() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER dist_pedido_items_validar
    BEFORE INSERT OR UPDATE ON public.dist_pedido_items
    FOR EACH ROW EXECUTE FUNCTION public.dist_validar_item();

-- Al crear un pedido: el cliente tiene que estar activo y con licencia SRS
-- vigente, y el crédito no puede pasar del límite ni ir a quien no lo tiene.
CREATE OR REPLACE FUNCTION public.dist_validar_pedido()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE
    v_cliente public.dist_clientes%ROWTYPE;
BEGIN
    SELECT * INTO v_cliente FROM public.dist_clientes WHERE id = NEW.cliente_id;
    IF NOT v_cliente.activo THEN
        RAISE EXCEPTION 'DIST_CLIENTE_INACTIVO: % está desactivado', v_cliente.nombre;
    END IF;
    IF v_cliente.emisor_id <> NEW.emisor_id THEN
        RAISE EXCEPTION 'DIST_EMISOR: el cliente es de otro emisor';
    END IF;
    IF v_cliente.licencia_srs IS NULL OR (v_cliente.licencia_srs_vence IS NOT NULL AND v_cliente.licencia_srs_vence < current_date) THEN
        RAISE EXCEPTION 'DIST_SIN_LICENCIA: % no tiene autorización de la SRS vigente', v_cliente.nombre;
    END IF;
    IF NEW.condicion = 2 AND (v_cliente.plazo_dias = 0 OR v_cliente.limite_credito = 0) THEN
        RAISE EXCEPTION 'DIST_SIN_CREDITO: % no tiene crédito aprobado', v_cliente.nombre;
    END IF;
    IF NEW.condicion = 2 AND NEW.plazo_dias > v_cliente.plazo_dias THEN
        RAISE EXCEPTION 'DIST_PLAZO: el plazo pedido (% días) pasa del aprobado (%)', NEW.plazo_dias, v_cliente.plazo_dias;
    END IF;
    RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.dist_validar_pedido() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER dist_pedidos_validar
    BEFORE INSERT ON public.dist_pedidos
    FOR EACH ROW EXECUTE FUNCTION public.dist_validar_pedido();

-- Siguiente correlativo, atómico. Sólo el servidor: un número de control que
-- se reserva desde el navegador se puede reservar dos veces.
CREATE OR REPLACE FUNCTION public.dist_siguiente_correlativo(
    p_emisor smallint, p_ambiente text, p_tipo text, p_establecimiento text, p_punto_venta text, p_anio smallint)
RETURNS bigint LANGUAGE sql SECURITY DEFINER
SET search_path = public, extensions AS $$
    INSERT INTO public.dist_correlativos AS c (emisor_id, ambiente, tipo, establecimiento, punto_venta, anio, ultimo)
    VALUES (p_emisor, p_ambiente, p_tipo, p_establecimiento, p_punto_venta, p_anio, 1)
    ON CONFLICT (emisor_id, ambiente, tipo, establecimiento, punto_venta, anio)
    DO UPDATE SET ultimo = c.ultimo + 1
    RETURNING ultimo;
$$;
REVOKE EXECUTE ON FUNCTION public.dist_siguiente_correlativo(smallint, text, text, text, text, smallint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dist_siguiente_correlativo(smallint, text, text, text, text, smallint) TO service_role;

-- updated_at
CREATE OR REPLACE FUNCTION public.dist_tocar_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, extensions AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;
REVOKE EXECUTE ON FUNCTION public.dist_tocar_updated_at() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER dist_emisores_updated BEFORE UPDATE ON public.dist_emisores FOR EACH ROW EXECUTE FUNCTION public.dist_tocar_updated_at();
CREATE TRIGGER dist_clientes_updated BEFORE UPDATE ON public.dist_clientes FOR EACH ROW EXECUTE FUNCTION public.dist_tocar_updated_at();
CREATE TRIGGER dist_catalogo_updated BEFORE UPDATE ON public.dist_catalogo FOR EACH ROW EXECUTE FUNCTION public.dist_tocar_updated_at();
CREATE TRIGGER dist_pedidos_updated BEFORE UPDATE ON public.dist_pedidos FOR EACH ROW EXECUTE FUNCTION public.dist_tocar_updated_at();

-- ── RLS ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.dist_emisores      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dist_clientes      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dist_catalogo      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dist_dte           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dist_dte_intentos  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dist_contingencias ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dist_correlativos  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dist_mh_token      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dist_pedidos       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dist_pedido_items  ENABLE ROW LEVEL SECURITY;

-- Lectura: quien tenga el módulo.
CREATE POLICY dist_emisores_select ON public.dist_emisores FOR SELECT TO authenticated
    USING ((SELECT public.auth_has_module_permission('distribucion', 'can_view')));
CREATE POLICY dist_clientes_select ON public.dist_clientes FOR SELECT TO authenticated
    USING ((SELECT public.auth_has_module_permission('distribucion', 'can_view')));
CREATE POLICY dist_catalogo_select ON public.dist_catalogo FOR SELECT TO authenticated
    USING ((SELECT public.auth_has_module_permission('distribucion', 'can_view')));
CREATE POLICY dist_dte_select ON public.dist_dte FOR SELECT TO authenticated
    USING ((SELECT public.auth_has_module_permission('distribucion', 'can_view')));
CREATE POLICY dist_dte_intentos_select ON public.dist_dte_intentos FOR SELECT TO authenticated
    USING ((SELECT public.auth_has_module_permission('distribucion', 'can_view')));
CREATE POLICY dist_contingencias_select ON public.dist_contingencias FOR SELECT TO authenticated
    USING ((SELECT public.auth_has_module_permission('distribucion', 'can_view')));
CREATE POLICY dist_pedidos_select ON public.dist_pedidos FOR SELECT TO authenticated
    USING ((SELECT public.auth_has_module_permission('distribucion', 'can_view')));
CREATE POLICY dist_pedido_items_select ON public.dist_pedido_items FOR SELECT TO authenticated
    USING ((SELECT public.auth_has_module_permission('distribucion', 'can_view')));
-- dist_correlativos y dist_mh_token: sin policy → nadie más que service_role.

-- El emisor (NIT, ambiente) lo cambia sólo quien tiene la capacidad aparte.
CREATE POLICY dist_emisores_update ON public.dist_emisores FOR UPDATE TO authenticated
    USING ((SELECT public.auth_can_edit_any(ARRAY['distribucion_config'])))
    WITH CHECK ((SELECT public.auth_can_edit_any(ARRAY['distribucion_config'])));
CREATE POLICY dist_emisores_insert ON public.dist_emisores FOR INSERT TO authenticated
    WITH CHECK ((SELECT public.auth_can_edit_any(ARRAY['distribucion_config'])));

CREATE POLICY dist_clientes_insert ON public.dist_clientes FOR INSERT TO authenticated
    WITH CHECK ((SELECT public.auth_can_edit_any(ARRAY['distribucion'])) AND creado_por = (SELECT public.auth_employee_id()));
CREATE POLICY dist_clientes_update ON public.dist_clientes FOR UPDATE TO authenticated
    USING ((SELECT public.auth_can_edit_any(ARRAY['distribucion'])))
    WITH CHECK ((SELECT public.auth_can_edit_any(ARRAY['distribucion'])));

-- Precios: la capacidad de configuración, no la de vender.
CREATE POLICY dist_catalogo_insert ON public.dist_catalogo FOR INSERT TO authenticated
    WITH CHECK ((SELECT public.auth_can_edit_any(ARRAY['distribucion_config'])));
CREATE POLICY dist_catalogo_update ON public.dist_catalogo FOR UPDATE TO authenticated
    USING ((SELECT public.auth_can_edit_any(ARRAY['distribucion_config'])))
    WITH CHECK ((SELECT public.auth_can_edit_any(ARRAY['distribucion_config'])));

-- Pedidos: se firman con la ficha de quien los toma; se editan mientras no
-- estén facturados. Pasar a «facturado» lo hace el servidor.
CREATE POLICY dist_pedidos_insert ON public.dist_pedidos FOR INSERT TO authenticated
    WITH CHECK ((SELECT public.auth_can_edit_any(ARRAY['distribucion']))
                AND vendedor_id = (SELECT public.auth_employee_id())
                AND estado = 'confirmado' AND dte_id IS NULL);
CREATE POLICY dist_pedidos_update ON public.dist_pedidos FOR UPDATE TO authenticated
    USING ((SELECT public.auth_can_edit_any(ARRAY['distribucion'])) AND estado = 'confirmado')
    WITH CHECK ((SELECT public.auth_can_edit_any(ARRAY['distribucion'])) AND estado IN ('confirmado','anulado') AND dte_id IS NULL);

CREATE POLICY dist_pedido_items_insert ON public.dist_pedido_items FOR INSERT TO authenticated
    WITH CHECK ((SELECT public.auth_can_edit_any(ARRAY['distribucion'])));
CREATE POLICY dist_pedido_items_update ON public.dist_pedido_items FOR UPDATE TO authenticated
    USING ((SELECT public.auth_can_edit_any(ARRAY['distribucion'])))
    WITH CHECK ((SELECT public.auth_can_edit_any(ARRAY['distribucion'])));
CREATE POLICY dist_pedido_items_delete ON public.dist_pedido_items FOR DELETE TO authenticated
    USING ((SELECT public.auth_can_edit_any(ARRAY['distribucion']))
           AND EXISTS (SELECT 1 FROM public.dist_pedidos p WHERE p.id = pedido_id AND p.estado = 'confirmado'));

GRANT SELECT, INSERT, UPDATE ON public.dist_emisores, public.dist_clientes, public.dist_catalogo, public.dist_pedidos TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dist_pedido_items TO authenticated;
GRANT SELECT ON public.dist_dte, public.dist_dte_intentos, public.dist_contingencias TO authenticated;
-- La llave de servicio (la edge function distribucion-dte) NO recibe privilegios por
-- defecto en este proyecto: sin este GRANT la función lee cero filas y no
-- encuentra ni el pedido que acaba de crear el usuario (medido en pruebas).
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dist_emisores, public.dist_clientes, public.dist_catalogo,
    public.dist_dte, public.dist_dte_intentos, public.dist_contingencias, public.dist_correlativos,
    public.dist_mh_token, public.dist_pedidos, public.dist_pedido_items TO service_role;
REVOKE ALL ON public.dist_emisores, public.dist_clientes, public.dist_catalogo, public.dist_dte,
    public.dist_dte_intentos, public.dist_contingencias, public.dist_correlativos, public.dist_mh_token,
    public.dist_pedidos, public.dist_pedido_items FROM anon;

-- ── Permisos: el módulo y su capacidad de configuración ─────────────────────
-- Sólo para quien ya tiene `facturacion` con edición (gerencia y contabilidad):
-- el resto de cargos los recibe cuando alguien lo decida en Permisos.
INSERT INTO public.role_permissions (role_id, module_key, can_view, can_edit, can_approve)
SELECT rp.role_id, m.k, true, true, false
  FROM public.role_permissions rp
 CROSS JOIN (VALUES ('distribucion'), ('distribucion_config')) AS m(k)
 WHERE rp.module_key = 'facturacion' AND rp.can_edit
ON CONFLICT (role_id, module_key) DO NOTHING;
