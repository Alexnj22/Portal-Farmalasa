SET lock_timeout = '5s';

-- Distribución · H2 · el dinero de un documento invalidado o corregido (1 de 2).
--
-- Al invalidarse un documento, su cuenta por cobrar pasaba a «anulada» sin
-- mirar lo abonado, y no existía saldo a favor. Decisión del dueño
-- (2026-10-22): «si se anula una venta en efectivo, sale de caja y se le
-- regresa el dinero, si se anula uno de tarjeta, transferencia, etc, a saldo
-- de cliente.» Y el saldo a favor se usa como PAGO PARCIAL de cualquier cuenta
-- del cliente; es UN solo número por cliente, que suma también lo que dejó a
-- favor una nota de crédito por devolución.
--
--   · ANULAR (sin reemplazo): todo lo cobrado se reintegra — efectivo sale de
--     la caja del vendedor, cualquier otra forma queda a favor del cliente.
--   · CORREGIR (con reemplazo): los abonos pasan a la cuenta nueva; lo que no
--     cabe se reintegra. Lo pagado al vender lo lleva el reemplazo; sólo vuelve
--     lo que el nuevo trae de MENOS, forma por forma.
--   · REFACTURAR tras rechazo o descarte: los abonos pasan a la cuenta nueva.
--
-- Esta parte: las dos tablas, el saldo a favor y el reintegro. La parte 2
-- (`dist_dinero_de_documentos_invalidados_2_cuenta_y_liquidacion`) cambia el
-- trigger de la cuenta, la liquidación y el estado de cuenta.
--
-- Hoy distribución tiene 0 documentos, 0 cuentas y 0 recibos en producción.

CREATE TABLE IF NOT EXISTS public.dist_reintegros (
    id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    emisor_id    smallint NOT NULL REFERENCES public.dist_emisores(id),
    cliente_id   bigint   NOT NULL REFERENCES public.dist_clientes(id),
    -- El documento invalidado que lo originó.
    dte_id       bigint   NOT NULL REFERENCES public.dist_dte(id),
    -- 'pago': lo pagado al vender · 'abono': un cobro posterior a la cuenta.
    origen       text     NOT NULL CHECK (origen IN ('pago', 'abono')),
    -- Renglón de `resumen.pagos` del documento: lo cobrado al vender sale del
    -- documento mismo (es lo que Hacienda selló), no de dist_pagos, que puede
    -- no tener filas cuando el pedido se cobró con su forma de pago a secas.
    pago_orden   smallint,
    recibo_id    bigint   REFERENCES public.dist_recibos(id),
    forma        text     NOT NULL,
    destino      text     NOT NULL CHECK (destino IN ('caja', 'saldo')),
    monto        numeric(12,2) NOT NULL CHECK (monto > 0),
    -- De qué caja sale el efectivo: la del vendedor de la venta.
    vendedor_id  uuid     REFERENCES public.employees(id),
    fecha        date     NOT NULL DEFAULT ((now() AT TIME ZONE 'America/El_Salvador')::date),
    creado_por   uuid     REFERENCES public.employees(id),
    created_at   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT dist_reintegros_efectivo_a_caja CHECK ((destino = 'caja') = (forma = '01')),
    CONSTRAINT dist_reintegros_caja_con_vendedor CHECK (destino <> 'caja' OR vendedor_id IS NOT NULL),
    CONSTRAINT dist_reintegros_origen CHECK ((origen = 'pago') = (pago_orden IS NOT NULL) AND (origen = 'abono') = (recibo_id IS NOT NULL))
);
COMMENT ON TABLE public.dist_reintegros IS
  'Dinero que vuelve al cliente por un documento invalidado: efectivo que sale de la caja del vendedor, o saldo a favor.';

-- Un mismo pago o recibo no se reintegra dos veces por el mismo documento.
CREATE UNIQUE INDEX IF NOT EXISTS dist_reintegros_una_vez
    ON public.dist_reintegros (dte_id, origen, coalesce(pago_orden::bigint, recibo_id));
CREATE INDEX IF NOT EXISTS dist_reintegros_cliente ON public.dist_reintegros (cliente_id);
CREATE INDEX IF NOT EXISTS dist_reintegros_recibo ON public.dist_reintegros (recibo_id) WHERE recibo_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS dist_reintegros_caja ON public.dist_reintegros (vendedor_id, fecha) WHERE destino = 'caja';
CREATE INDEX IF NOT EXISTS dist_reintegros_emisor ON public.dist_reintegros (emisor_id);

