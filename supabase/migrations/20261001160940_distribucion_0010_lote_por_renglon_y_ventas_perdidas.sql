-- ═══════════════════════════════════════════════════════════════════════════
-- Distribución · 0010 — el lote se ve en la venta, y las ventas perdidas
-- ═══════════════════════════════════════════════════════════════════════════
-- Pedido del usuario (2026-09-29):
--   «que salga según el vence […] si del lote 1 hay 1 unidad y pongo que voy
--    a vender 3, que se agregue el producto abajo con el siguiente lote
--    disponible. Debe salir también el total en stock y por lote.»
--   «agregar ventas perdidas: si ingreso un producto y no hay stock […] o la
--    ventana para agregar un producto (que busque en la SRS si es medicamento,
--    o si es insumo que mande el nombre).»
--
-- ── 1 · El lote del renglón ─────────────────────────────────────────────────
-- Hasta ahora el lote se decidía SÓLO al facturar (0006). La pantalla ahora
-- lo elige —primero vence, primero sale— y reparte en el siguiente lote lo que
-- no alcanza, así que cada renglón lleva `lote_id`.
--
-- Al facturar, el lote del renglón es una PREFERENCIA, no un candado: entre la
-- preventa y la factura pueden pasar días y otra venta llevarse ese lote. Si
-- ya no alcanza, `dist_asignar_lotes` completa con el siguiente por
-- vencimiento, igual que antes. Un candado aquí trabaría la factura por un
-- dato viejo; la preferencia respeta lo que se vio en pantalla cuando se puede.
--
-- La clave del renglón pasa a producto + presentación + LOTE: el mismo
-- producto en dos lotes son dos renglones (así sale en el documento). Sin lote
-- (producto sin existencia) sigue siendo uno: NULLS NOT DISTINCT.

SET lock_timeout = '5s';

ALTER TABLE public.dist_pedido_items
    ADD COLUMN IF NOT EXISTS lote_id bigint REFERENCES public.dist_lotes(id);
CREATE INDEX IF NOT EXISTS dist_pedido_items_lote ON public.dist_pedido_items (lote_id) WHERE lote_id IS NOT NULL;

ALTER TABLE public.dist_pedido_items DROP CONSTRAINT IF EXISTS dist_pedido_items_renglon_unico;
ALTER TABLE public.dist_pedido_items ADD CONSTRAINT dist_pedido_items_renglon_unico
    UNIQUE NULLS NOT DISTINCT (pedido_id, product_id, presentacion, lote_id);

-- El lote tiene que ser DEL producto (y de la misma empresa): un id cruzado
-- sacaría existencia de otro artículo sin dar error.
CREATE OR REPLACE FUNCTION public.dist_validar_lote_item()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE
    v_ok boolean;
BEGIN
    IF NEW.lote_id IS NULL THEN RETURN NEW; END IF;
    SELECT EXISTS (
        SELECT 1 FROM public.dist_lotes l JOIN public.dist_pedidos p ON p.id = NEW.pedido_id
         WHERE l.id = NEW.lote_id AND l.product_id = NEW.product_id AND l.emisor_id = p.emisor_id
    ) INTO v_ok;
    IF NOT v_ok THEN
        RAISE EXCEPTION 'DIST_LOTE_AJENO: el lote % no es de ese producto', NEW.lote_id;
    END IF;
    RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.dist_validar_lote_item() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS dist_pedido_items_lote ON public.dist_pedido_items;
CREATE TRIGGER dist_pedido_items_lote
    BEFORE INSERT OR UPDATE OF lote_id, product_id ON public.dist_pedido_items
    FOR EACH ROW EXECUTE FUNCTION public.dist_validar_lote_item();

-- Reescrita desde su definición VIVA (pg_get_functiondef, entorno de pruebas
-- 2026-09-29). Único cambio: las dos pasadas recorren primero el lote del
-- renglón (`it.lote_id`) y después el resto por vencimiento.
CREATE OR REPLACE FUNCTION public.dist_asignar_lotes(p_pedido bigint)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_emisor   smallint;
    it         record;
    l          record;
    v_por      integer;     -- unidades por presentación
    v_falta    integer;     -- unidades que faltan asignar
    v_toma     integer;
    v_faltas   text[] := '{}';
