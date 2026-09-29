-- 0006 · Inventario por lote de la distribuidora (2026-09-28)
--
-- Pedido del usuario: el documento dice lote y vencimiento de cada producto, y
-- «si se vende de dos lotes se separa». La distribuidora tiene inventario
-- PROPIO (no el de Bodega: es otra empresa).
--
-- Cómo funciona:
--   · dist_lotes: la existencia, en UNIDADES, por producto + lote + vencimiento.
--   · dist_lote_movimientos: todo cambio de existencia, con su motivo. Es
--     historial de negocio: append-only, sin DELETE y sin purga.
--   · dist_lote_asignaciones: de qué lote salió cada renglón de un pedido.
--   · La existencia SÓLO cambia por funciones: nadie la escribe desde el
--     navegador. Así cada unidad que entra o sale deja su movimiento.
--
-- El lote se asigna al FACTURAR (dist_asignar_lotes, la llama distribucion-dte),
-- no al tomar el pedido: entre una cosa y otra el pedido se puede corregir, y
-- una reserva hecha antes quedaría apuntando a renglones que ya no son.
-- Primero vence, primero sale; una presentación no se parte entre lotes (una
-- caja es de un lote). Si no alcanza, NO factura y dice cuánto falta.
--
-- Depende de 0004 (dist_pedido_items.unidades = unidades por presentación).
-- Probado en staging con execute_sql (nunca apply_migration en el branch).

SET lock_timeout = '5s';

-- ── Tablas ────────────────────────────────────────────────────────────────
CREATE TABLE public.dist_lotes (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    emisor_id   smallint NOT NULL REFERENCES public.dist_emisores(id),
    product_id  integer  NOT NULL REFERENCES public.products(id),
    lote        text     NOT NULL CHECK (btrim(lote) <> ''),
    vence       date,
    existencia  integer  NOT NULL DEFAULT 0 CHECK (existencia >= 0),
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);
-- Un mismo lote con otro vencimiento es un error de captura, no otro lote:
-- la clave es producto + lote, y el vencimiento se corrige con un ajuste.
CREATE UNIQUE INDEX dist_lotes_unico ON public.dist_lotes (emisor_id, product_id, upper(btrim(lote)));
CREATE INDEX dist_lotes_producto_vence ON public.dist_lotes (product_id, vence) WHERE existencia > 0;

