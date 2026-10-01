-- ════════════════════════════════════════════════════════════════════════════
-- Distribución — los precios se guardan CON IVA, en centavos
-- ════════════════════════════════════════════════════════════════════════════
--
-- BORRADOR (ver 0001). Decisión del usuario, 2026-09-28.
--
-- ── Por qué ─────────────────────────────────────────────────────────────────
-- Un precio de lista es lo que el cliente paga: $34.10 la caja. Guardado sin
-- IVA a 6 decimales (30.176991) y vuelto a llevar al precio con IVA daba
-- 34.0999…, y la pantalla —que hacía su propia cuenta— cobraba $32.40 sobre un
-- documento que decía $32.39. Hacienda tolera ±$0.01, así que el documento
-- estaba bien; lo que no cuadraba era la CAJA: un centavo por venta que el
-- vendedor liquida de más o de menos sin que nadie lo pueda explicar.
--
-- Guardado con IVA en centavos, la Factura lo usa tal cual (su precio unitario
-- lleva el IVA) y el Crédito Fiscal lo lleva a sin IVA a 8 decimales, como
-- permite el Manual Funcional para el cuerpo del documento. Y la pantalla
-- calcula con el MISMO motor que el documento: no hay dos cuentas.
--
-- ── Qué cambia ──────────────────────────────────────────────────────────────
--   · dist_catalogo.precio_sin_iva   → precio_con_iva numeric(12,2)
--   · dist_precios.precio_sin_iva    → precio_con_iva numeric(12,2)
--   · dist_pedido_items.precio_sin_iva → precio_con_iva numeric(12,2), y
--     `descuento` pasa a estar en la misma base (con IVA). En % se redondea a
--     centavos; en $ se guarda lo escrito, llevado a con IVA si el documento es
--     Crédito Fiscal (ahí el precio que se ve es sin IVA): $1.00 → 1.13, exacto
--     a 6 decimales, y el motor lo devuelve a $1.00 sin perder nada.
-- Las columnas se RENOMBRAN, no se reutilizan: «el tipo de la columna manda,
-- no el nombre» (CLAUDE.md) — un `precio_sin_iva` con IVA adentro sería
-- exactamente el defecto de `recibido_mh`.

SET lock_timeout = '5s';

ALTER TABLE public.dist_catalogo RENAME COLUMN precio_sin_iva TO precio_con_iva;
ALTER TABLE public.dist_catalogo ALTER COLUMN precio_con_iva TYPE numeric(12,2) USING round(precio_con_iva * 1.13, 2);

ALTER TABLE public.dist_precios RENAME COLUMN precio_sin_iva TO precio_con_iva;
ALTER TABLE public.dist_precios ALTER COLUMN precio_con_iva TYPE numeric(12,2) USING round(precio_con_iva * 1.13, 2);

-- Los renglones de pedidos ya facturados guardan lo que se cobró: se llevan a
-- la nueva base con el mismo redondeo. El documento sellado no se toca (vive en
-- dist_dte.json), así que esto no cambia ningún dato fiscal.
ALTER TABLE public.dist_pedido_items RENAME COLUMN precio_sin_iva TO precio_con_iva;
ALTER TABLE public.dist_pedido_items ALTER COLUMN precio_con_iva TYPE numeric(12,2) USING round(precio_con_iva * 1.13, 2);
-- El juez frena cualquier UPDATE de un pedido ya facturado: se apaga sólo
-- mientras dura esta conversión.
ALTER TABLE public.dist_pedido_items DISABLE TRIGGER dist_pedido_items_validar;
UPDATE public.dist_pedido_items SET descuento = round(descuento * 1.13, 6) WHERE descuento <> 0;
ALTER TABLE public.dist_pedido_items ENABLE TRIGGER dist_pedido_items_validar;

-- ── El juez del renglón, en la nueva base ──────────────────────────────────
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

    -- Descuento, con IVA. En % el monto sale de acá, a centavos, con el mismo
    -- redondeo que la pantalla (`motor.js`: half-up).
    v_importe := NEW.cantidad * NEW.precio_con_iva;
    IF NEW.descuento_pct IS NOT NULL THEN
        NEW.descuento := round(v_importe * NEW.descuento_pct / 100, 2);
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
