-- ═══════════════════════════════════════════════════════════════════════════
-- Distribución · 0012 — reservar lo que está en una venta o preventa
-- ═══════════════════════════════════════════════════════════════════════════
-- Pedido del usuario (2026-09-29):
--   «me gustaría que se reservaran los productos si están en preventa, o en una
--    preventa en vivo alguien ya lo agregó (con un aviso si no hay más que diga
--    eso: tal vendedor lo está vendiendo). […] debe tener tiempo máximo,
--    30 min; si no, manda notificación.»
--
-- ── Cómo funciona ────────────────────────────────────────────────────────
-- Una RESERVA aparta unidades de un lote para una venta (la «sesión»: el
-- `client_uuid` de la venta, que existe desde que se abre la pantalla y es el
-- mismo al guardarla como preventa). La pantalla le manda a `dist_reservar`
-- el carrito entero cada vez que cambia; la función reemplaza lo reservado de
-- esa sesión por lo nuevo y devuelve, renglón por renglón, cuánto se pudo
-- apartar y QUIÉN tiene el resto.
--
-- ── Tiempo máximo: 30 minutos desde el primer producto ─────────────────────
-- El reloj arranca con el primer producto reservado de la venta y NO se
-- reinicia al seguir agregando ni al guardar la preventa: «tiempo máximo» es
-- eso. Al vencer, el cron `dist-vencer-reservas` las suelta y le avisa al
-- vendedor (campana + push) con el enlace para retomarla. Si después vuelve a
-- tocar esa venta, se reserva de nuevo lo que siga libre, con otro reloj.
--
-- ── Quién respeta las reservas ───────────────────────────────────────────
--   · la pantalla: lo libre de un lote descuenta lo reservado por OTRAS ventas;
--   · `dist_asignar_lotes` (al facturar): igual, así una venta no se lleva lo
--     que otra apartó; y al facturar suelta las reservas propias, porque la
--     existencia ya salió de verdad.
--   · anular el pedido suelta sus reservas.
--
-- ── Y de paso: rechazado o descartado devuelven la mercadería YA ───────────
-- Antes el pedido volvía a «por facturar» pero sus unidades seguían apartadas
-- hasta refacturarlo o anularlo. `distribucion-dte` ahora llama a
-- `dist_liberar_lotes` en el momento; para eso service_role necesita EXECUTE.

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.dist_reservas (
    id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    emisor_id    smallint NOT NULL REFERENCES public.dist_emisores(id),
    sesion       uuid NOT NULL,
    lote_id      bigint NOT NULL REFERENCES public.dist_lotes(id),
    product_id   integer NOT NULL,
    unidades     integer NOT NULL CHECK (unidades > 0),
    vendedor_id  uuid NOT NULL REFERENCES public.employees(id),
    cliente_id   bigint REFERENCES public.dist_clientes(id),
    pedido_id    bigint REFERENCES public.dist_pedidos(id),
    vence_at     timestamptz NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now(),
    UNIQUE (sesion, lote_id)
);
CREATE INDEX IF NOT EXISTS dist_reservas_lote ON public.dist_reservas (lote_id, vence_at);
CREATE INDEX IF NOT EXISTS dist_reservas_vence ON public.dist_reservas (vence_at);
CREATE INDEX IF NOT EXISTS dist_reservas_pedido ON public.dist_reservas (pedido_id) WHERE pedido_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS dist_reservas_cliente ON public.dist_reservas (cliente_id) WHERE cliente_id IS NOT NULL;

ALTER TABLE public.dist_reservas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS dist_reservas_select ON public.dist_reservas;
CREATE POLICY dist_reservas_select ON public.dist_reservas FOR SELECT TO authenticated
    USING ((SELECT public.auth_has_module_permission('distribucion', 'can_view')));
-- Sin policies de escritura: se escribe SÓLO por `dist_reservar` (DEFINER),
-- que firma con quien llama y serializa por lote.
REVOKE ALL ON public.dist_reservas FROM anon, authenticated;
GRANT SELECT ON public.dist_reservas TO authenticated;
GRANT ALL ON public.dist_reservas TO service_role;

-- ── Reservar: reemplaza lo de la sesión por el carrito de ahora ────────────
-- `p_renglones`: [{ "lote_id": n, "unidades": n }] (la pantalla ya suma por lote).
CREATE OR REPLACE FUNCTION public.dist_reservar(p_sesion uuid, p_cliente bigint, p_pedido bigint, p_renglones jsonb)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE
    v_yo      uuid := public.auth_employee_id();
    v_inicio  timestamptz;
    v_vence   timestamptz;
    r         record;
    l         record;
    v_otros   integer;
    v_toma    integer;
    v_quien   json;
    v_res     json[] := '{}';
