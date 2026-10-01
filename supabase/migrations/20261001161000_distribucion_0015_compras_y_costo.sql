-- ═══════════════════════════════════════════════════════════════════════════
-- Distribución · 0015 — compras a proveedores y costo del inventario
-- ═══════════════════════════════════════════════════════════════════════════
-- Siguiente paso del plan (2026-09-30): «compras a proveedores con su costo
-- por lote» y «costo del inventario». Hasta hoy la mercadería entraba con
-- «Entrada de lote», a mano y sin costo: no había utilidad posible ni libro de
-- compras.
--
-- ── Qué valida la base al RECIBIR una compra ────────────────────────────
--   · que los productos sumen lo gravado del documento del proveedor (±2 ¢,
--     el redondeo por renglón), que el IVA sea el 13 % en un Crédito Fiscal y
--     que el total cuadre: gravado + exento + IVA + percepción − retención;
--   · que cada renglón tenga lote y vencimiento, y que no venga vencido;
--   · que el número del documento no se haya registrado ya con ese proveedor
--     (ni el código de generación, si lo trae).
-- Una compra se guarda como BORRADOR mientras se captura; recibirla es lo que
-- mueve inventario y costo, y no se deshace: se ANULA, sólo si todo lo que
-- entró sigue en bodega.
--
-- ── Costo promedio ponderado ──────────────────────────────────────────────
-- `dist_catalogo.costo_promedio` (sin IVA, por unidad): al recibir,
--   nuevo = (existencia × costo actual + unidades × costo de la compra) / (existencia + unidades).
-- Cada movimiento de entrada guarda su costo y su compra, así el costo de un
-- lote se puede reconstruir.
--
-- ── Memoria de códigos del proveedor ─────────────────────────────────────
-- El JSON del documento del proveedor trae SUS códigos. La primera vez se elige
-- a qué producto del catálogo corresponde cada uno; se recuerda en
-- `dist_proveedor_productos` y la próxima compra se llena sola.
--
-- ── Farmalasa como proveedor ─────────────────────────────────────────────
-- Pasar mercadería de las farmacias a la distribuidora es una VENTA entre dos
-- empresas (partes relacionadas), con Crédito Fiscal que emite Farmalasa. Aquí
-- entra como cualquier compra, con el proveedor marcado `relacionada`.

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.dist_proveedores (
    id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    emisor_id          smallint NOT NULL REFERENCES public.dist_emisores(id),
    nombre             text NOT NULL CHECK (btrim(nombre) <> ''),
    nit                text CHECK (nit IS NULL OR nit ~ '^[0-9]{9,14}$'),
    nrc                text CHECK (nrc IS NULL OR nrc ~ '^[0-9]{2,8}$'),
    relacionada        boolean NOT NULL DEFAULT false,
    gran_contribuyente boolean NOT NULL DEFAULT false,
    telefono           text,
    correo             text,
    plazo_dias         smallint NOT NULL DEFAULT 0 CHECK (plazo_dias BETWEEN 0 AND 180),
    activo             boolean NOT NULL DEFAULT true,
    creado_por         uuid DEFAULT public.auth_employee_id() REFERENCES public.employees(id),
    created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS dist_proveedores_nit ON public.dist_proveedores (emisor_id, nit) WHERE nit IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.dist_proveedor_productos (
    proveedor_id  bigint NOT NULL REFERENCES public.dist_proveedores(id),
    codigo        text NOT NULL CHECK (btrim(codigo) <> ''),
    product_id    integer NOT NULL REFERENCES public.products(id),
    unidades_por  integer NOT NULL DEFAULT 1 CHECK (unidades_por > 0),
    created_at    timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (proveedor_id, codigo)
);

CREATE TABLE IF NOT EXISTS public.dist_compras (
    id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    emisor_id         smallint NOT NULL REFERENCES public.dist_emisores(id),
    proveedor_id      bigint NOT NULL REFERENCES public.dist_proveedores(id),
    client_uuid       uuid NOT NULL UNIQUE,
    tipo_doc          text NOT NULL CHECK (tipo_doc IN ('01', '03', '14')),
    numero            text NOT NULL CHECK (btrim(numero) <> ''),
    codigo_generacion uuid,
    fecha             date NOT NULL,
    condicion         smallint NOT NULL DEFAULT 1 CHECK (condicion IN (1, 2)),
    vence             date,
    gravada           numeric(12,2) NOT NULL DEFAULT 0 CHECK (gravada >= 0),
    exenta            numeric(12,2) NOT NULL DEFAULT 0 CHECK (exenta >= 0),
    iva               numeric(12,2) NOT NULL DEFAULT 0 CHECK (iva >= 0),
    percepcion        numeric(12,2) NOT NULL DEFAULT 0 CHECK (percepcion >= 0),
    retencion         numeric(12,2) NOT NULL DEFAULT 0 CHECK (retencion >= 0),
    total             numeric(12,2) NOT NULL DEFAULT 0 CHECK (total >= 0),
    estado            text NOT NULL DEFAULT 'borrador' CHECK (estado IN ('borrador', 'recibida', 'anulada')),
    nota              text,
    creado_por        uuid DEFAULT public.auth_employee_id() REFERENCES public.employees(id),
    recibida_at       timestamptz,
    recibida_por      uuid REFERENCES public.employees(id),
    anulada_at        timestamptz,
    anulada_por       uuid REFERENCES public.employees(id),
    anulada_motivo    text,
    created_at        timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT dist_compras_credito_vence CHECK (condicion = 1 OR vence IS NOT NULL),
    CONSTRAINT dist_compras_anulada_motivo CHECK (estado <> 'anulada' OR btrim(coalesce(anulada_motivo, '')) <> '')
);
CREATE UNIQUE INDEX IF NOT EXISTS dist_compras_numero ON public.dist_compras (proveedor_id, upper(btrim(numero))) WHERE estado <> 'anulada';
CREATE UNIQUE INDEX IF NOT EXISTS dist_compras_codigo ON public.dist_compras (codigo_generacion) WHERE codigo_generacion IS NOT NULL AND estado <> 'anulada';
CREATE INDEX IF NOT EXISTS dist_compras_proveedor ON public.dist_compras (proveedor_id, fecha DESC);
CREATE INDEX IF NOT EXISTS dist_compras_fecha ON public.dist_compras (emisor_id, fecha DESC);

CREATE TABLE IF NOT EXISTS public.dist_compra_items (
    id                   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    compra_id            bigint NOT NULL REFERENCES public.dist_compras(id) ON DELETE CASCADE,
    product_id           integer NOT NULL REFERENCES public.products(id),
    codigo_proveedor     text,
    descripcion_proveedor text,
    cantidad             integer NOT NULL CHECK (cantidad > 0),
    costo_unitario       numeric(14,6) NOT NULL CHECK (costo_unitario > 0),
    lote                 text,
    vence                date,
    lote_id              bigint REFERENCES public.dist_lotes(id),
    created_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS dist_compra_items_compra ON public.dist_compra_items (compra_id);
CREATE INDEX IF NOT EXISTS dist_compra_items_producto ON public.dist_compra_items (product_id);
CREATE INDEX IF NOT EXISTS dist_proveedor_productos_producto ON public.dist_proveedor_productos (product_id);
CREATE INDEX IF NOT EXISTS dist_compra_items_lote ON public.dist_compra_items (lote_id) WHERE lote_id IS NOT NULL;

ALTER TABLE public.dist_catalogo ADD COLUMN IF NOT EXISTS costo_promedio numeric(14,6);
ALTER TABLE public.dist_catalogo ADD COLUMN IF NOT EXISTS costo_actualizado_at timestamptz;
ALTER TABLE public.dist_lote_movimientos ADD COLUMN IF NOT EXISTS costo_unitario numeric(14,6);
ALTER TABLE public.dist_lote_movimientos ADD COLUMN IF NOT EXISTS compra_id bigint REFERENCES public.dist_compras(id);
CREATE INDEX IF NOT EXISTS dist_lote_movimientos_compra ON public.dist_lote_movimientos (compra_id) WHERE compra_id IS NOT NULL;
-- Dos tipos de movimiento nuevos: la compra y su anulación.
DO $$
DECLARE v text;
BEGIN
    SELECT conname INTO v FROM pg_constraint
     WHERE conrelid = 'public.dist_lote_movimientos'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%''entrada''%''venta''%';
    IF v IS NOT NULL THEN EXECUTE format('ALTER TABLE public.dist_lote_movimientos DROP CONSTRAINT %I', v); END IF;
END $$;
ALTER TABLE public.dist_lote_movimientos ADD CONSTRAINT dist_lote_movimientos_tipo_check
    CHECK (tipo IN ('entrada', 'ajuste', 'venta', 'liberacion', 'devolucion', 'compra', 'compra_anulada'));

ALTER TABLE public.dist_proveedores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dist_proveedor_productos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dist_compras ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dist_compra_items ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['dist_proveedores', 'dist_proveedor_productos', 'dist_compras', 'dist_compra_items'] LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_select', t);
        EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING ((SELECT public.auth_has_module_permission(''distribucion'', ''can_view'')))', t || '_select', t);
    END LOOP;
END $$;
-- Los proveedores los da de alta quien administra; lo demás pasa por las funciones.
DROP POLICY IF EXISTS dist_proveedores_insert ON public.dist_proveedores;
CREATE POLICY dist_proveedores_insert ON public.dist_proveedores FOR INSERT TO authenticated
    WITH CHECK ((SELECT public.auth_can_edit_any(ARRAY['distribucion_config'])) AND creado_por = (SELECT public.auth_employee_id()));
DROP POLICY IF EXISTS dist_proveedores_update ON public.dist_proveedores;
CREATE POLICY dist_proveedores_update ON public.dist_proveedores FOR UPDATE TO authenticated
    USING ((SELECT public.auth_can_edit_any(ARRAY['distribucion_config'])))
    WITH CHECK ((SELECT public.auth_can_edit_any(ARRAY['distribucion_config'])));
REVOKE ALL ON public.dist_proveedores, public.dist_proveedor_productos, public.dist_compras, public.dist_compra_items FROM anon, authenticated;
GRANT SELECT ON public.dist_proveedores, public.dist_proveedor_productos, public.dist_compras, public.dist_compra_items TO authenticated;
GRANT INSERT, UPDATE ON public.dist_proveedores TO authenticated;
GRANT ALL ON public.dist_proveedores, public.dist_proveedor_productos, public.dist_compras, public.dist_compra_items TO service_role;

-- ── Guardar (borrador) ─────────────────────────────────────────────────────
-- `p_compra`: { id?, client_uuid, proveedor_id, tipo_doc, numero, codigo_generacion?,
--   fecha, condicion, vence?, gravada, exenta, iva, percepcion, retencion, total, nota,
--   items: [{ product_id, codigo_proveedor?, descripcion_proveedor?, cantidad, costo_unitario, lote, vence }] }
CREATE OR REPLACE FUNCTION public.dist_guardar_compra(p_compra jsonb)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE
    v_id     bigint := nullif(p_compra->>'id', '')::bigint;
    v_emisor smallint;
    v_estado text;
    it       jsonb;
BEGIN
    IF NOT (SELECT public.auth_can_edit_any(ARRAY['distribucion_config'])) THEN
        RAISE EXCEPTION 'DIST_SIN_PERMISO: registrar compras es de quien administra la distribuidora';
    END IF;
    SELECT emisor_id INTO v_emisor FROM public.dist_proveedores WHERE id = (p_compra->>'proveedor_id')::bigint AND activo;
    IF v_emisor IS NULL THEN RAISE EXCEPTION 'DIST_COMPRA_PROVEEDOR: elige un proveedor activo'; END IF;
    IF v_id IS NULL THEN
        SELECT id, estado INTO v_id, v_estado FROM public.dist_compras WHERE client_uuid = (p_compra->>'client_uuid')::uuid;
    ELSE
        SELECT estado INTO v_estado FROM public.dist_compras WHERE id = v_id FOR UPDATE;
    END IF;
    IF v_estado IS NOT NULL AND v_estado <> 'borrador' THEN
        RAISE EXCEPTION 'DIST_COMPRA_CERRADA: esa compra ya está %', v_estado;
    END IF;
    -- El mismo documento dos veces: se dice cuál, en vez del choque del índice.
    IF EXISTS (SELECT 1 FROM public.dist_compras
                WHERE estado <> 'anulada' AND id IS DISTINCT FROM v_id
                  AND ((proveedor_id = (p_compra->>'proveedor_id')::bigint AND upper(btrim(numero)) = upper(btrim(p_compra->>'numero')))
                    OR codigo_generacion = nullif(p_compra->>'codigo_generacion', '')::uuid)) THEN
        RAISE EXCEPTION 'DIST_COMPRA_REPETIDA: el documento % de ese proveedor ya está registrado', upper(btrim(p_compra->>'numero'));
    END IF;
    IF v_id IS NULL THEN
        INSERT INTO public.dist_compras (emisor_id, proveedor_id, client_uuid, tipo_doc, numero, codigo_generacion, fecha,
               condicion, vence, gravada, exenta, iva, percepcion, retencion, total, nota)
        VALUES (v_emisor, (p_compra->>'proveedor_id')::bigint, (p_compra->>'client_uuid')::uuid, p_compra->>'tipo_doc',
                upper(btrim(p_compra->>'numero')), nullif(p_compra->>'codigo_generacion', '')::uuid, (p_compra->>'fecha')::date,
                coalesce((p_compra->>'condicion')::smallint, 1), nullif(p_compra->>'vence', '')::date,
                coalesce((p_compra->>'gravada')::numeric, 0), coalesce((p_compra->>'exenta')::numeric, 0),
                coalesce((p_compra->>'iva')::numeric, 0), coalesce((p_compra->>'percepcion')::numeric, 0),
                coalesce((p_compra->>'retencion')::numeric, 0), coalesce((p_compra->>'total')::numeric, 0),
                nullif(btrim(coalesce(p_compra->>'nota', '')), ''))
        RETURNING id INTO v_id;
    ELSE
        UPDATE public.dist_compras SET
            proveedor_id = (p_compra->>'proveedor_id')::bigint, tipo_doc = p_compra->>'tipo_doc',
            numero = upper(btrim(p_compra->>'numero')), codigo_generacion = nullif(p_compra->>'codigo_generacion', '')::uuid,
            fecha = (p_compra->>'fecha')::date, condicion = coalesce((p_compra->>'condicion')::smallint, 1),
            vence = nullif(p_compra->>'vence', '')::date,
            gravada = coalesce((p_compra->>'gravada')::numeric, 0), exenta = coalesce((p_compra->>'exenta')::numeric, 0),
            iva = coalesce((p_compra->>'iva')::numeric, 0), percepcion = coalesce((p_compra->>'percepcion')::numeric, 0),
            retencion = coalesce((p_compra->>'retencion')::numeric, 0), total = coalesce((p_compra->>'total')::numeric, 0),
            nota = nullif(btrim(coalesce(p_compra->>'nota', '')), '')
         WHERE id = v_id;
        DELETE FROM public.dist_compra_items WHERE compra_id = v_id;
    END IF;
    FOR it IN SELECT * FROM jsonb_array_elements(coalesce(p_compra->'items', '[]'::jsonb)) LOOP
        INSERT INTO public.dist_compra_items (compra_id, product_id, codigo_proveedor, descripcion_proveedor, cantidad, costo_unitario, lote, vence)
        VALUES (v_id, (it->>'product_id')::integer, nullif(it->>'codigo_proveedor', ''), nullif(it->>'descripcion_proveedor', ''),
                (it->>'cantidad')::integer, (it->>'costo_unitario')::numeric,
                nullif(upper(btrim(coalesce(it->>'lote', ''))), ''), nullif(it->>'vence', '')::date);
        -- La memoria de códigos del proveedor.
        IF nullif(btrim(coalesce(it->>'codigo_proveedor', '')), '') IS NOT NULL THEN
            INSERT INTO public.dist_proveedor_productos (proveedor_id, codigo, product_id, unidades_por)
            VALUES ((p_compra->>'proveedor_id')::bigint, btrim(it->>'codigo_proveedor'), (it->>'product_id')::integer,
                    greatest(1, coalesce((it->>'unidades_por')::integer, 1)))
            ON CONFLICT (proveedor_id, codigo) DO UPDATE SET product_id = EXCLUDED.product_id, unidades_por = EXCLUDED.unidades_por;
        END IF;
    END LOOP;
    RETURN v_id;
END $$;
REVOKE EXECUTE ON FUNCTION public.dist_guardar_compra(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dist_guardar_compra(jsonb) TO authenticated, service_role;

-- ── Recibir: valida contra el documento y mueve inventario y costo ─────────
CREATE OR REPLACE FUNCTION public.dist_recibir_compra(p_compra bigint)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE
    v_yo     uuid := public.auth_employee_id();
    c        public.dist_compras%ROWTYPE;
    it       record;
    v_suma   numeric;
    v_lote   bigint;
    v_vence  date;
    v_exist  numeric;
    v_costo  numeric;
    v_mov    bigint;
    v_n      integer := 0;
BEGIN
    IF NOT (SELECT public.auth_can_edit_any(ARRAY['distribucion_config'])) THEN
        RAISE EXCEPTION 'DIST_SIN_PERMISO: recibir compras es de quien administra la distribuidora';
    END IF;
    SELECT * INTO c FROM public.dist_compras WHERE id = p_compra FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'DIST_COMPRA: no existe esa compra'; END IF;
    IF c.estado <> 'borrador' THEN RAISE EXCEPTION 'DIST_COMPRA_CERRADA: esa compra ya está %', c.estado; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.dist_compra_items WHERE compra_id = p_compra) THEN
        RAISE EXCEPTION 'DIST_COMPRA_VACIA: la compra no tiene productos';
    END IF;
    IF c.fecha > current_date THEN RAISE EXCEPTION 'DIST_COMPRA_FECHA: la fecha del documento está en el futuro'; END IF;

    -- Contra el documento del proveedor.
    -- Tolerancia: un centavo por renglón (mínimo dos). El proveedor redondea cada
    -- renglón y el costo por unidad de una caja partida no siempre es exacto.
    SELECT round(sum(round(cantidad * costo_unitario, 2)), 2), count(*) INTO v_suma, v_n FROM public.dist_compra_items WHERE compra_id = p_compra;
    IF abs(v_suma - (c.gravada + c.exenta)) > greatest(0.02, 0.01 * v_n) THEN
        RAISE EXCEPTION 'DIST_COMPRA_CUADRE: los productos suman $% y el documento dice $% (gravado + exento)',
            to_char(v_suma, 'FM999,999,990.00'), to_char(c.gravada + c.exenta, 'FM999,999,990.00');
    END IF;
    IF c.tipo_doc = '03' AND abs(c.iva - round(c.gravada * 0.13, 2)) > 0.02 THEN
        RAISE EXCEPTION 'DIST_COMPRA_IVA: el IVA de un Crédito Fiscal es el 13 %% de lo gravado ($%), y dice $%',
            to_char(round(c.gravada * 0.13, 2), 'FM999,999,990.00'), to_char(c.iva, 'FM999,999,990.00');
    END IF;
    IF abs(c.total - (c.gravada + c.exenta + c.iva + c.percepcion - c.retencion)) > 0.01 THEN
        RAISE EXCEPTION 'DIST_COMPRA_TOTAL: el total no cuadra: gravado + exento + IVA + percepción − retención = $%, y dice $%',
            to_char(c.gravada + c.exenta + c.iva + c.percepcion - c.retencion, 'FM999,999,990.00'), to_char(c.total, 'FM999,999,990.00');
    END IF;

    FOR it IN SELECT i.*, p.nombre FROM public.dist_compra_items i LEFT JOIN public.products p ON p.id = i.product_id
               WHERE i.compra_id = p_compra ORDER BY i.id LOOP
        IF NOT EXISTS (SELECT 1 FROM public.dist_catalogo WHERE emisor_id = c.emisor_id AND product_id = it.product_id) THEN
            RAISE EXCEPTION 'DIST_COMPRA_CATALOGO: «%» no está en el catálogo de la distribuidora', coalesce(it.nombre, it.product_id::text);
        END IF;
        IF it.lote IS NULL OR it.vence IS NULL THEN
            RAISE EXCEPTION 'DIST_COMPRA_LOTE: «%» necesita lote y vencimiento', coalesce(it.nombre, it.product_id::text);
        END IF;
        IF it.vence <= current_date THEN
            RAISE EXCEPTION 'DIST_COMPRA_VENCIDO: el lote % de «%» ya está vencido', it.lote, coalesce(it.nombre, it.product_id::text);
        END IF;
        -- Costo promedio: con la existencia de ANTES de esta entrada.
        SELECT coalesce(sum(existencia), 0) INTO v_exist FROM public.dist_lotes WHERE emisor_id = c.emisor_id AND product_id = it.product_id;
        SELECT costo_promedio INTO v_costo FROM public.dist_catalogo WHERE emisor_id = c.emisor_id AND product_id = it.product_id FOR UPDATE;
        UPDATE public.dist_catalogo
           SET costo_promedio = CASE WHEN v_costo IS NULL OR v_exist <= 0 THEN it.costo_unitario
                                     ELSE (v_exist * v_costo + it.cantidad * it.costo_unitario) / (v_exist + it.cantidad) END,
               costo_actualizado_at = now()
         WHERE emisor_id = c.emisor_id AND product_id = it.product_id;
        -- El lote: el mismo lote con otro vencimiento es un error de captura.
        SELECT id, vence INTO v_lote, v_vence FROM public.dist_lotes
         WHERE emisor_id = c.emisor_id AND product_id = it.product_id AND upper(btrim(lote)) = upper(btrim(it.lote)) FOR UPDATE;
        IF v_lote IS NULL THEN
            INSERT INTO public.dist_lotes (emisor_id, product_id, lote, vence) VALUES (c.emisor_id, it.product_id, it.lote, it.vence)
            RETURNING id INTO v_lote;
        ELSIF v_vence IS DISTINCT FROM it.vence THEN
            RAISE EXCEPTION 'DIST_COMPRA_LOTE_VENCE: el lote % de «%» ya existe con vencimiento %',
                it.lote, coalesce(it.nombre, it.product_id::text), coalesce(to_char(v_vence, 'DD/MM/YYYY'), 'sin fecha');
        END IF;
        PERFORM public.dist_mover_lote(v_lote, it.cantidad, 'compra', NULL, NULL, format('Compra %s · %s', c.id, c.numero));
        SELECT max(id) INTO v_mov FROM public.dist_lote_movimientos WHERE lote_id = v_lote AND tipo = 'compra';
        UPDATE public.dist_lote_movimientos SET costo_unitario = it.costo_unitario, compra_id = c.id, creado_por = v_yo WHERE id = v_mov;
        UPDATE public.dist_compra_items SET lote_id = v_lote WHERE id = it.id;
    END LOOP;
    UPDATE public.dist_compras SET estado = 'recibida', recibida_at = now(), recibida_por = v_yo WHERE id = p_compra;
    RETURN json_build_object('id', p_compra, 'renglones', v_n, 'total', c.total);
END $$;
REVOKE EXECUTE ON FUNCTION public.dist_recibir_compra(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dist_recibir_compra(bigint) TO authenticated, service_role;

-- ── Anular: un borrador sin más; una recibida sólo si todo sigue en bodega ─
CREATE OR REPLACE FUNCTION public.dist_anular_compra(p_compra bigint, p_motivo text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE
    v_yo    uuid := public.auth_employee_id();
    c       public.dist_compras%ROWTYPE;
    it      record;
    v_exist numeric;
    v_costo numeric;
BEGIN
    IF NOT (SELECT public.auth_can_edit_any(ARRAY['distribucion_config'])) THEN
        RAISE EXCEPTION 'DIST_SIN_PERMISO: anular compras es de quien administra la distribuidora';
    END IF;
    IF btrim(coalesce(p_motivo, '')) = '' THEN RAISE EXCEPTION 'DIST_COMPRA_MOTIVO: escribe por qué se anula la compra'; END IF;
    SELECT * INTO c FROM public.dist_compras WHERE id = p_compra FOR UPDATE;
    IF NOT FOUND OR c.estado = 'anulada' THEN RAISE EXCEPTION 'DIST_COMPRA: esa compra no existe o ya está anulada'; END IF;
    IF c.estado = 'recibida' THEN
        FOR it IN SELECT i.*, l.existencia, p.nombre FROM public.dist_compra_items i
                    JOIN public.dist_lotes l ON l.id = i.lote_id LEFT JOIN public.products p ON p.id = i.product_id
                   WHERE i.compra_id = p_compra FOR UPDATE OF l LOOP
            IF it.existencia < it.cantidad THEN
                RAISE EXCEPTION 'DIST_COMPRA_VENDIDA: del lote % de «%» ya salieron unidades: no se puede anular la compra entera',
                    it.lote, coalesce(it.nombre, it.product_id::text);
            END IF;
        END LOOP;
        FOR it IN SELECT i.* FROM public.dist_compra_items i WHERE i.compra_id = p_compra LOOP
            -- El costo promedio se deshace con la misma cuenta al revés.
            SELECT coalesce(sum(existencia), 0) INTO v_exist FROM public.dist_lotes WHERE emisor_id = c.emisor_id AND product_id = it.product_id;
            SELECT costo_promedio INTO v_costo FROM public.dist_catalogo WHERE emisor_id = c.emisor_id AND product_id = it.product_id FOR UPDATE;
            IF v_exist - it.cantidad > 0 AND v_costo IS NOT NULL THEN
                UPDATE public.dist_catalogo SET costo_promedio = greatest(0.000001, (v_exist * v_costo - it.cantidad * it.costo_unitario) / (v_exist - it.cantidad)),
                       costo_actualizado_at = now()
                 WHERE emisor_id = c.emisor_id AND product_id = it.product_id;
            END IF;
            PERFORM public.dist_mover_lote(it.lote_id, -it.cantidad, 'compra_anulada', NULL, NULL, format('Anulación de la compra %s: %s', c.id, btrim(p_motivo)));
        END LOOP;
    END IF;
    UPDATE public.dist_compras SET estado = 'anulada', anulada_at = now(), anulada_por = v_yo, anulada_motivo = btrim(p_motivo) WHERE id = p_compra;
    RETURN json_build_object('id', p_compra, 'estado', 'anulada');
END $$;
REVOKE EXECUTE ON FUNCTION public.dist_anular_compra(bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dist_anular_compra(bigint, text) TO authenticated, service_role;
