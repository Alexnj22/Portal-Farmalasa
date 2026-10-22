SET lock_timeout = '5s';

-- Distribución · H2 (2 de 3): la cuenta por cobrar, el saldo a favor como pago
-- parcial y el crédito del cliente. Ver la parte 1
-- (`dist_dinero_de_documentos_invalidados_1_tablas_y_reintegro`).

-- El trigger de la cuenta por cobrar (partido de la definición viva).
CREATE OR REPLACE FUNCTION public.dist_cxc_al_documento()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_credito numeric;
    v_plazo   integer;
    v_vend    uuid;
    v_cxc     bigint;
    v_vieja   record;
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
        ON CONFLICT (dte_id) DO NOTHING
        RETURNING id INTO v_cxc;
        -- Refacturado tras un rechazo o un descarte: lo que se abonó a la
        -- cuenta del documento anterior del MISMO pedido pasa a ésta.
        IF v_cxc IS NOT NULL THEN
            FOR v_vieja IN
                SELECT x.id, x.dte_id FROM public.dist_cxc x JOIN public.dist_dte o ON o.id = x.dte_id
                 WHERE x.pedido_id = NEW.pedido_id AND x.id <> v_cxc AND x.estado = 'anulada'
                   AND o.estado IN ('descartado', 'rechazado') AND x.abonado > 0
            LOOP
                PERFORM public.dist_trasladar_abonos(v_vieja.id, v_cxc, v_vieja.dte_id);
            END LOOP;
        END IF;
    ELSIF NEW.estado IN ('descartado', 'rechazado', 'invalidado') AND OLD.estado IS DISTINCT FROM NEW.estado THEN
        UPDATE public.dist_cxc SET estado = 'anulada', anulada_at = now() WHERE dte_id = NEW.id AND estado <> 'anulada';
        -- Invalidado ante Hacienda: el dinero cobrado no se queda huérfano.
        IF NEW.estado = 'invalidado' THEN
            PERFORM public.dist_reintegrar_documento(NEW.id);
        END IF;
    END IF;
    RETURN NEW;
END $function$;