BEGIN
    IF v_yo IS NULL OR NOT public.auth_can_edit_any(ARRAY['distribucion']) THEN
        RAISE EXCEPTION 'DIST_SIN_PERMISO: no puedes vender en Distribución';
    END IF;
    -- Una sesión es de UNA persona: nadie suelta ni pisa lo que apartó otro.
    IF EXISTS (SELECT 1 FROM public.dist_reservas WHERE sesion = p_sesion AND vendedor_id <> v_yo AND vence_at > now()) THEN
        RAISE EXCEPTION 'DIST_RESERVA_AJENA: esa venta la tiene abierta otra persona';
    END IF;
    -- El reloj: el del primer producto de esta venta, si sigue vigente.
    SELECT min(created_at) INTO v_inicio FROM public.dist_reservas WHERE sesion = p_sesion AND vence_at > now();
    v_inicio := coalesce(v_inicio, now());
    v_vence := v_inicio + interval '30 minutes';

    DELETE FROM public.dist_reservas WHERE sesion = p_sesion;

    FOR r IN
        SELECT (x->>'lote_id')::bigint AS lote_id, sum((x->>'unidades')::integer) AS unidades
          FROM jsonb_array_elements(coalesce(p_renglones, '[]'::jsonb)) x
         WHERE (x->>'lote_id') IS NOT NULL AND (x->>'unidades')::integer > 0
         GROUP BY 1 ORDER BY 1
    LOOP
        -- Bloquear el lote serializa a dos vendedores peleando la última caja.
        SELECT id, emisor_id, product_id, existencia INTO l FROM public.dist_lotes WHERE id = r.lote_id FOR UPDATE;
        CONTINUE WHEN NOT FOUND;
        SELECT coalesce(sum(unidades), 0) INTO v_otros FROM public.dist_reservas
         WHERE lote_id = l.id AND sesion <> p_sesion AND vence_at > now();
        v_toma := least(r.unidades, greatest(0, l.existencia - v_otros));
        IF v_toma > 0 THEN
            INSERT INTO public.dist_reservas (emisor_id, sesion, lote_id, product_id, unidades, vendedor_id, cliente_id, pedido_id, vence_at, created_at)
            VALUES (l.emisor_id, p_sesion, l.id, l.product_id, v_toma, v_yo, p_cliente, p_pedido, v_vence, v_inicio);
        END IF;
        SELECT coalesce(json_agg(json_build_object('vendedor_id', q.vendedor_id, 'nombre', e.name, 'unidades', q.u)), '[]'::json)
          INTO v_quien
          FROM (SELECT vendedor_id, sum(unidades) AS u FROM public.dist_reservas
                 WHERE lote_id = l.id AND sesion <> p_sesion AND vence_at > now() GROUP BY vendedor_id) q
          LEFT JOIN public.employees e ON e.id = q.vendedor_id;
        v_res := v_res || json_build_object('lote_id', l.id, 'product_id', l.product_id, 'pedidas', r.unidades,
                                            'reservadas', v_toma, 'existencia', l.existencia, 'otros', v_otros, 'quien', v_quien);
    END LOOP;

    RETURN json_build_object(
        'vence_at', CASE WHEN cardinality(v_res) > 0 AND EXISTS (SELECT 1 FROM public.dist_reservas WHERE sesion = p_sesion) THEN v_vence END,
        'renglones', array_to_json(v_res));
END $$;
REVOKE EXECUTE ON FUNCTION public.dist_reservar(uuid, bigint, bigint, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dist_reservar(uuid, bigint, bigint, jsonb) TO authenticated, service_role;

-- ── Lo reservado por todos, para pintar «reservado por…» ───────────────────
CREATE OR REPLACE FUNCTION public.dist_reservas_vigentes()
RETURNS json LANGUAGE sql STABLE
SET search_path = public, extensions AS $$
    SELECT coalesce(json_agg(json_build_object(
               'sesion', r.sesion, 'lote_id', r.lote_id, 'product_id', r.product_id, 'unidades', r.unidades,
               'vendedor_id', r.vendedor_id, 'nombre', e.name, 'cliente', c.nombre, 'vence_at', r.vence_at)), '[]'::json)
      FROM public.dist_reservas r
      LEFT JOIN public.employees e ON e.id = r.vendedor_id
      LEFT JOIN public.dist_clientes c ON c.id = r.cliente_id
     WHERE r.vence_at > now();
$$;
REVOKE EXECUTE ON FUNCTION public.dist_reservas_vigentes() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dist_reservas_vigentes() TO authenticated, service_role;

-- ── Vencer: soltar y avisar (cron cada minuto) ───────────────────────────
CREATE OR REPLACE FUNCTION public.dist_vencer_reservas()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE
    g       record;
    n       integer := 0;
    v_link  text;
    v_titulo text;
    v_cuerpo text;
BEGIN
    FOR g IN
        SELECT r.sesion, r.vendedor_id, max(r.pedido_id) AS pedido_id, max(c.nombre) AS cliente,
               count(*) AS lotes, sum(r.unidades) AS unidades
          FROM public.dist_reservas r LEFT JOIN public.dist_clientes c ON c.id = r.cliente_id
         WHERE r.vence_at <= now()
         GROUP BY r.sesion, r.vendedor_id
    LOOP
        v_link := CASE WHEN g.pedido_id IS NOT NULL THEN '/torogoz/venta/' || g.pedido_id ELSE '/torogoz/venta' END;
        v_titulo := 'Venció la reserva de tu venta';
        v_cuerpo := 'Pasaron 30 minutos: ' || g.unidades || ' unidades' || coalesce(' para ' || g.cliente, '')
                 || ' quedaron libres para otros vendedores. Ábrela para reservarlas de nuevo si todavía hay.';
        INSERT INTO public.notifications (recipient_id, type, title, body, link, metadata)
        VALUES (g.vendedor_id, 'RESERVA_VENCIDA', v_titulo, v_cuerpo, v_link,
                jsonb_build_object('sesion', g.sesion, 'pedido_id', g.pedido_id, 'unidades', g.unidades));
        BEGIN
            PERFORM net.http_post(
                url := public.push_function_url(), headers := public.push_function_headers(),
                body := jsonb_build_object('title', v_titulo, 'message', v_cuerpo, 'url', v_link,
                                           'target_type', 'EMPLOYEE', 'target_value', to_jsonb(ARRAY[g.vendedor_id])));
        EXCEPTION WHEN OTHERS THEN
            -- Sin push (p. ej. el entorno de pruebas sin secretos) queda la campana.
            RAISE NOTICE 'push de reserva vencida: %', SQLERRM;
        END;
        n := n + 1;
    END LOOP;
    DELETE FROM public.dist_reservas WHERE vence_at <= now();
    RETURN n;
END $$;
REVOKE EXECUTE ON FUNCTION public.dist_vencer_reservas() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dist_vencer_reservas() TO service_role;

-- Cron: SQL puro (sin HTTP hacia el origen), cada minuto. Crear sólo si no existe.
SELECT cron.schedule('dist-vencer-reservas', '* * * * *', 'SELECT public.dist_vencer_reservas()')
 WHERE NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'dist-vencer-reservas');