CREATE TABLE IF NOT EXISTS public.dist_saldo_aplicaciones (
    id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    emisor_id      smallint NOT NULL REFERENCES public.dist_emisores(id),
    cliente_id     bigint   NOT NULL REFERENCES public.dist_clientes(id),
    cxc_id         bigint   NOT NULL REFERENCES public.dist_cxc(id),
    monto          numeric(12,2) NOT NULL CHECK (monto > 0),
    nota           text,
    creado_por     uuid     NOT NULL DEFAULT public.auth_employee_id() REFERENCES public.employees(id),
    created_at     timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.dist_saldo_aplicaciones IS
  'Saldo a favor de un cliente usado para pagar una de sus cuentas.';
CREATE INDEX IF NOT EXISTS dist_saldo_aplicaciones_cliente ON public.dist_saldo_aplicaciones (cliente_id);
CREATE INDEX IF NOT EXISTS dist_saldo_aplicaciones_cxc ON public.dist_saldo_aplicaciones (cxc_id);
CREATE INDEX IF NOT EXISTS dist_saldo_aplicaciones_emisor ON public.dist_saldo_aplicaciones (emisor_id);

-- Sólo lectura desde la API; se escriben por funciones DEFINER.
ALTER TABLE public.dist_reintegros ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dist_saldo_aplicaciones ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.dist_reintegros, public.dist_saldo_aplicaciones FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.dist_reintegros, public.dist_saldo_aplicaciones FROM authenticated;
GRANT SELECT ON public.dist_reintegros, public.dist_saldo_aplicaciones TO authenticated;
DROP POLICY IF EXISTS dist_reintegros_select ON public.dist_reintegros;
CREATE POLICY dist_reintegros_select ON public.dist_reintegros FOR SELECT TO authenticated
    USING ((SELECT public.auth_has_module_permission('distribucion', 'can_view')));
DROP POLICY IF EXISTS dist_saldo_aplicaciones_select ON public.dist_saldo_aplicaciones;
CREATE POLICY dist_saldo_aplicaciones_select ON public.dist_saldo_aplicaciones FOR SELECT TO authenticated
    USING ((SELECT public.auth_has_module_permission('distribucion', 'can_view')));

CREATE OR REPLACE FUNCTION public.dist_saldo_a_favor(p_cliente bigint)
 RETURNS numeric
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
    -- Tres fuentes, un número: lo que volvió de un documento invalidado, lo
    -- que dejó una nota de crédito por devolución (sólo la parte que NO se
    -- aplicó a la deuda: `a_favor` ya es total − credito_aplicado), menos lo
    -- que ya se usó para pagar.
    SELECT round(
        coalesce((SELECT sum(monto) FROM public.dist_reintegros WHERE cliente_id = p_cliente AND destino = 'saldo'), 0)
      + coalesce((SELECT sum(dv.a_favor) FROM public.dist_devoluciones dv
                    JOIN public.dist_dte n ON n.id = dv.nota_id
                   WHERE dv.cliente_id = p_cliente AND dv.estado = 'emitida' AND dv.a_favor > 0
                     AND n.estado NOT IN ('descartado', 'rechazado', 'invalidado')), 0)
      - coalesce((SELECT sum(monto) FROM public.dist_saldo_aplicaciones WHERE cliente_id = p_cliente), 0), 2);
$function$;
REVOKE EXECUTE ON FUNCTION public.dist_saldo_a_favor(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dist_saldo_a_favor(bigint) TO authenticated, service_role;

-- Pasa a `p_hacia` todo lo que quepa en su saldo; lo que no cabe —o todo, si
-- no hay `p_hacia`— se reintegra por la forma del recibo. Un abono partido
-- deja su resto en la cuenta vieja (anulada) como constancia de que ese
-- dinero se pagó ahí y se devolvió.
CREATE OR REPLACE FUNCTION public.dist_trasladar_abonos(p_desde bigint, p_hacia bigint, p_dte_origen bigint)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_desde   public.dist_cxc%ROWTYPE;
    v_hacia   public.dist_cxc%ROWTYPE;
    v_vend    uuid;
    v_cabe    numeric := 0;
    v_movido  numeric := 0;
    v_reint   numeric := 0;
    v_toma    numeric;
    v_resto   numeric;
    a         record;
BEGIN
    SELECT * INTO v_desde FROM public.dist_cxc WHERE id = p_desde FOR UPDATE;
    IF NOT FOUND THEN RETURN json_build_object('movido', 0, 'reintegrado', 0); END IF;
    IF p_hacia IS NOT NULL THEN
        SELECT * INTO v_hacia FROM public.dist_cxc WHERE id = p_hacia FOR UPDATE;
        IF FOUND AND v_hacia.estado <> 'anulada' THEN
            v_cabe := greatest(0, v_hacia.monto - v_hacia.abonado - v_hacia.acreditado);
        ELSE
            p_hacia := NULL;
        END IF;
    END IF;
    SELECT vendedor_id INTO v_vend FROM public.dist_pedidos WHERE id = v_desde.pedido_id;
    v_vend := coalesce(v_vend, v_desde.vendedor_id);

    FOR a IN
        SELECT ab.id, ab.recibo_id, ab.monto, r.forma
          FROM public.dist_cxc_abonos ab JOIN public.dist_recibos r ON r.id = ab.recibo_id
         WHERE ab.cxc_id = p_desde AND r.anulado_at IS NULL
         ORDER BY ab.id
    LOOP
        v_toma := least(a.monto, v_cabe);
        v_resto := a.monto - v_toma;
        IF v_toma > 0 THEN
            IF EXISTS (SELECT 1 FROM public.dist_cxc_abonos WHERE recibo_id = a.recibo_id AND cxc_id = p_hacia) THEN
                UPDATE public.dist_cxc_abonos SET monto = monto + v_toma WHERE recibo_id = a.recibo_id AND cxc_id = p_hacia;
                IF v_resto > 0 THEN
                    UPDATE public.dist_cxc_abonos SET monto = v_resto WHERE id = a.id;
                ELSE
                    DELETE FROM public.dist_cxc_abonos WHERE id = a.id;
                END IF;
            ELSIF v_resto > 0 THEN
                INSERT INTO public.dist_cxc_abonos (recibo_id, cxc_id, monto) VALUES (a.recibo_id, p_hacia, v_toma);
                UPDATE public.dist_cxc_abonos SET monto = v_resto WHERE id = a.id;
            ELSE
                UPDATE public.dist_cxc_abonos SET cxc_id = p_hacia WHERE id = a.id;
            END IF;
            v_cabe := v_cabe - v_toma;
            v_movido := v_movido + v_toma;
        END IF;
        IF v_resto > 0 THEN
            INSERT INTO public.dist_reintegros
                (emisor_id, cliente_id, dte_id, origen, recibo_id, forma, destino, monto, vendedor_id, creado_por)
            VALUES (v_desde.emisor_id, v_desde.cliente_id, p_dte_origen, 'abono', a.recibo_id, a.forma,
                    CASE WHEN a.forma = '01' THEN 'caja' ELSE 'saldo' END, round(v_resto, 2),
                    CASE WHEN a.forma = '01' THEN v_vend END, public.auth_employee_id())
            ON CONFLICT DO NOTHING;
            v_reint := v_reint + v_resto;
        END IF;
    END LOOP;

    PERFORM public.dist_cxc_recalcular(p_desde);
    IF p_hacia IS NOT NULL THEN PERFORM public.dist_cxc_recalcular(p_hacia); END IF;
    RETURN json_build_object('movido', round(v_movido, 2), 'reintegrado', round(v_reint, 2));
END $function$;
REVOKE EXECUTE ON FUNCTION public.dist_trasladar_abonos(bigint, bigint, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dist_trasladar_abonos(bigint, bigint, bigint) TO service_role;

CREATE OR REPLACE FUNCTION public.dist_reintegrar_documento(p_dte bigint)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    d          public.dist_dte%ROWTYPE;
    p          public.dist_pedidos%ROWTYPE;
    v_cxc      bigint;
    v_nuevo    bigint;
    v_abonos   json;
    v_pagos    numeric := 0;
    pg         record;
BEGIN
    SELECT * INTO d FROM public.dist_dte WHERE id = p_dte;
    IF NOT FOUND OR d.estado <> 'invalidado' OR d.pedido_id IS NULL THEN RETURN NULL; END IF;
    SELECT * INTO p FROM public.dist_pedidos WHERE id = d.pedido_id;

    -- 1 · Los abonos: a la cuenta del reemplazo si lo hay, y si no se reintegran.
    SELECT id INTO v_cxc FROM public.dist_cxc WHERE dte_id = p_dte;
    IF d.reemplazo_id IS NOT NULL THEN
        SELECT id INTO v_nuevo FROM public.dist_cxc WHERE dte_id = d.reemplazo_id AND estado <> 'anulada';
    END IF;
    IF v_cxc IS NOT NULL THEN
        v_abonos := public.dist_trasladar_abonos(v_cxc, v_nuevo, p_dte);
    END IF;

    -- 2 · Lo pagado al vender. Con reemplazo, esos pagos los lleva el pedido
    --     nuevo: sólo vuelve lo que el nuevo trae de MENOS, forma por forma.
    IF d.reemplazo_id IS NOT NULL THEN
        FOR pg IN
            WITH viejo AS (
                SELECT x.p->>'codigo' AS forma, min(x.ord)::smallint AS orden, sum((x.p->>'montoPago')::numeric) AS monto
                  FROM jsonb_array_elements(coalesce(d.json->'resumen'->'pagos', '[]'::jsonb)) WITH ORDINALITY AS x(p, ord)
                 WHERE x.p->>'codigo' IS DISTINCT FROM '13'
                 GROUP BY 1),
            nuevo AS (
                SELECT x.p->>'codigo' AS forma, sum((x.p->>'montoPago')::numeric) AS monto
                  FROM public.dist_dte n, jsonb_array_elements(coalesce(n.json->'resumen'->'pagos', '[]'::jsonb)) AS x(p)
                 WHERE n.id = d.reemplazo_id AND x.p->>'codigo' IS DISTINCT FROM '13'
                 GROUP BY 1)
            SELECT v.orden, v.forma, v.monto - coalesce(n.monto, 0) AS monto
              FROM viejo v LEFT JOIN nuevo n ON n.forma = v.forma
             WHERE v.monto - coalesce(n.monto, 0) > 0
        LOOP
            INSERT INTO public.dist_reintegros
                (emisor_id, cliente_id, dte_id, origen, pago_orden, forma, destino, monto, vendedor_id, creado_por)
            VALUES (d.emisor_id, d.cliente_id, p_dte, 'pago', pg.orden, pg.forma,
                    CASE WHEN pg.forma = '01' THEN 'caja' ELSE 'saldo' END, round(pg.monto, 2),
                    CASE WHEN pg.forma = '01' THEN p.vendedor_id END,
                    coalesce(d.invalidado_por, public.auth_employee_id()))
            ON CONFLICT DO NOTHING;
            v_pagos := v_pagos + pg.monto;
        END LOOP;
    ELSE
        FOR pg IN
            SELECT x.ord::smallint AS orden, x.p->>'codigo' AS forma, (x.p->>'montoPago')::numeric AS monto
              FROM jsonb_array_elements(coalesce(d.json->'resumen'->'pagos', '[]'::jsonb)) WITH ORDINALITY AS x(p, ord)
             WHERE x.p->>'codigo' IS DISTINCT FROM '13' AND (x.p->>'montoPago')::numeric > 0
        LOOP
            INSERT INTO public.dist_reintegros
                (emisor_id, cliente_id, dte_id, origen, pago_orden, forma, destino, monto, vendedor_id, creado_por)
            VALUES (d.emisor_id, d.cliente_id, p_dte, 'pago', pg.orden, pg.forma,
                    CASE WHEN pg.forma = '01' THEN 'caja' ELSE 'saldo' END, round(pg.monto, 2),
                    CASE WHEN pg.forma = '01' THEN p.vendedor_id END,
                    coalesce(d.invalidado_por, public.auth_employee_id()))
            ON CONFLICT DO NOTHING;
            v_pagos := v_pagos + pg.monto;
        END LOOP;
    END IF;

    RETURN json_build_object('abonos', v_abonos, 'pagos', round(v_pagos, 2));
END $function$;
REVOKE EXECUTE ON FUNCTION public.dist_reintegrar_documento(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dist_reintegrar_documento(bigint) TO service_role;