BEGIN
    SELECT emisor_id INTO v_emisor FROM public.dist_pedidos WHERE id = p_pedido FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'no existe el pedido %', p_pedido; END IF;

    -- Lo reservado por un intento anterior (sin documento, o con uno
    -- descartado o rechazado) vuelve primero al inventario.
    PERFORM public.dist_mover_lote(a.lote_id, a.unidades, 'liberacion', p_pedido, a.dte_id, 'reasignación al facturar')
       FROM public.dist_lote_asignaciones a
       LEFT JOIN public.dist_dte d ON d.id = a.dte_id
      WHERE a.pedido_id = p_pedido AND a.devuelta_at IS NULL
        AND (a.dte_id IS NULL OR d.estado IN ('descartado','rechazado'));
    UPDATE public.dist_lote_asignaciones a SET devuelta_at = now()
      FROM public.dist_lote_asignaciones x LEFT JOIN public.dist_dte d ON d.id = x.dte_id
     WHERE a.id = x.id AND a.pedido_id = p_pedido AND a.devuelta_at IS NULL
       AND (x.dte_id IS NULL OR d.estado IN ('descartado','rechazado'));

    FOR it IN
        SELECT i.id, i.product_id, i.cantidad, i.descripcion, i.lote_id, greatest(coalesce(i.unidades, 1), 1) AS por
          FROM public.dist_pedido_items i WHERE i.pedido_id = p_pedido ORDER BY i.id
    LOOP
        v_por := it.por;
        v_falta := ceil(it.cantidad * v_por)::integer;
        -- 1ª pasada: presentaciones enteras; el lote del renglón primero, y
        -- después primero vence primero sale.
        FOR l IN
            SELECT id, existencia FROM public.dist_lotes
             WHERE emisor_id = v_emisor AND product_id = it.product_id AND existencia > 0
             ORDER BY (id = it.lote_id) DESC NULLS LAST, vence NULLS LAST, id FOR UPDATE
        LOOP
            EXIT WHEN v_falta <= 0;
            v_toma := least(v_falta - (v_falta % v_por), (l.existencia / v_por) * v_por);
            IF v_toma > 0 THEN
                PERFORM public.dist_mover_lote(l.id, -v_toma, 'venta', p_pedido, NULL, NULL);
                INSERT INTO public.dist_lote_asignaciones (pedido_id, item_id, lote_id, unidades, cantidad)
                VALUES (p_pedido, it.id, l.id, v_toma, round(v_toma::numeric / v_por, 4));
                v_falta := v_falta - v_toma;
            END IF;
        END LOOP;
        -- 2ª pasada: lo que no llena una presentación (venta fraccionada).
        IF v_falta > 0 THEN
            FOR l IN
                SELECT id, existencia FROM public.dist_lotes
                 WHERE emisor_id = v_emisor AND product_id = it.product_id AND existencia > 0
                 ORDER BY (id = it.lote_id) DESC NULLS LAST, vence NULLS LAST, id FOR UPDATE
            LOOP
                EXIT WHEN v_falta <= 0;
                v_toma := least(v_falta, l.existencia);
                PERFORM public.dist_mover_lote(l.id, -v_toma, 'venta', p_pedido, NULL, NULL);
                INSERT INTO public.dist_lote_asignaciones (pedido_id, item_id, lote_id, unidades, cantidad)
                VALUES (p_pedido, it.id, l.id, v_toma, round(v_toma::numeric / v_por, 4));
                v_falta := v_falta - v_toma;
            END LOOP;
        END IF;
        IF v_falta > 0 THEN
            v_faltas := v_faltas || format('%s (faltan %s unidades)', it.descripcion, v_falta);
        END IF;
    END LOOP;

    IF cardinality(v_faltas) > 0 THEN
        -- La excepción deshace TODO lo de arriba: no queda nada reservado a medias.
        RAISE EXCEPTION 'Sin existencia suficiente: %', array_to_string(v_faltas, '; ')
            USING ERRCODE = 'P0001';
    END IF;

    RETURN (
        SELECT coalesce(json_agg(json_build_object(
                   'id', a.id, 'item_id', a.item_id, 'lote', dl.lote, 'vence', dl.vence,
                   'unidades', a.unidades, 'cantidad', a.cantidad) ORDER BY a.item_id, dl.vence NULLS LAST, a.id), '[]'::json)
          FROM public.dist_lote_asignaciones a JOIN public.dist_lotes dl ON dl.id = a.lote_id
         WHERE a.pedido_id = p_pedido AND a.devuelta_at IS NULL AND a.dte_id IS NULL
    );
