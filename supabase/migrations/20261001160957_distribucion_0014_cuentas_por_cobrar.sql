-- ═══════════════════════════════════════════════════════════════════════════
-- Distribución · 0014 — cuentas por cobrar
-- ═══════════════════════════════════════════════════════════════════════════
-- Pedido del usuario (2026-09-30): «sigue con cuentas por cobrar […] usa el ERP
-- como muestra y mejóralo para que el portal tenga sus validaciones,
-- eficiencia, fluidez, y todo correcto».
--
-- La muestra es la cartera de las farmacias (`CuentasPorCobrarView`, espejo del
-- sistema de la caja). Lo que se tomó y lo que se corrigió:
--   · el ESPEJO lee de otro sistema y por eso tiene que releer antes de abonar;
--     aquí la cartera NACE en el portal: el crédito sale del documento fiscal y
--     el abono se escribe en la misma transacción que baja el saldo.
--   · «abonar de más deja el crédito en negativo» (lección de la caja): aquí es
--     imposible — `dist_cobrar` bloquea las cuentas, valida contra el saldo y
--     un CHECK impide el saldo negativo.
--   · un reintento por señal cortada no cobra dos veces: `client_uuid` único.
--   · el origen no deja deshacer un abono; aquí se ANULA el recibo, con motivo
--     y por quien administra, y el saldo vuelve solo.
--
-- ── De dónde sale el crédito ─────────────────────────────────────────────
-- Del DOCUMENTO: la parte con forma de pago 13 (crédito) en `resumen.pagos`
-- de su JSON, que es lo que recibió Hacienda. El vencimiento es la fecha de
-- emisión más el plazo del pedido. Si el documento se invalida, se rechaza o
-- se descarta, la cuenta se anula (el pedido refacturado abre la suya).
--
-- ── El plazo avisa, el LÍMITE frena ──────────────────────────────────────
-- Igual que en la cartera de las farmacias, pasarse del plazo es un hallazgo y
-- no un candado. El límite de crédito aprobado sí frena: `distribucion-dte` no
-- factura a crédito si el saldo más la venta nueva pasa del límite.

SET lock_timeout = '5s';

-- ── Tablas ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.dist_cxc (
    id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    emisor_id    smallint NOT NULL REFERENCES public.dist_emisores(id),
    cliente_id   bigint NOT NULL REFERENCES public.dist_clientes(id),
    dte_id       bigint NOT NULL UNIQUE REFERENCES public.dist_dte(id),
    pedido_id    bigint REFERENCES public.dist_pedidos(id),
    vendedor_id  uuid REFERENCES public.employees(id),
    fecha        date NOT NULL,
    vence        date NOT NULL,
    monto        numeric(12,2) NOT NULL CHECK (monto > 0),
    abonado      numeric(12,2) NOT NULL DEFAULT 0 CHECK (abonado >= 0),
    saldo        numeric(12,2) GENERATED ALWAYS AS (monto - abonado) STORED,
    estado       text NOT NULL DEFAULT 'abierta' CHECK (estado IN ('abierta', 'pagada', 'anulada')),
    pagada_at    timestamptz,
    anulada_at   timestamptz,
    created_at   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT dist_cxc_sin_sobrepago CHECK (abonado <= monto)
);
CREATE INDEX IF NOT EXISTS dist_cxc_cliente ON public.dist_cxc (cliente_id, estado, vence);
CREATE INDEX IF NOT EXISTS dist_cxc_abiertas ON public.dist_cxc (emisor_id, vence) WHERE estado = 'abierta';
CREATE INDEX IF NOT EXISTS dist_cxc_pedido ON public.dist_cxc (pedido_id);