CREATE TABLE public.dist_lote_movimientos (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    lote_id     bigint  NOT NULL REFERENCES public.dist_lotes(id),
    tipo        text    NOT NULL CHECK (tipo IN ('entrada','ajuste','venta','liberacion','devolucion')),
    -- Con signo: + entra, − sale. Cero sólo en un ajuste que corrige la fecha.
    cantidad    integer NOT NULL CHECK (cantidad <> 0 OR tipo = 'ajuste'),
    existencia_despues integer NOT NULL,
    pedido_id   bigint REFERENCES public.dist_pedidos(id),
    dte_id      bigint REFERENCES public.dist_dte(id),
    nota        text,
    creado_por  uuid   DEFAULT public.auth_employee_id() REFERENCES public.employees(id),
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX dist_lote_movimientos_lote ON public.dist_lote_movimientos (lote_id, created_at DESC);
CREATE INDEX dist_lote_movimientos_pedido ON public.dist_lote_movimientos (pedido_id) WHERE pedido_id IS NOT NULL;
CREATE INDEX dist_lote_movimientos_dte ON public.dist_lote_movimientos (dte_id) WHERE dte_id IS NOT NULL;

CREATE TABLE public.dist_lote_asignaciones (
    id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    pedido_id      bigint NOT NULL REFERENCES public.dist_pedidos(id),
    item_id        bigint NOT NULL REFERENCES public.dist_pedido_items(id) ON DELETE CASCADE,
    lote_id        bigint NOT NULL REFERENCES public.dist_lotes(id),
    unidades       integer NOT NULL CHECK (unidades > 0),
    -- Cuántas presentaciones del renglón salen de este lote (lo que va al DTE).
    cantidad       numeric(14,4) NOT NULL CHECK (cantidad > 0),
    dte_id         bigint REFERENCES public.dist_dte(id),
    -- Vuelve al inventario cuando el documento se invalida o el pedido se anula.
    devuelta_at    timestamptz,
    created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX dist_lote_asignaciones_pedido ON public.dist_lote_asignaciones (pedido_id) WHERE devuelta_at IS NULL;
CREATE INDEX dist_lote_asignaciones_item ON public.dist_lote_asignaciones (item_id);
CREATE INDEX dist_lote_asignaciones_lote ON public.dist_lote_asignaciones (lote_id);
CREATE INDEX dist_lote_asignaciones_dte ON public.dist_lote_asignaciones (dte_id) WHERE dte_id IS NOT NULL;

CREATE TRIGGER dist_lotes_updated_at BEFORE UPDATE ON public.dist_lotes
    FOR EACH ROW EXECUTE FUNCTION public.dist_tocar_updated_at();

-- ── RLS: se lee con el permiso del módulo; se escribe sólo por funciones ──
ALTER TABLE public.dist_lotes             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dist_lote_movimientos  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dist_lote_asignaciones ENABLE ROW LEVEL SECURITY;
CREATE POLICY dist_lotes_select ON public.dist_lotes FOR SELECT TO authenticated
    USING ((SELECT public.auth_has_module_permission('distribucion', 'can_view')));
CREATE POLICY dist_lote_movimientos_select ON public.dist_lote_movimientos FOR SELECT TO authenticated
    USING ((SELECT public.auth_has_module_permission('distribucion', 'can_view')));
CREATE POLICY dist_lote_asignaciones_select ON public.dist_lote_asignaciones FOR SELECT TO authenticated
    USING ((SELECT public.auth_has_module_permission('distribucion', 'can_view')));
-- En este proyecto una tabla nueva NO nace con SELECT para authenticated, y
-- sí con TRUNCATE/REFERENCES/TRIGGER (medido al probar: «permission denied»
-- al leer, y TRUNCATE —que salta el RLS— concedido). Por eso se revoca todo y
-- se da exactamente lo que hace falta.
REVOKE ALL ON public.dist_lotes, public.dist_lote_movimientos, public.dist_lote_asignaciones FROM anon, authenticated;
GRANT SELECT ON public.dist_lotes, public.dist_lote_movimientos, public.dist_lote_asignaciones TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dist_lotes, public.dist_lote_movimientos, public.dist_lote_asignaciones TO service_role;

-- ── El único sitio donde cambia la existencia ─────────────────────────────
CREATE OR REPLACE FUNCTION public.dist_mover_lote(
    p_lote bigint, p_cantidad integer, p_tipo text,
    p_pedido bigint DEFAULT NULL, p_dte bigint DEFAULT NULL, p_nota text DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE v_queda integer;
BEGIN
    UPDATE public.dist_lotes SET existencia = existencia + p_cantidad
     WHERE id = p_lote RETURNING existencia INTO v_queda;
    IF NOT FOUND THEN RAISE EXCEPTION 'no existe el lote %', p_lote; END IF;
    INSERT INTO public.dist_lote_movimientos (lote_id, tipo, cantidad, existencia_despues, pedido_id, dte_id, nota)
    VALUES (p_lote, p_tipo, p_cantidad, v_queda, p_pedido, p_dte, p_nota);
    RETURN v_queda;
END $$;
REVOKE EXECUTE ON FUNCTION public.dist_mover_lote(bigint, integer, text, bigint, bigint, text) FROM PUBLIC, anon, authenticated;

-- Devuelve al inventario lo asignado a un pedido que no terminó en venta.
CREATE OR REPLACE FUNCTION public.dist_liberar_lotes(p_pedido bigint, p_tipo text DEFAULT 'liberacion', p_solo_dte bigint DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE a record; n integer := 0;
BEGIN
    FOR a IN
        SELECT id, lote_id, unidades, dte_id FROM public.dist_lote_asignaciones
         WHERE pedido_id = p_pedido AND devuelta_at IS NULL
           AND (p_solo_dte IS NULL OR dte_id = p_solo_dte)
         ORDER BY id FOR UPDATE
    LOOP
        PERFORM public.dist_mover_lote(a.lote_id, a.unidades, p_tipo, p_pedido, a.dte_id, NULL);
        UPDATE public.dist_lote_asignaciones SET devuelta_at = now() WHERE id = a.id;
        n := n + 1;
    END LOOP;
    RETURN n;
END $$;
REVOKE EXECUTE ON FUNCTION public.dist_liberar_lotes(bigint, text, bigint) FROM PUBLIC, anon, authenticated;

-- ── Asignar lotes al facturar ─────────────────────────────────────────────
-- Lo llama distribucion-dte (service_role) justo antes de reservar número.
-- Idempotente: suelta lo que el pedido tenía reservado sin documento vivo y
-- vuelve a asignar contra los renglones de AHORA.
CREATE OR REPLACE FUNCTION public.dist_asignar_lotes(p_pedido bigint)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
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
        SELECT i.id, i.product_id, i.cantidad, i.descripcion, greatest(coalesce(i.unidades, 1), 1) AS por
          FROM public.dist_pedido_items i WHERE i.pedido_id = p_pedido ORDER BY i.id
    LOOP
        v_por := it.por;
        v_falta := ceil(it.cantidad * v_por)::integer;
        -- 1ª pasada: presentaciones enteras, primero vence primero sale.
        FOR l IN
            SELECT id, existencia FROM public.dist_lotes
             WHERE emisor_id = v_emisor AND product_id = it.product_id AND existencia > 0
             ORDER BY vence NULLS LAST, id FOR UPDATE
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
                 ORDER BY vence NULLS LAST, id FOR UPDATE
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
END $$;
REVOKE EXECUTE ON FUNCTION public.dist_asignar_lotes(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dist_asignar_lotes(bigint) TO service_role;

-- ── Devoluciones automáticas ──────────────────────────────────────────────
-- Documento invalidado ante Hacienda → sus unidades vuelven.
CREATE OR REPLACE FUNCTION public.dist_lotes_al_invalidar()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
BEGIN
    IF NEW.estado = 'invalidado' AND OLD.estado IS DISTINCT FROM 'invalidado' AND NEW.pedido_id IS NOT NULL THEN
        PERFORM public.dist_liberar_lotes(NEW.pedido_id, 'devolucion', NEW.id);
    END IF;
    RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.dist_lotes_al_invalidar() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER dist_dte_devuelve_lotes AFTER UPDATE OF estado ON public.dist_dte
    FOR EACH ROW EXECUTE FUNCTION public.dist_lotes_al_invalidar();

-- Pedido anulado → lo reservado sin documento vivo vuelve.
CREATE OR REPLACE FUNCTION public.dist_lotes_al_anular()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
BEGIN
    IF NEW.estado = 'anulado' AND OLD.estado IS DISTINCT FROM 'anulado' THEN
        PERFORM public.dist_mover_lote(a.lote_id, a.unidades, 'liberacion', NEW.id, a.dte_id, 'pedido anulado')
           FROM public.dist_lote_asignaciones a LEFT JOIN public.dist_dte d ON d.id = a.dte_id
          WHERE a.pedido_id = NEW.id AND a.devuelta_at IS NULL
            AND (a.dte_id IS NULL OR d.estado IN ('descartado','rechazado'));
        UPDATE public.dist_lote_asignaciones a SET devuelta_at = now()
          FROM public.dist_lote_asignaciones x LEFT JOIN public.dist_dte d ON d.id = x.dte_id
         WHERE a.id = x.id AND a.pedido_id = NEW.id AND a.devuelta_at IS NULL
           AND (x.dte_id IS NULL OR d.estado IN ('descartado','rechazado'));
    END IF;
    RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.dist_lotes_al_anular() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER dist_pedidos_libera_lotes AFTER UPDATE OF estado ON public.dist_pedidos
    FOR EACH ROW EXECUTE FUNCTION public.dist_lotes_al_anular();

-- ── Lo que usa la pantalla de inventario ──────────────────────────────────
-- Entrada: un lote nuevo, o más unidades de uno que ya existe.
CREATE OR REPLACE FUNCTION public.dist_lote_entrada(
    p_emisor smallint, p_producto integer, p_lote text, p_vence date, p_unidades integer, p_nota text DEFAULT NULL)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE v_id bigint; v_vence date; v_queda integer;
BEGIN
    IF NOT (SELECT public.auth_can_edit_any(ARRAY['distribucion'])) THEN
        RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
    END IF;
    IF p_unidades IS NULL OR p_unidades <= 0 THEN RAISE EXCEPTION 'La cantidad tiene que ser mayor que cero.'; END IF;
    IF btrim(coalesce(p_lote, '')) = '' THEN RAISE EXCEPTION 'Falta el número de lote.'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.dist_catalogo WHERE emisor_id = p_emisor AND product_id = p_producto) THEN
        RAISE EXCEPTION 'Ese producto no está en el catálogo de la distribuidora.';
    END IF;

    SELECT id, vence INTO v_id, v_vence FROM public.dist_lotes
     WHERE emisor_id = p_emisor AND product_id = p_producto AND upper(btrim(lote)) = upper(btrim(p_lote))
     FOR UPDATE;
    IF v_id IS NULL THEN
        INSERT INTO public.dist_lotes (emisor_id, product_id, lote, vence)
        VALUES (p_emisor, p_producto, upper(btrim(p_lote)), p_vence) RETURNING id INTO v_id;
    ELSIF v_vence IS DISTINCT FROM p_vence THEN
        RAISE EXCEPTION 'El lote % ya existe con vencimiento %. Si está mal, corrígelo con un ajuste.',
            upper(btrim(p_lote)), coalesce(to_char(v_vence, 'DD/MM/YYYY'), 'sin fecha');
    END IF;
    v_queda := public.dist_mover_lote(v_id, p_unidades, 'entrada', NULL, NULL, nullif(btrim(coalesce(p_nota, '')), ''));
    RETURN json_build_object('lote_id', v_id, 'existencia', v_queda);
END $$;
REVOKE EXECUTE ON FUNCTION public.dist_lote_entrada(smallint, integer, text, date, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dist_lote_entrada(smallint, integer, text, date, integer, text) TO authenticated, service_role;

-- Ajuste: la existencia que se contó, y/o el vencimiento corregido. Con motivo.
CREATE OR REPLACE FUNCTION public.dist_lote_ajustar(p_lote bigint, p_existencia integer, p_vence date, p_nota text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE v_antes integer; v_vence date; v_queda integer;
BEGIN
    IF NOT (SELECT public.auth_can_edit_any(ARRAY['distribucion_config'])) THEN
        RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
    END IF;
    IF btrim(coalesce(p_nota, '')) = '' THEN RAISE EXCEPTION 'Un ajuste necesita su motivo.'; END IF;
    IF p_existencia IS NULL OR p_existencia < 0 THEN RAISE EXCEPTION 'La existencia no puede ser negativa.'; END IF;
    SELECT existencia, vence INTO v_antes, v_vence FROM public.dist_lotes WHERE id = p_lote FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'No existe ese lote.'; END IF;
    IF v_vence IS DISTINCT FROM p_vence THEN
        UPDATE public.dist_lotes SET vence = p_vence WHERE id = p_lote;
    END IF;
    v_queda := v_antes;
    IF p_existencia <> v_antes OR v_vence IS DISTINCT FROM p_vence THEN
        v_queda := public.dist_mover_lote(p_lote, p_existencia - v_antes, 'ajuste', NULL, NULL,
            btrim(p_nota) || CASE WHEN v_vence IS DISTINCT FROM p_vence
                THEN format(' (vencimiento %s → %s)', coalesce(to_char(v_vence,'DD/MM/YYYY'),'—'), coalesce(to_char(p_vence,'DD/MM/YYYY'),'—')) ELSE '' END);
    END IF;
    RETURN json_build_object('lote_id', p_lote, 'existencia', v_queda);
END $$;
REVOKE EXECUTE ON FUNCTION public.dist_lote_ajustar(bigint, integer, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dist_lote_ajustar(bigint, integer, date, text) TO authenticated, service_role;