-- La cuenta suma también el saldo a favor aplicado (definición viva + 1).
CREATE OR REPLACE FUNCTION public.dist_cxc_recalcular(p_cxc bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v_abonado numeric; v_acreditado numeric;
BEGIN
    SELECT coalesce(sum(a.monto), 0) INTO v_abonado
      FROM public.dist_cxc_abonos a JOIN public.dist_recibos r ON r.id = a.recibo_id
     WHERE a.cxc_id = p_cxc AND r.anulado_at IS NULL;
    SELECT coalesce((SELECT sum(credito_aplicado) FROM public.dist_devoluciones WHERE cxc_id = p_cxc AND estado = 'emitida'), 0)
         + coalesce((SELECT sum(monto) FROM public.dist_saldo_aplicaciones WHERE cxc_id = p_cxc), 0)
      INTO v_acreditado;
    UPDATE public.dist_cxc
       SET abonado = v_abonado, acreditado = v_acreditado,
           estado = CASE WHEN estado = 'anulada' THEN 'anulada' WHEN v_abonado + v_acreditado >= monto THEN 'pagada' ELSE 'abierta' END,
           pagada_at = CASE WHEN estado <> 'anulada' AND v_abonado + v_acreditado >= monto THEN coalesce(pagada_at, now()) ELSE NULL END
     WHERE id = p_cxc;
END $function$;

-- Usar el saldo a favor en una cuenta: pago parcial, entero o por partes.
CREATE OR REPLACE FUNCTION public.dist_aplicar_saldo_a_favor(p_cxc bigint, p_monto numeric, p_nota text DEFAULT NULL)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_yo     uuid := public.auth_employee_id();
    x        public.dist_cxc%ROWTYPE;
    v_favor  numeric;
    v_id     bigint;
BEGIN
    IF v_yo IS NULL OR NOT (SELECT public.auth_can_edit_any(ARRAY['distribucion'])) THEN
        RAISE EXCEPTION 'DIST_SIN_PERMISO: no puedes cobrar en Distribución';
    END IF;
    IF p_monto IS NULL OR round(p_monto, 2) <= 0 THEN
        RAISE EXCEPTION 'DIST_SALDO_A_FAVOR: escribe cuánto del saldo a favor se usa';
    END IF;
    SELECT * INTO x FROM public.dist_cxc WHERE id = p_cxc;
    IF NOT FOUND THEN RAISE EXCEPTION 'DIST_SALDO_A_FAVOR: no existe esa cuenta'; END IF;
    -- Un cliente a la vez: dos aplicaciones simultáneas no gastan el mismo saldo.
    PERFORM 1 FROM public.dist_clientes WHERE id = x.cliente_id FOR UPDATE;
    SELECT * INTO x FROM public.dist_cxc WHERE id = p_cxc FOR UPDATE;
    IF x.estado <> 'abierta' THEN RAISE EXCEPTION 'DIST_SALDO_A_FAVOR: esa cuenta ya no está abierta'; END IF;
    IF round(p_monto, 2) > x.saldo THEN
        RAISE EXCEPTION 'DIST_SALDO_A_FAVOR: la cuenta sólo debe $%', to_char(x.saldo, 'FM999,999,990.00');
    END IF;
    v_favor := public.dist_saldo_a_favor(x.cliente_id);
    IF round(p_monto, 2) > v_favor THEN
        RAISE EXCEPTION 'DIST_SALDO_A_FAVOR: el cliente tiene $% a favor', to_char(v_favor, 'FM999,999,990.00');
    END IF;
    INSERT INTO public.dist_saldo_aplicaciones (emisor_id, cliente_id, cxc_id, monto, nota, creado_por)
    VALUES (x.emisor_id, x.cliente_id, x.id, round(p_monto, 2), nullif(btrim(coalesce(p_nota, '')), ''), v_yo)
    RETURNING id INTO v_id;
    PERFORM public.dist_cxc_recalcular(x.id);
    RETURN json_build_object('id', v_id, 'a_favor', public.dist_saldo_a_favor(x.cliente_id),
                             'saldo_cuenta', (SELECT saldo FROM public.dist_cxc WHERE id = x.id));
END $function$;
REVOKE EXECUTE ON FUNCTION public.dist_aplicar_saldo_a_favor(bigint, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dist_aplicar_saldo_a_favor(bigint, numeric, text) TO authenticated, service_role;

-- Un recibo ya devuelto no se anula: restaría otra vez lo que el reintegro ya devolvió.
CREATE OR REPLACE FUNCTION public.dist_recibo_reintegrado_no_se_anula()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
    IF NEW.anulado_at IS NOT NULL AND OLD.anulado_at IS NULL
       AND EXISTS (SELECT 1 FROM public.dist_reintegros WHERE recibo_id = NEW.id) THEN
        RAISE EXCEPTION 'DIST_RECIBO_REINTEGRADO: ese cobro ya se devolvió o quedó a favor del cliente al invalidar el documento; no se puede anular';
    END IF;
    RETURN NEW;
END $function$;
DROP TRIGGER IF EXISTS dist_recibos_reintegrado ON public.dist_recibos;
CREATE TRIGGER dist_recibos_reintegrado BEFORE UPDATE OF anulado_at ON public.dist_recibos
    FOR EACH ROW EXECUTE FUNCTION public.dist_recibo_reintegrado_no_se_anula();

-- El crédito del cliente dice también cuánto tiene a favor.
CREATE OR REPLACE FUNCTION public.dist_credito_cliente(p_cliente bigint)
 RETURNS json
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
    SELECT json_build_object(
        'limite', c.limite_credito, 'plazo', c.plazo_dias,
        'saldo', coalesce(sum(x.saldo) FILTER (WHERE x.estado = 'abierta'), 0),
        'vencido', coalesce(sum(x.saldo) FILTER (WHERE x.estado = 'abierta' AND x.vence < current_date), 0),
        'cuentas_vencidas', count(*) FILTER (WHERE x.estado = 'abierta' AND x.vence < current_date),
        'dias_atraso', coalesce(max(current_date - x.vence) FILTER (WHERE x.estado = 'abierta' AND x.vence < current_date), 0),
        'disponible', greatest(0, c.limite_credito - coalesce(sum(x.saldo) FILTER (WHERE x.estado = 'abierta'), 0)),
        'a_favor', public.dist_saldo_a_favor(c.id))
      FROM public.dist_clientes c LEFT JOIN public.dist_cxc x ON x.cliente_id = c.id
     WHERE c.id = p_cliente
     GROUP BY c.id;
$function$;

-- El estado de cuenta dice qué se usó del saldo a favor y quién
-- (partido de la definición viva + `a_favor_usado`).
CREATE OR REPLACE FUNCTION public.dist_estado_cuenta(p_cliente bigint)
 RETURNS json
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
    SELECT json_build_object(
        'credito', public.dist_credito_cliente(p_cliente),
        'cuentas', (SELECT coalesce(json_agg(json_build_object(
                        'id', x.id, 'dte_id', x.dte_id, 'numero_control', d.numero_control, 'tipo', d.tipo,
                        'fecha', x.fecha, 'vence', x.vence, 'monto', x.monto, 'abonado', x.abonado, 'acreditado', x.acreditado,
                        'saldo', x.saldo, 'estado', x.estado, 'dias', current_date - x.vence) ORDER BY x.estado = 'abierta' DESC, x.vence), '[]'::json)
                      FROM public.dist_cxc x JOIN public.dist_dte d ON d.id = x.dte_id
                     WHERE x.cliente_id = p_cliente AND (x.estado = 'abierta' OR x.fecha >= current_date - 180)),
        'recibos', (SELECT coalesce(json_agg(public.dist_recibo(r.id) ORDER BY r.created_at DESC), '[]'::json)
                      FROM (SELECT id, created_at FROM public.dist_recibos WHERE cliente_id = p_cliente ORDER BY created_at DESC LIMIT 50) r),
        'a_favor_usado', (SELECT coalesce(json_agg(json_build_object(
                        'id', a.id, 'cxc_id', a.cxc_id, 'numero_control', d.numero_control, 'monto', a.monto, 'nota', a.nota,
                        'fecha', a.created_at, 'por', json_build_object('id', e.id, 'name', e.name, 'photo_url', e.photo_url))
                        ORDER BY a.created_at DESC), '[]'::json)
                      FROM (SELECT * FROM public.dist_saldo_aplicaciones WHERE cliente_id = p_cliente ORDER BY created_at DESC LIMIT 20) a
                      JOIN public.dist_cxc x ON x.id = a.cxc_id
                      JOIN public.dist_dte d ON d.id = x.dte_id
                      LEFT JOIN public.employees e ON e.id = a.creado_por));
$function$;
