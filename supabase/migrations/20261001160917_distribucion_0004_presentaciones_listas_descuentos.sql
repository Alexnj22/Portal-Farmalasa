-- ════════════════════════════════════════════════════════════════════════════
-- Distribución — presentaciones, listas de precio y descuentos por renglón
-- ════════════════════════════════════════════════════════════════════════════
--
-- BORRADOR (ver 0001).
--
-- Lo que la caja resuelve en cada renglón y la venta de ruta no tenía (pedido
-- del usuario, 2026-09-28): PRESENTACIÓN (caja, blíster, unidad — cada una con
-- su precio y sus unidades), NIVEL DE PRECIO (la caja tiene Viñeta, VIP,
-- Clínica, Mayoreo…) y DESCUENTO por renglón.
--
-- ── Cómo se decide el precio ───────────────────────────────────────────────
--   · Cada producto tiene una o varias presentaciones, y cada presentación un
--     precio POR LISTA (`dist_precios`).
--   · El cliente trae su lista por defecto; en la venta se puede elegir otra
--     de las que tiene ese producto.
--   · El precio lo pone el TRIGGER desde `dist_precios` —el navegador no pone
--     precios—. Si la presentación no tiene precio en esa lista, se usa el de
--     la lista base (la de orden 1); si no hay ninguno, el del catálogo por
--     unidad × las unidades de la presentación.
--
-- ── Descuento ──────────────────────────────────────────────────────────────
-- En % o en $, por renglón. La caja no deja bajar del precio de la lista sin
-- un código; acá el equivalente es un TOPE en % que fija la empresa
-- (`dist_emisores.descuento_max_pct`). Pasarlo exige la capacidad
-- `distribucion_config` —lo mira el trigger, no la pantalla—.

SET lock_timeout = '5s';

CREATE TABLE public.dist_listas (
    id          smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    emisor_id   smallint NOT NULL REFERENCES public.dist_emisores(id),
    nombre      text NOT NULL CHECK (btrim(nombre) <> ''),
    orden       smallint NOT NULL DEFAULT 1,   -- 1 = la base (respaldo cuando falta un precio)
    activo      boolean NOT NULL DEFAULT true,
    created_at  timestamptz NOT NULL DEFAULT now(),
    UNIQUE (emisor_id, nombre)
);
CREATE INDEX dist_listas_emisor ON public.dist_listas (emisor_id);

CREATE TABLE public.dist_precios (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    emisor_id       smallint NOT NULL REFERENCES public.dist_emisores(id),
    product_id      integer NOT NULL REFERENCES public.products(id),
    presentacion    text NOT NULL CHECK (btrim(presentacion) <> ''),   -- «UNIDAD», «CAJA X 24»…
    unidades        integer NOT NULL DEFAULT 1 CHECK (unidades > 0),
    lista_id        smallint NOT NULL REFERENCES public.dist_listas(id),
    precio_sin_iva  numeric(14,6) NOT NULL CHECK (precio_sin_iva >= 0),
    activo          boolean NOT NULL DEFAULT true,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (emisor_id, product_id, presentacion, lista_id)
);
CREATE INDEX dist_precios_producto ON public.dist_precios (product_id);
CREATE INDEX dist_precios_lista ON public.dist_precios (lista_id);
CREATE TRIGGER dist_precios_updated BEFORE UPDATE ON public.dist_precios FOR EACH ROW EXECUTE FUNCTION public.dist_tocar_updated_at();

ALTER TABLE public.dist_emisores
    ADD COLUMN descuento_max_pct numeric(5,2) NOT NULL DEFAULT 10 CHECK (descuento_max_pct BETWEEN 0 AND 100);
ALTER TABLE public.dist_clientes
    ADD COLUMN lista_id smallint REFERENCES public.dist_listas(id);
CREATE INDEX dist_clientes_lista ON public.dist_clientes (lista_id);

-- El renglón dice en qué presentación y lista se vendió, y el descuento que se pidió.
ALTER TABLE public.dist_pedido_items
    ADD COLUMN presentacion  text NOT NULL DEFAULT 'UNIDAD',
    ADD COLUMN unidades      integer NOT NULL DEFAULT 1 CHECK (unidades > 0),
    ADD COLUMN lista_id      smallint REFERENCES public.dist_listas(id),
    ADD COLUMN descuento_pct numeric(5,2) CHECK (descuento_pct IS NULL OR descuento_pct BETWEEN 0 AND 100);
CREATE INDEX dist_pedido_items_lista ON public.dist_pedido_items (lista_id);
-- El mismo producto puede ir en dos presentaciones (una caja y tres unidades sueltas).
ALTER TABLE public.dist_pedido_items DROP CONSTRAINT dist_pedido_items_pedido_id_product_id_key;
ALTER TABLE public.dist_pedido_items ADD CONSTRAINT dist_pedido_items_renglon_unico UNIQUE (pedido_id, product_id, presentacion);

-- Efectivo: lo que el cliente ENTREGÓ, para el cambio. No va al documento.
ALTER TABLE public.dist_pagos ADD COLUMN efectivo_recibido numeric(12,2) CHECK (efectivo_recibido IS NULL OR efectivo_recibido > 0);

