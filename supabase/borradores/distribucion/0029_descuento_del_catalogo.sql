-- ═══════════════════════════════════════════════════════════════════════════
-- Distribución · 0029 — % de descuento por producto en el catálogo
-- ═══════════════════════════════════════════════════════════════════════════
-- Pedido del usuario (2026-09-30): «necesito tener eso en el catálogo de
-- productos, poder asignar % de descuento, verifica el erp como hace».
--
-- El ERP de las farmacias no tiene el % en la ficha: usa PROMOCIONES (% o $
-- por unidad, con inicio y fin, sobre una lista de productos) que se aplican
-- solas al vender. No tienen tope, no avisan si el precio queda bajo el costo
-- y el renglón no guarda que el descuento vino de ahí
-- (docs/DESCUENTOS-EN-LA-VENTA-2026-09-04.md). Acá va en el catálogo, con
-- las tres cosas que al ERP le faltan:
--
--   · `descuento_pct` + vigencia opcional (`descuento_desde`/`hasta`): la
--     pantalla lo PRECARGA en el renglón y cualquiera que venda lo da sin
--     aprobación. Que lo precargue la pantalla y no lo invente el trigger es a
--     propósito: el vendedor ve el descuento antes de cobrar, y la base sólo
--     juzga lo que llegó —si inventara un descuento que la pantalla no mostró,
--     el total cobrado y el del documento dejarían de ser el mismo número.
--   · `descuento_max_pct`: tope POR PRODUCTO para quien tiene
--     «distribucion_descuentos». Sin él vale el de la empresa. Pasarse se
--     sigue pidiendo a aprobación, como hoy (0008).
--   · `dist_pedido_items.descuento_origen` ('catalogo' | 'manual'): de dónde
--     salió cada descuento, para medir una campaña.
--
-- El aviso de «queda bajo el costo» vive en la pantalla del catálogo: el
-- costo es un promedio que se mueve con cada compra, y bloquear la venta por
-- él trabaría una liquidación de vencimiento hecha a propósito.
--
-- El cuerpo de dist_validar_item parte de su definición VIVA
-- (pg_get_functiondef), no del archivo de 0008.
SET lock_timeout = '5s';

ALTER TABLE public.dist_catalogo
    ADD COLUMN IF NOT EXISTS descuento_pct     numeric(5,2) NOT NULL DEFAULT 0 CHECK (descuento_pct BETWEEN 0 AND 100),
    ADD COLUMN IF NOT EXISTS descuento_desde   date,
    ADD COLUMN IF NOT EXISTS descuento_hasta   date,
    ADD COLUMN IF NOT EXISTS descuento_max_pct numeric(5,2) CHECK (descuento_max_pct IS NULL OR descuento_max_pct BETWEEN 0 AND 100);
ALTER TABLE public.dist_catalogo DROP CONSTRAINT IF EXISTS dist_catalogo_descuento_vigencia;
ALTER TABLE public.dist_catalogo ADD CONSTRAINT dist_catalogo_descuento_vigencia
    CHECK (descuento_desde IS NULL OR descuento_hasta IS NULL OR descuento_desde <= descuento_hasta);

ALTER TABLE public.dist_pedido_items
    ADD COLUMN IF NOT EXISTS descuento_origen text CHECK (descuento_origen IS NULL OR descuento_origen IN ('catalogo', 'manual'));