-- ── Anular el pedido suelta sus reservas ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.dist_reservas_al_anular()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
BEGIN
    IF NEW.estado = 'anulado' AND OLD.estado IS DISTINCT FROM 'anulado' THEN
        DELETE FROM public.dist_reservas WHERE pedido_id = NEW.id OR sesion = NEW.client_uuid;
    END IF;
    RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.dist_reservas_al_anular() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS dist_pedidos_suelta_reservas ON public.dist_pedidos;
CREATE TRIGGER dist_pedidos_suelta_reservas AFTER UPDATE OF estado ON public.dist_pedidos
    FOR EACH ROW EXECUTE FUNCTION public.dist_reservas_al_anular();

-- ── Liberar lotes desde la edge function (rechazado / descartado) ──────────
GRANT EXECUTE ON FUNCTION public.dist_liberar_lotes(bigint, text, bigint) TO service_role;

-- ── Facturar respeta las reservas de las OTRAS ventas ─────────────────────
-- Reescrita desde su definición VIVA (0010, entorno de pruebas 2026-09-29).
-- Cambios: lo disponible de cada lote descuenta lo reservado por otras
-- sesiones, y al terminar se sueltan las reservas propias.
CREATE OR REPLACE FUNCTION public.dist_asignar_lotes(p_pedido bigint)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_emisor   smallint;
    v_sesion   uuid;
    it         record;
    l          record;
    v_por      integer;     -- unidades por presentación
    v_falta    integer;     -- unidades que faltan asignar
    v_toma     integer;
    v_faltas   text[] := '{}';
BEGIN
    SELECT emisor_id, client_uuid INTO v_emisor, v_sesion FROM public.dist_pedidos WHERE id = p_pedido FOR UPDATE;
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
        -- después primero vence primero sale. Lo apartado por OTRA venta no está.
        FOR l IN
            SELECT dl.id, dl.existencia - coalesce((SELECT sum(r.unidades) FROM public.dist_reservas r
                                                    WHERE r.lote_id = dl.id AND r.vence_at > now()
                                                      AND r.sesion IS DISTINCT FROM v_sesion), 0) AS existencia
              FROM public.dist_lotes dl
             WHERE dl.emisor_id = v_emisor AND dl.product_id = it.product_id AND dl.existencia > 0
             ORDER BY (dl.id = it.lote_id) DESC NULLS LAST, dl.vence NULLS LAST, dl.id FOR UPDATE OF dl
        LOOP
            EXIT WHEN v_falta <= 0;
            CONTINUE WHEN l.existencia <= 0;
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
                SELECT dl.id, dl.existencia - coalesce((SELECT sum(r.unidades) FROM public.dist_reservas r
                                                        WHERE r.lote_id = dl.id AND r.vence_at > now()
                                                          AND r.sesion IS DISTINCT FROM v_sesion), 0) AS existencia
                  FROM public.dist_lotes dl
                 WHERE dl.emisor_id = v_emisor AND dl.product_id = it.product_id AND dl.existencia > 0
                 ORDER BY (dl.id = it.lote_id) DESC NULLS LAST, dl.vence NULLS LAST, dl.id FOR UPDATE OF dl
            LOOP
                EXIT WHEN v_falta <= 0;
                CONTINUE WHEN l.existencia <= 0;
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

    -- La existencia ya salió de verdad: la reserva de esta venta sobra.
    DELETE FROM public.dist_reservas WHERE sesion = v_sesion OR pedido_id = p_pedido;

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