-- Un recibo es UN cobro: una forma de pago, un monto, repartido en cuentas.
CREATE TABLE IF NOT EXISTS public.dist_recibos (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    emisor_id       smallint NOT NULL REFERENCES public.dist_emisores(id),
    cliente_id      bigint NOT NULL REFERENCES public.dist_clientes(id),
    client_uuid     uuid NOT NULL UNIQUE,
    monto           numeric(12,2) NOT NULL CHECK (monto > 0),
    forma           text NOT NULL CHECK (forma IN ('01', '02', '03', '04', '05')),
    referencia      text,
    recibido        numeric(12,2),     -- en efectivo: lo que entregó (para el cambio)
    comprobante_url text,
    nota            text,
    recibido_por    uuid NOT NULL DEFAULT public.auth_employee_id() REFERENCES public.employees(id),
    anulado_at      timestamptz,
    anulado_por     uuid REFERENCES public.employees(id),
    anulado_motivo  text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT dist_recibos_anulado_con_motivo CHECK (anulado_at IS NULL OR btrim(coalesce(anulado_motivo, '')) <> ''),
    CONSTRAINT dist_recibos_referencia CHECK (forma IN ('01', '02', '03') OR btrim(coalesce(referencia, '')) <> '')
);
CREATE INDEX IF NOT EXISTS dist_recibos_cliente ON public.dist_recibos (cliente_id, created_at DESC);
CREATE INDEX IF NOT EXISTS dist_recibos_fecha ON public.dist_recibos (emisor_id, created_at DESC) WHERE anulado_at IS NULL;

CREATE TABLE IF NOT EXISTS public.dist_cxc_abonos (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    recibo_id   bigint NOT NULL REFERENCES public.dist_recibos(id),
    cxc_id      bigint NOT NULL REFERENCES public.dist_cxc(id),
    monto       numeric(12,2) NOT NULL CHECK (monto > 0),
    created_at  timestamptz NOT NULL DEFAULT now(),
    UNIQUE (recibo_id, cxc_id)
);
CREATE INDEX IF NOT EXISTS dist_cxc_abonos_cxc ON public.dist_cxc_abonos (cxc_id);

ALTER TABLE public.dist_cxc ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dist_recibos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dist_cxc_abonos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS dist_cxc_select ON public.dist_cxc;
CREATE POLICY dist_cxc_select ON public.dist_cxc FOR SELECT TO authenticated
    USING ((SELECT public.auth_has_module_permission('distribucion', 'can_view')));
DROP POLICY IF EXISTS dist_recibos_select ON public.dist_recibos;
CREATE POLICY dist_recibos_select ON public.dist_recibos FOR SELECT TO authenticated
    USING ((SELECT public.auth_has_module_permission('distribucion', 'can_view')));
DROP POLICY IF EXISTS dist_cxc_abonos_select ON public.dist_cxc_abonos;
CREATE POLICY dist_cxc_abonos_select ON public.dist_cxc_abonos FOR SELECT TO authenticated
    USING ((SELECT public.auth_has_module_permission('distribucion', 'can_view')));
-- Sin policies de escritura: todo pasa por `dist_cobrar` y `dist_anular_recibo`.
REVOKE ALL ON public.dist_cxc, public.dist_recibos, public.dist_cxc_abonos FROM anon, authenticated;
GRANT SELECT ON public.dist_cxc, public.dist_recibos, public.dist_cxc_abonos TO authenticated;
GRANT ALL ON public.dist_cxc, public.dist_recibos, public.dist_cxc_abonos TO service_role;