CREATE OR REPLACE FUNCTION public.dist_validar_item()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_cliente   public.dist_clientes%ROWTYPE;
    v_pedido    public.dist_pedidos%ROWTYPE;
    v_cat       public.dist_catalogo%ROWTYPE;
    v_prod      public.products%ROWTYPE;
    v_emisor    public.dist_emisores%ROWTYPE;
    v_precio    numeric;
    v_lista     smallint;
    v_importe   numeric;
    v_pedido_d  numeric;   -- el descuento que se pide en este renglón, con IVA
    v_pct       numeric;
    v_puede     boolean;
    v_cat_pct   numeric;   -- el % del catálogo vigente hoy
    v_tope      numeric;   -- el tope del que tiene «descuentos»: el del producto o el de la empresa
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
    -- no tiene precio, «UNIDAD» con el precio del catálogo. Gemelo de pantalla:
    -- src/views/distribucion/precios.js.
    v_lista := coalesce(NEW.lista_id, v_cliente.lista_id);
    SELECT p.precio_con_iva, p.lista_id, p.unidades INTO v_precio, v_lista, NEW.unidades
      FROM public.dist_precios p JOIN public.dist_listas l ON l.id = p.lista_id
     WHERE p.emisor_id = v_pedido.emisor_id AND p.product_id = NEW.product_id
       AND p.presentacion = NEW.presentacion AND p.activo AND l.activo
     ORDER BY (p.lista_id = v_lista) DESC, l.orden
     LIMIT 1;
    IF NOT FOUND THEN
        IF NEW.presentacion <> 'UNIDAD' THEN
            RAISE EXCEPTION 'DIST_SIN_PRECIO: «%» no tiene precio en la presentación %', v_prod.nombre, NEW.presentacion;
        END IF;
        v_precio := v_cat.precio_con_iva;
        NEW.unidades := 1;
        v_lista := NULL;
    END IF;
    NEW.precio_con_iva := v_precio;
    NEW.lista_id := v_lista;
    NEW.descripcion := v_prod.nombre || CASE WHEN NEW.presentacion <> 'UNIDAD' THEN ' — ' || NEW.presentacion ELSE '' END;

    -- ── El descuento ──
    v_importe := NEW.cantidad * NEW.precio_con_iva;
    -- Aprobando una solicitud: `dist_resolver_descuento` ya decidió; el
    -- renglón trae el monto final y no se vuelve a juzgar.
    IF current_setting('dist.resolviendo_descuento', true) = 'on' THEN
        IF NEW.descuento > v_importe THEN
            RAISE EXCEPTION 'DIST_DESCUENTO: el descuento pasa del importe del renglón';
        END IF;
        RETURN NEW;
    END IF;

    v_pedido_d := CASE WHEN NEW.descuento_pct IS NOT NULL
                       THEN round(v_importe * NEW.descuento_pct / 100, 2)
                       ELSE NEW.descuento END;
    IF v_pedido_d > v_importe THEN
        RAISE EXCEPTION 'DIST_DESCUENTO: el descuento pasa del importe del renglón';
    END IF;

    IF v_pedido_d = 0 THEN
        NEW.descuento := 0;
        NEW.descuento_estado := 'aplicado';
        NEW.descuento_pedido := NULL;
        NEW.descuento_origen := NULL;
        RETURN NEW;
    END IF;

    v_pct := CASE WHEN v_importe > 0 THEN v_pedido_d * 100 / v_importe ELSE 0 END;
    -- El % del catálogo (0029): lo da cualquiera que venda, sin aprobación,
    -- mientras esté vigente. Gemelo de pantalla: descuentoDelCatalogo() en
    -- src/views/distribucion/precios.js.
    v_cat_pct := CASE WHEN coalesce(v_cat.descuento_pct, 0) > 0
                       AND (v_cat.descuento_desde IS NULL OR v_cat.descuento_desde <= (now() AT TIME ZONE 'America/El_Salvador')::date)
                       AND (v_cat.descuento_hasta IS NULL OR v_cat.descuento_hasta >= (now() AT TIME ZONE 'America/El_Salvador')::date)
                      THEN v_cat.descuento_pct ELSE 0 END;
    NEW.descuento_origen := CASE WHEN v_cat_pct > 0 AND abs(v_pct - v_cat_pct) <= 0.005 THEN 'catalogo' ELSE 'manual' END;

    -- Volver a guardar la venta con el MISMO descuento ya dado (aprobado o
    -- aplicado por quien podía) no lo vuelve a poner en duda.
    IF TG_OP = 'UPDATE' AND OLD.descuento_estado = 'aplicado' AND OLD.descuento = v_pedido_d
       AND OLD.cantidad = NEW.cantidad AND OLD.precio_con_iva = NEW.precio_con_iva THEN
        NEW.descuento := v_pedido_d;
        NEW.descuento_estado := 'aplicado';
        NEW.descuento_pedido := NULL;
        RETURN NEW;
    END IF;

    v_tope := coalesce(v_cat.descuento_max_pct, v_emisor.descuento_max_pct);
    v_puede := (SELECT auth.role()) = 'service_role'
        OR v_pct <= v_cat_pct + 0.005
        OR (SELECT public.auth_can_edit_any(ARRAY['distribucion_config']))
        OR ((SELECT public.auth_can_edit_any(ARRAY['distribucion_descuentos']))
            AND v_pct <= greatest(v_tope, v_cat_pct) + 0.005);

    IF v_puede THEN
        NEW.descuento := v_pedido_d;
        NEW.descuento_estado := 'aplicado';
        NEW.descuento_pedido := NULL;
    ELSE
        -- Se guarda lo pedido; lo que vale hoy es cero.
        NEW.descuento := 0;
        NEW.descuento_estado := 'pendiente';
        NEW.descuento_pedido := v_pedido_d;
    END IF;
    RETURN NEW;
END $function$;