END $function$;
REVOKE EXECUTE ON FUNCTION public.dist_asignar_lotes(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dist_asignar_lotes(bigint) TO service_role;

-- ── 2 · Ventas perdidas de la distribuidora ─────────────────────────────────
-- Tabla propia y no `ventas_perdidas` de las farmacias: esa lleva la SUCURSAL
-- (`branch_id`) y la mira el portal de las farmacias; ésta es de la otra
-- empresa y va con su CLIENTE. Lo que se pidió y no se pudo vender es la
-- lista de compras de la distribuidora.
--
-- `origen` dice de dónde salió el nombre, porque de eso depende qué tan
-- confiable es:
--   catalogo      — un producto del catálogo que no tenía existencia
--   srs           — un medicamento buscado en el registro de la SRS
--   insumo        — un insumo escrito a mano (no está en la SRS)
CREATE TABLE IF NOT EXISTS public.dist_ventas_perdidas (
    id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    emisor_id        smallint NOT NULL REFERENCES public.dist_emisores(id),
    cliente_id       bigint REFERENCES public.dist_clientes(id),
    product_id       integer,
    pedido_id        bigint REFERENCES public.dist_pedidos(id),
    origen           text NOT NULL CHECK (origen IN ('catalogo','srs','insumo')),
    producto         text NOT NULL CHECK (btrim(producto) <> ''),
    registro_srs     text,
    principio_activo text,
    laboratorio      text,
    buscado          text,
    cantidad         numeric(12,4) NOT NULL CHECK (cantidad > 0),
    estado           text NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','atendida','descartada')),
    nota             text,
    reportado_por    uuid NOT NULL DEFAULT public.auth_employee_id() REFERENCES public.employees(id),
    resuelto_por     uuid REFERENCES public.employees(id),
    resuelto_at      timestamptz,
    created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS dist_ventas_perdidas_emisor ON public.dist_ventas_perdidas (emisor_id, estado, created_at DESC);
CREATE INDEX IF NOT EXISTS dist_ventas_perdidas_cliente ON public.dist_ventas_perdidas (cliente_id) WHERE cliente_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS dist_ventas_perdidas_pedido ON public.dist_ventas_perdidas (pedido_id) WHERE pedido_id IS NOT NULL;

ALTER TABLE public.dist_ventas_perdidas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS dist_ventas_perdidas_select ON public.dist_ventas_perdidas;
CREATE POLICY dist_ventas_perdidas_select ON public.dist_ventas_perdidas FOR SELECT TO authenticated
    USING ((SELECT public.auth_has_module_permission('distribucion', 'can_view')));
-- Anota quien vende, y a su nombre: nadie reporta por otro.
DROP POLICY IF EXISTS dist_ventas_perdidas_insert ON public.dist_ventas_perdidas;
CREATE POLICY dist_ventas_perdidas_insert ON public.dist_ventas_perdidas FOR INSERT TO authenticated
    WITH CHECK ((SELECT public.auth_can_edit_any(ARRAY['distribucion']))
                AND reportado_por = (SELECT public.auth_employee_id())
                AND estado = 'pendiente');
-- Marcarla atendida o descartarla es de quien administra (compras).
DROP POLICY IF EXISTS dist_ventas_perdidas_update ON public.dist_ventas_perdidas;
CREATE POLICY dist_ventas_perdidas_update ON public.dist_ventas_perdidas FOR UPDATE TO authenticated
    USING ((SELECT public.auth_can_edit_any(ARRAY['distribucion_config'])))
    WITH CHECK ((SELECT public.auth_can_edit_any(ARRAY['distribucion_config'])));

REVOKE ALL ON public.dist_ventas_perdidas FROM anon, authenticated;
GRANT SELECT, INSERT ON public.dist_ventas_perdidas TO authenticated;
GRANT UPDATE (estado, nota) ON public.dist_ventas_perdidas TO authenticated;

-- Quién y cuándo la resolvió lo pone la base, no la pantalla.
CREATE OR REPLACE FUNCTION public.dist_ventas_perdidas_resolver()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
BEGIN
    IF NEW.estado IS DISTINCT FROM OLD.estado THEN
        NEW.resuelto_por := CASE WHEN NEW.estado = 'pendiente' THEN NULL ELSE public.auth_employee_id() END;
        NEW.resuelto_at  := CASE WHEN NEW.estado = 'pendiente' THEN NULL ELSE now() END;
    END IF;
    RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.dist_ventas_perdidas_resolver() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS dist_ventas_perdidas_resolver ON public.dist_ventas_perdidas;
CREATE TRIGGER dist_ventas_perdidas_resolver BEFORE UPDATE ON public.dist_ventas_perdidas
    FOR EACH ROW EXECUTE FUNCTION public.dist_ventas_perdidas_resolver();
GRANT ALL ON public.dist_ventas_perdidas TO service_role;
