SET lock_timeout = '5s';

-- El reparto a mano de un cobro no acepta montos negativos.
--
-- La suma del reparto se comparaba con el cobro CONTANDO los negativos, pero
-- después sólo se grababan los positivos: un cobro de $0.01 repartido como
-- [{A: 500}, {B: -499.99}] sumaba 0.01, pasaba, y le abonaba $500 a la cuenta
-- A — que quedaba pagada. Hallado en la revisión del 2026-10-21; distribución
-- tenía 0 recibos ese día, así que nunca pasó. Partido de la definición viva:
-- lo único nuevo es el freno de `DIST_COBRO_REPARTO_NEGATIVO`.
CREATE OR REPLACE FUNCTION public.dist_cobrar(p_cliente bigint, p_monto numeric, p_forma text, p_client_uuid uuid, p_referencia text DEFAULT NULL::text, p_recibido numeric DEFAULT NULL::numeric, p_nota text DEFAULT NULL::text, p_aplicacion jsonb DEFAULT NULL::jsonb, p_comprobante_url text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
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
    -- Un monto negativo restaba en la suma de abajo pero no se grababa: dejaba
    -- abonar a una cuenta más de lo que se cobró.
    IF p_aplicacion IS NOT NULL AND EXISTS (
        SELECT 1 FROM jsonb_array_elements(p_aplicacion) x
         WHERE coalesce((x->>'monto')::numeric, 0) < 0) THEN
        RAISE EXCEPTION 'DIST_COBRO_REPARTO_NEGATIVO: el reparto no puede llevar montos negativos';
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
END $function$;