-- ── El juez del renglón, ahora con presentación, lista y descuento ─────────
CREATE OR REPLACE FUNCTION public.dist_validar_item()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE
    v_cliente   public.dist_clientes%ROWTYPE;
    v_pedido    public.dist_pedidos%ROWTYPE;
    v_cat       public.dist_catalogo%ROWTYPE;
    v_prod      public.products%ROWTYPE;
    v_emisor    public.dist_emisores%ROWTYPE;
    v_precio    numeric;
    v_lista     smallint;
    v_importe   numeric;
    v_pct       numeric;
BEGIN
    SELECT * INTO v_pedido FROM public.dist_pedidos WHERE id = NEW.pedido_id;
    IF v_pedido.estado <> 'confirmado' THEN
        RAISE EXCEPTION 'DIST_PEDIDO_CERRADO: el pedido ya está %', v_pedido.estado;
    END IF;
    SELECT * INTO v_cliente FROM public.dist_clientes WHERE id = v_pedido.cliente_id;
    SELECT * INTO v_emisor FROM public.dist_emisores WHERE id = v_pedido.emisor_id;
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

    -- Precio: la lista pedida → la del cliente → la base; y si la presentación
    -- no tiene precio, el del catálogo por unidad × unidades.
    v_lista := coalesce(NEW.lista_id, v_cliente.lista_id);
    SELECT p.precio_sin_iva, p.lista_id, p.unidades INTO v_precio, v_lista, NEW.unidades
      FROM public.dist_precios p JOIN public.dist_listas l ON l.id = p.lista_id
     WHERE p.emisor_id = v_pedido.emisor_id AND p.product_id = NEW.product_id
       AND p.presentacion = NEW.presentacion AND p.activo AND l.activo
     ORDER BY (p.lista_id = v_lista) DESC, l.orden
     LIMIT 1;
    IF NOT FOUND THEN
        IF NEW.presentacion <> 'UNIDAD' THEN
            RAISE EXCEPTION 'DIST_SIN_PRECIO: «%» no tiene precio en la presentación %', v_prod.nombre, NEW.presentacion;
        END IF;
        v_precio := v_cat.precio_sin_iva;
        NEW.unidades := 1;
        v_lista := NULL;
    END IF;
    NEW.precio_sin_iva := v_precio;
    NEW.lista_id := v_lista;
    NEW.descripcion := v_prod.nombre || CASE WHEN NEW.presentacion <> 'UNIDAD' THEN ' — ' || NEW.presentacion ELSE '' END;

    -- Descuento: si viene en %, el monto sale de ahí; el tope de la empresa
    -- sólo lo pasa quien tiene la capacidad de configuración.
    v_importe := NEW.cantidad * NEW.precio_sin_iva;
    IF NEW.descuento_pct IS NOT NULL THEN
        NEW.descuento := round(v_importe * NEW.descuento_pct / 100, 6);
    END IF;
    IF NEW.descuento > v_importe THEN
        RAISE EXCEPTION 'DIST_DESCUENTO: el descuento pasa del importe del renglón';
    END IF;
    v_pct := CASE WHEN v_importe > 0 THEN NEW.descuento * 100 / v_importe ELSE 0 END;
    IF v_pct > v_emisor.descuento_max_pct + 0.005
       AND (SELECT auth.role()) IS DISTINCT FROM 'service_role'
       AND NOT (SELECT public.auth_can_edit_any(ARRAY['distribucion_config'])) THEN
        RAISE EXCEPTION 'DIST_DESCUENTO_TOPE: el descuento (% %%) pasa del tope de % %%', round(v_pct, 2), v_emisor.descuento_max_pct;
    END IF;
    RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.dist_validar_item() FROM PUBLIC, anon, authenticated;

-- ── RLS ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.dist_listas  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dist_precios ENABLE ROW LEVEL SECURITY;
CREATE POLICY dist_listas_select ON public.dist_listas FOR SELECT TO authenticated
    USING ((SELECT public.auth_has_module_permission('distribucion', 'can_view')));
CREATE POLICY dist_precios_select ON public.dist_precios FOR SELECT TO authenticated
    USING ((SELECT public.auth_has_module_permission('distribucion', 'can_view')));
CREATE POLICY dist_listas_escribir ON public.dist_listas FOR ALL TO authenticated
    USING ((SELECT public.auth_can_edit_any(ARRAY['distribucion_config'])))
    WITH CHECK ((SELECT public.auth_can_edit_any(ARRAY['distribucion_config'])));
CREATE POLICY dist_precios_escribir ON public.dist_precios FOR ALL TO authenticated
    USING ((SELECT public.auth_can_edit_any(ARRAY['distribucion_config'])))
    WITH CHECK ((SELECT public.auth_can_edit_any(ARRAY['distribucion_config'])));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dist_listas, public.dist_precios TO authenticated, service_role;
REVOKE ALL ON public.dist_listas, public.dist_precios FROM anon;