-- ── Lo abonado se recalcula de los abonos vivos ────────────────────────────
CREATE OR REPLACE FUNCTION public.dist_cxc_recalcular(p_cxc bigint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE v_abonado numeric;
BEGIN
    SELECT coalesce(sum(a.monto), 0) INTO v_abonado
      FROM public.dist_cxc_abonos a JOIN public.dist_recibos r ON r.id = a.recibo_id
     WHERE a.cxc_id = p_cxc AND r.anulado_at IS NULL;
    UPDATE public.dist_cxc
       SET abonado = v_abonado,
           estado = CASE WHEN estado = 'anulada' THEN 'anulada' WHEN v_abonado >= monto THEN 'pagada' ELSE 'abierta' END,
           pagada_at = CASE WHEN estado <> 'anulada' AND v_abonado >= monto THEN coalesce(pagada_at, now()) ELSE NULL END
     WHERE id = p_cxc;
END $$;
REVOKE EXECUTE ON FUNCTION public.dist_cxc_recalcular(bigint) FROM PUBLIC, anon, authenticated;

-- ── Nace con el documento; se anula con él ─────────────────────────────────
-- La parte a crédito del documento: sus pagos con código 13; si el JSON no los
-- trae (datos viejos), los pagos del pedido.
CREATE OR REPLACE FUNCTION public.dist_credito_del_documento(p_dte bigint)
RETURNS numeric LANGUAGE sql STABLE
SET search_path = public, extensions AS $$
    SELECT coalesce(
        (SELECT sum((p->>'montoPago')::numeric) FROM public.dist_dte d, jsonb_array_elements(d.json->'resumen'->'pagos') p
          WHERE d.id = p_dte AND p->>'codigo' = '13'),
        (SELECT sum(pg.monto) FROM public.dist_dte d JOIN public.dist_pagos pg ON pg.pedido_id = d.pedido_id
          WHERE d.id = p_dte AND pg.forma = '13'),
        0);
$$;
REVOKE EXECUTE ON FUNCTION public.dist_credito_del_documento(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dist_credito_del_documento(bigint) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.dist_cxc_al_documento()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE
    v_credito numeric;
    v_plazo   integer;
    v_vend    uuid;
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.tipo NOT IN ('01', '03') OR NEW.pedido_id IS NULL OR NEW.estado IN ('descartado', 'rechazado', 'invalidado') THEN
            RETURN NEW;
        END IF;
        v_credito := public.dist_credito_del_documento(NEW.id);
        IF v_credito <= 0 THEN RETURN NEW; END IF;
        SELECT coalesce(p.plazo_dias, c.plazo_dias, 30), p.vendedor_id INTO v_plazo, v_vend
          FROM public.dist_pedidos p JOIN public.dist_clientes c ON c.id = p.cliente_id WHERE p.id = NEW.pedido_id;
        INSERT INTO public.dist_cxc (emisor_id, cliente_id, dte_id, pedido_id, vendedor_id, fecha, vence, monto)
        VALUES (NEW.emisor_id, NEW.cliente_id, NEW.id, NEW.pedido_id, v_vend, NEW.fec_emi, NEW.fec_emi + v_plazo, round(v_credito, 2))
        ON CONFLICT (dte_id) DO NOTHING;
    ELSIF NEW.estado IN ('descartado', 'rechazado', 'invalidado') AND OLD.estado IS DISTINCT FROM NEW.estado THEN
        UPDATE public.dist_cxc SET estado = 'anulada', anulada_at = now() WHERE dte_id = NEW.id AND estado <> 'anulada';
    END IF;
    RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.dist_cxc_al_documento() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS dist_dte_cxc ON public.dist_dte;
CREATE TRIGGER dist_dte_cxc AFTER INSERT OR UPDATE OF estado ON public.dist_dte
    FOR EACH ROW EXECUTE FUNCTION public.dist_cxc_al_documento();

-- Lo que ya se vendió a crédito antes de esta migración.
INSERT INTO public.dist_cxc (emisor_id, cliente_id, dte_id, pedido_id, vendedor_id, fecha, vence, monto)
SELECT d.emisor_id, d.cliente_id, d.id, d.pedido_id, p.vendedor_id, d.fec_emi,
       d.fec_emi + coalesce(p.plazo_dias, c.plazo_dias, 30), round(public.dist_credito_del_documento(d.id), 2)
  FROM public.dist_dte d
  JOIN public.dist_pedidos p ON p.id = d.pedido_id
  JOIN public.dist_clientes c ON c.id = d.cliente_id
 WHERE d.tipo IN ('01', '03') AND d.estado NOT IN ('descartado', 'rechazado', 'invalidado')
   AND public.dist_credito_del_documento(d.id) > 0
ON CONFLICT (dte_id) DO NOTHING;

-- ── Cobrar ─────────────────────────────────────────────────────────────────
-- `p_aplicacion`: [{ "cxc_id": n, "monto": n }] para repartir a mano; null =
-- automático, primero lo que vence antes. Devuelve el recibo con su reparto.
CREATE OR REPLACE FUNCTION public.dist_cobrar(
    p_cliente bigint, p_monto numeric, p_forma text, p_client_uuid uuid,
    p_referencia text DEFAULT NULL, p_recibido numeric DEFAULT NULL, p_nota text DEFAULT NULL,
    p_aplicacion jsonb DEFAULT NULL, p_comprobante_url text DEFAULT NULL)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE
    v_yo       uuid := public.auth_employee_id();
    v_previo   bigint;
    v_emisor   smallint;
    v_saldo    numeric;
    v_recibo   bigint;
    v_falta    numeric;
    v_toma     numeric;
    c          record;
    a          record;
BEGIN
    IF v_yo IS NULL OR NOT public.auth_can_edit_any(ARRAY['distribucion']) THEN
        RAISE EXCEPTION 'DIST_SIN_PERMISO: no puedes cobrar en Distribución';
    END IF;
    -- Un reintento (señal cortada a medias) devuelve el mismo recibo.
    SELECT id INTO v_previo FROM public.dist_recibos WHERE client_uuid = p_client_uuid;
    IF v_previo IS NOT NULL THEN RETURN public.dist_recibo(v_previo); END IF;

    p_monto := round(coalesce(p_monto, 0), 2);
    IF p_monto <= 0 THEN RAISE EXCEPTION 'DIST_COBRO_MONTO: el monto tiene que ser mayor que cero'; END IF;
    IF p_forma NOT IN ('01', '02', '03', '04', '05') THEN RAISE EXCEPTION 'DIST_COBRO_FORMA: forma de pago no válida'; END IF;
    IF p_forma IN ('04', '05') AND btrim(coalesce(p_referencia, '')) = '' THEN
        RAISE EXCEPTION 'DIST_COBRO_REFERENCIA: un cheque o una transferencia llevan su número';
    END IF;
    IF p_forma = '01' AND p_recibido IS NOT NULL AND p_recibido < p_monto THEN
        RAISE EXCEPTION 'DIST_COBRO_RECIBIDO: lo entregado no alcanza para el monto';
    END IF;

    -- Bloquea TODAS las cuentas abiertas del cliente: dos cobros a la vez se
    -- ponen en fila y ninguno abona sobre un saldo que el otro ya bajó.
    PERFORM 1 FROM public.dist_cxc WHERE cliente_id = p_cliente AND estado = 'abierta' ORDER BY id FOR UPDATE;
    SELECT sum(saldo), min(emisor_id) INTO v_saldo, v_emisor FROM public.dist_cxc WHERE cliente_id = p_cliente AND estado = 'abierta';
    IF coalesce(v_saldo, 0) <= 0 THEN RAISE EXCEPTION 'DIST_COBRO_SIN_SALDO: este cliente no debe nada'; END IF;
    IF p_monto > v_saldo THEN
        RAISE EXCEPTION 'DIST_COBRO_EXCEDE: el cliente debe $% y el cobro es de $%', to_char(v_saldo, 'FM999,999,990.00'), to_char(p_monto, 'FM999,999,990.00');
    END IF;

    INSERT INTO public.dist_recibos (emisor_id, cliente_id, client_uuid, monto, forma, referencia, recibido, comprobante_url, nota, recibido_por)
    VALUES (v_emisor, p_cliente, p_client_uuid, p_monto, p_forma, nullif(btrim(coalesce(p_referencia, '')), ''),
            CASE WHEN p_forma = '01' THEN p_recibido END, p_comprobante_url, nullif(btrim(coalesce(p_nota, '')), ''), v_yo)
    RETURNING id INTO v_recibo;

    IF p_aplicacion IS NOT NULL AND jsonb_array_length(p_aplicacion) > 0 THEN
        -- A mano: cada cuenta tiene que ser de este cliente, estar abierta y
        -- no recibir más que su saldo; y el reparto tiene que sumar el cobro.
        IF (SELECT round(sum((x->>'monto')::numeric), 2) FROM jsonb_array_elements(p_aplicacion) x) <> p_monto THEN
            RAISE EXCEPTION 'DIST_COBRO_REPARTO: lo repartido no suma el monto del cobro';
        END IF;
        FOR a IN SELECT (x->>'cxc_id')::bigint AS cxc_id, round((x->>'monto')::numeric, 2) AS monto
                   FROM jsonb_array_elements(p_aplicacion) x WHERE (x->>'monto')::numeric > 0
        LOOP
            SELECT * INTO c FROM public.dist_cxc WHERE id = a.cxc_id;
            IF NOT FOUND OR c.cliente_id <> p_cliente OR c.estado <> 'abierta' THEN
                RAISE EXCEPTION 'DIST_COBRO_CUENTA: una de las cuentas no es de este cliente o ya no está abierta';
            END IF;
            IF a.monto > c.saldo THEN
                RAISE EXCEPTION 'DIST_COBRO_EXCEDE: a una cuenta se le abona más de lo que debe';
            END IF;
            INSERT INTO public.dist_cxc_abonos (recibo_id, cxc_id, monto) VALUES (v_recibo, a.cxc_id, a.monto);
            PERFORM public.dist_cxc_recalcular(a.cxc_id);
        END LOOP;
    ELSE
        -- Automático: primero lo que vence antes.
        v_falta := p_monto;
        FOR c IN SELECT * FROM public.dist_cxc WHERE cliente_id = p_cliente AND estado = 'abierta' ORDER BY vence, id LOOP
            EXIT WHEN v_falta <= 0;
            v_toma := least(v_falta, c.saldo);
            INSERT INTO public.dist_cxc_abonos (recibo_id, cxc_id, monto) VALUES (v_recibo, c.id, v_toma);
            PERFORM public.dist_cxc_recalcular(c.id);
            v_falta := v_falta - v_toma;
        END LOOP;
    END IF;
    RETURN public.dist_recibo(v_recibo);
END $$;
REVOKE EXECUTE ON FUNCTION public.dist_cobrar(bigint, numeric, text, uuid, text, numeric, text, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dist_cobrar(bigint, numeric, text, uuid, text, numeric, text, jsonb, text) TO authenticated, service_role;

-- ── Un recibo, con su reparto y lo que quedó debiendo (para el papel) ──────
CREATE OR REPLACE FUNCTION public.dist_recibo(p_recibo bigint)
RETURNS json LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions AS $$
    SELECT json_build_object(
        'id', r.id, 'cliente_id', r.cliente_id, 'cliente', cl.nombre, 'monto', r.monto, 'forma', r.forma,
        'referencia', r.referencia, 'recibido', r.recibido, 'nota', r.nota, 'created_at', r.created_at,
        'anulado_at', r.anulado_at, 'anulado_motivo', r.anulado_motivo,
        'recibido_por', json_build_object('id', e.id, 'name', e.name, 'photo_url', e.photo_url),
        'abonos', (SELECT coalesce(json_agg(json_build_object(
                        'cxc_id', a.cxc_id, 'monto', a.monto, 'numero_control', d.numero_control,
                        'fecha', x.fecha, 'saldo', x.saldo) ORDER BY x.vence), '[]'::json)
                     FROM public.dist_cxc_abonos a JOIN public.dist_cxc x ON x.id = a.cxc_id
                     JOIN public.dist_dte d ON d.id = x.dte_id WHERE a.recibo_id = r.id),
        'saldo_cliente', (SELECT coalesce(sum(saldo), 0) FROM public.dist_cxc WHERE cliente_id = r.cliente_id AND estado = 'abierta'))
      FROM public.dist_recibos r
      JOIN public.dist_clientes cl ON cl.id = r.cliente_id
      LEFT JOIN public.employees e ON e.id = r.recibido_por
     WHERE r.id = p_recibo
       AND (SELECT public.auth_has_module_permission('distribucion', 'can_view'));
$$;
REVOKE EXECUTE ON FUNCTION public.dist_recibo(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dist_recibo(bigint) TO authenticated, service_role;

-- ── Anular un recibo: sólo quien administra, con motivo ────────────────────
CREATE OR REPLACE FUNCTION public.dist_anular_recibo(p_recibo bigint, p_motivo text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE
    v_yo uuid := public.auth_employee_id();
    a    record;
BEGIN
    IF v_yo IS NULL OR NOT public.auth_can_edit_any(ARRAY['distribucion_config']) THEN
        RAISE EXCEPTION 'DIST_SIN_PERMISO: anular un cobro es de quien administra la distribuidora';
    END IF;
    IF btrim(coalesce(p_motivo, '')) = '' THEN RAISE EXCEPTION 'DIST_COBRO_MOTIVO: escribe por qué se anula el cobro'; END IF;
    UPDATE public.dist_recibos SET anulado_at = now(), anulado_por = v_yo, anulado_motivo = btrim(p_motivo)
     WHERE id = p_recibo AND anulado_at IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'DIST_COBRO_ANULADO: ese cobro no existe o ya está anulado'; END IF;
    FOR a IN SELECT cxc_id FROM public.dist_cxc_abonos WHERE recibo_id = p_recibo LOOP
        PERFORM public.dist_cxc_recalcular(a.cxc_id);
    END LOOP;
    RETURN public.dist_recibo(p_recibo);
END $$;
REVOKE EXECUTE ON FUNCTION public.dist_anular_recibo(bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dist_anular_recibo(bigint, text) TO authenticated, service_role;

-- ── El crédito de un cliente (la venta lo consulta) ────────────────────────
CREATE OR REPLACE FUNCTION public.dist_credito_cliente(p_cliente bigint)
RETURNS json LANGUAGE sql STABLE
SET search_path = public, extensions AS $$
    SELECT json_build_object(
        'limite', c.limite_credito, 'plazo', c.plazo_dias,
        'saldo', coalesce(sum(x.saldo) FILTER (WHERE x.estado = 'abierta'), 0),
        'vencido', coalesce(sum(x.saldo) FILTER (WHERE x.estado = 'abierta' AND x.vence < current_date), 0),
        'cuentas_vencidas', count(*) FILTER (WHERE x.estado = 'abierta' AND x.vence < current_date),
        'dias_atraso', coalesce(max(current_date - x.vence) FILTER (WHERE x.estado = 'abierta' AND x.vence < current_date), 0),
        'disponible', greatest(0, c.limite_credito - coalesce(sum(x.saldo) FILTER (WHERE x.estado = 'abierta'), 0)))
      FROM public.dist_clientes c LEFT JOIN public.dist_cxc x ON x.cliente_id = c.id
     WHERE c.id = p_cliente
     GROUP BY c.id;
$$;
REVOKE EXECUTE ON FUNCTION public.dist_credito_cliente(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dist_credito_cliente(bigint) TO authenticated, service_role;

-- ── La cartera entera, en un JSON (patrón C) ───────────────────────────────
CREATE OR REPLACE FUNCTION public.dist_cartera()
RETURNS json LANGUAGE sql STABLE
SET search_path = public, extensions AS $$
    WITH abiertas AS (
        SELECT x.*, greatest(0, current_date - x.vence) AS atraso FROM public.dist_cxc x WHERE x.estado = 'abierta'
    ), por_cliente AS (
        SELECT c.id, c.nombre, c.tipo, coalesce(c.ruta, 'Sin ruta') AS ruta, c.limite_credito, c.plazo_dias, c.telefono,
               sum(a.saldo) AS saldo,
               coalesce(sum(a.saldo) FILTER (WHERE a.vence < current_date), 0) AS vencido,
               count(*) AS cuentas,
               max(a.atraso) AS dias_atraso,
               min(a.vence) AS proximo_vence,
               (SELECT max(r.created_at) FROM public.dist_recibos r WHERE r.cliente_id = c.id AND r.anulado_at IS NULL) AS ultimo_cobro
          FROM abiertas a JOIN public.dist_clientes c ON c.id = a.cliente_id
         GROUP BY c.id
    )
    SELECT json_build_object(
        'resumen', json_build_object(
            'por_cobrar', (SELECT coalesce(sum(saldo), 0) FROM abiertas),
            'vencido', (SELECT coalesce(sum(saldo), 0) FROM abiertas WHERE vence < current_date),
            'clientes', (SELECT count(*) FROM por_cliente),
            'clientes_vencidos', (SELECT count(*) FROM por_cliente WHERE vencido > 0),
            'vence_7', (SELECT coalesce(sum(saldo), 0) FROM abiertas WHERE vence BETWEEN current_date AND current_date + 7),
            'cobrado_mes', (SELECT coalesce(sum(monto), 0) FROM public.dist_recibos
                             WHERE anulado_at IS NULL AND created_at >= date_trunc('month', now() AT TIME ZONE 'America/El_Salvador') AT TIME ZONE 'America/El_Salvador')),
        'antiguedad', json_build_array(
            json_build_object('tramo', 'al_dia', 'monto', (SELECT coalesce(sum(saldo), 0) FROM abiertas WHERE atraso = 0)),
            json_build_object('tramo', '1_30', 'monto', (SELECT coalesce(sum(saldo), 0) FROM abiertas WHERE atraso BETWEEN 1 AND 30)),
            json_build_object('tramo', '31_60', 'monto', (SELECT coalesce(sum(saldo), 0) FROM abiertas WHERE atraso BETWEEN 31 AND 60)),
            json_build_object('tramo', '61_90', 'monto', (SELECT coalesce(sum(saldo), 0) FROM abiertas WHERE atraso BETWEEN 61 AND 90)),
            json_build_object('tramo', 'mas_90', 'monto', (SELECT coalesce(sum(saldo), 0) FROM abiertas WHERE atraso > 90))),
        'clientes', (SELECT coalesce(json_agg(p ORDER BY p.vencido DESC, p.saldo DESC), '[]'::json) FROM por_cliente p));
$$;
REVOKE EXECUTE ON FUNCTION public.dist_cartera() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dist_cartera() TO authenticated, service_role;

-- ── El estado de cuenta de un cliente ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.dist_estado_cuenta(p_cliente bigint)
RETURNS json LANGUAGE sql STABLE
SET search_path = public, extensions AS $$
    SELECT json_build_object(
        'credito', public.dist_credito_cliente(p_cliente),
        'cuentas', (SELECT coalesce(json_agg(json_build_object(
                        'id', x.id, 'dte_id', x.dte_id, 'numero_control', d.numero_control, 'tipo', d.tipo,
                        'fecha', x.fecha, 'vence', x.vence, 'monto', x.monto, 'abonado', x.abonado, 'saldo', x.saldo,
                        'estado', x.estado, 'dias', current_date - x.vence) ORDER BY x.estado = 'abierta' DESC, x.vence), '[]'::json)
                      FROM public.dist_cxc x JOIN public.dist_dte d ON d.id = x.dte_id
                     WHERE x.cliente_id = p_cliente AND (x.estado = 'abierta' OR x.fecha >= current_date - 180)),
        'recibos', (SELECT coalesce(json_agg(public.dist_recibo(r.id) ORDER BY r.created_at DESC), '[]'::json)
                      FROM (SELECT id, created_at FROM public.dist_recibos WHERE cliente_id = p_cliente ORDER BY created_at DESC LIMIT 50) r));
$$;
REVOKE EXECUTE ON FUNCTION public.dist_estado_cuenta(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dist_estado_cuenta(bigint) TO authenticated, service_role;
