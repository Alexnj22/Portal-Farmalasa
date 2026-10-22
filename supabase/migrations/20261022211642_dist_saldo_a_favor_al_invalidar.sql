SET lock_timeout = '5s';

-- Distribución · el saldo a favor aplicado a una cuenta no se pierde al
-- invalidar el documento.
--
-- `dist_cxc_recalcular` cuenta lo aplicado del saldo a favor
-- (`dist_saldo_aplicaciones`) como `acreditado`, pero `dist_trasladar_abonos`
-- sólo recorría `dist_cxc_abonos`. Al invalidar un documento —deshacer o
-- corregir— ese dinero no pasaba al documento nuevo ni volvía al cliente, y
-- `dist_saldo_a_favor` lo seguía restando aunque la cuenta estuviera anulada.
-- Medido en el entorno de pruebas: $112.20 que el cliente perdía.
--
-- La regla, una sola:
--   · Una aplicación cuenta contra el saldo a favor sólo mientras su cuenta
--     esté VIGENTE. Si la cuenta se anula, lo aplicado vuelve al saldo del
--     cliente solo, sin escribir nada: la fila se queda como constancia de
--     que se usó ahí y se devolvió (igual que el resto de un abono partido).
--   · Al CORREGIR (o refacturar tras un rechazo o un descarte),
--     `dist_trasladar_abonos` pasa a la cuenta nueva lo que quepa en su saldo,
--     después de los abonos; lo que no cabe se queda en la vieja y, por la
--     regla de arriba, vuelve al saldo a favor.
-- Nunca cuenta dos veces: cada peso aplicado está en UNA fila, y esa fila
-- resta sólo si su cuenta está vigente.
--
-- Partido de las definiciones VIVAS de producción (2026-10-22, md5 iguales a
-- las del entorno de pruebas). Hoy distribución tiene 0 documentos en
-- producción: no hay datos que corregir.

-- ── 1 · El saldo a favor ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.dist_saldo_a_favor(p_cliente bigint)
 RETURNS numeric
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
    -- Tres fuentes, un número: lo que volvió de un documento invalidado, lo
    -- que dejó una nota de crédito por devolución (sólo la parte que NO se
    -- aplicó a la deuda: `a_favor` ya es total − credito_aplicado), menos lo
    -- que ya se usó para pagar. Lo usado en una cuenta ANULADA no resta: el
    -- documento se invalidó y ese dinero vuelve al cliente (si se corrigió,
    -- `dist_trasladar_abonos` ya movió a la cuenta nueva lo que cupo).
    SELECT round(
        coalesce((SELECT sum(monto) FROM public.dist_reintegros WHERE cliente_id = p_cliente AND destino = 'saldo'), 0)
      + coalesce((SELECT sum(dv.a_favor) FROM public.dist_devoluciones dv
                    JOIN public.dist_dte n ON n.id = dv.nota_id
                   WHERE dv.cliente_id = p_cliente AND dv.estado = 'emitida' AND dv.a_favor > 0
                     AND n.estado NOT IN ('descartado', 'rechazado', 'invalidado')), 0)
      - coalesce((SELECT sum(a.monto) FROM public.dist_saldo_aplicaciones a
                    JOIN public.dist_cxc x ON x.id = a.cxc_id
                   WHERE a.cliente_id = p_cliente AND x.estado <> 'anulada'), 0), 2);
$function$;

-- ── 2 · Trasladar: los abonos y, después, lo aplicado del saldo a favor ─────
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
    v_fav_mov numeric := 0;
    v_fav_dev numeric := 0;
    v_toma    numeric;
    v_resto   numeric;
    a         record;
    s         record;
BEGIN
    SELECT * INTO v_desde FROM public.dist_cxc WHERE id = p_desde FOR UPDATE;
    IF NOT FOUND THEN
        RETURN json_build_object('movido', 0, 'reintegrado', 0, 'a_favor_movido', 0, 'a_favor_devuelto', 0);
    END IF;
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

    -- Lo aplicado del saldo a favor: a la cuenta nueva lo que quepa. Lo que
    -- no cabe se queda en la vieja (anulada) y por eso vuelve solo al saldo
    -- a favor del cliente (`dist_saldo_a_favor` no lo resta): nada que
    -- reintegrar, porque nunca salió dinero de la caja.
    FOR s IN
        SELECT id, emisor_id, cliente_id, monto, nota, creado_por, created_at
          FROM public.dist_saldo_aplicaciones WHERE cxc_id = p_desde
         ORDER BY id
    LOOP
        v_toma := least(s.monto, v_cabe);
        v_resto := s.monto - v_toma;
        IF v_toma > 0 THEN
            IF v_resto > 0 THEN
                INSERT INTO public.dist_saldo_aplicaciones (emisor_id, cliente_id, cxc_id, monto, nota, creado_por, created_at)
                VALUES (s.emisor_id, s.cliente_id, p_hacia, round(v_toma, 2), s.nota, s.creado_por, s.created_at);
                UPDATE public.dist_saldo_aplicaciones SET monto = round(v_resto, 2) WHERE id = s.id;
            ELSE
                UPDATE public.dist_saldo_aplicaciones SET cxc_id = p_hacia WHERE id = s.id;
            END IF;
            v_cabe := v_cabe - v_toma;
            v_fav_mov := v_fav_mov + v_toma;
        END IF;
        v_fav_dev := v_fav_dev + v_resto;
    END LOOP;

    PERFORM public.dist_cxc_recalcular(p_desde);
    IF p_hacia IS NOT NULL THEN PERFORM public.dist_cxc_recalcular(p_hacia); END IF;
    RETURN json_build_object('movido', round(v_movido, 2), 'reintegrado', round(v_reint, 2),
                             'a_favor_movido', round(v_fav_mov, 2), 'a_favor_devuelto', round(v_fav_dev, 2));
END $function$;
REVOKE EXECUTE ON FUNCTION public.dist_trasladar_abonos(bigint, bigint, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dist_trasladar_abonos(bigint, bigint, bigint) TO service_role;

-- ── 3 · Refacturar tras rechazo o descarte: también si sólo hubo saldo a favor ─
-- (definición viva; cambia `x.abonado > 0` por `x.abonado + x.acreditado > 0`).
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
        -- Refacturado tras un rechazo o un descarte: lo que se abonó —o se
        -- pagó con saldo a favor— a la cuenta del documento anterior del
        -- MISMO pedido pasa a ésta.
        IF v_cxc IS NOT NULL THEN
            FOR v_vieja IN
                SELECT x.id, x.dte_id FROM public.dist_cxc x JOIN public.dist_dte o ON o.id = x.dte_id
                 WHERE x.pedido_id = NEW.pedido_id AND x.id <> v_cxc AND x.estado = 'anulada'
                   AND o.estado IN ('descartado', 'rechazado') AND x.abonado + x.acreditado > 0
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

-- ── 4 · La solicitud dice cuánto vuelve a favor, incluido lo aplicado ───────
CREATE OR REPLACE FUNCTION public.dist_pedir_invalidacion(p_dte bigint, p_accion text, p_motivo text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_yo      uuid := public.auth_employee_id();
    d         public.dist_dte%ROWTYPE;
    v_plazo   json;
    v_cliente text;
    v_vend    uuid;
    v_quien   text;
    v_motivo  text := nullif(btrim(coalesce(p_motivo, '')), '');
    v_x       public.dist_cxc%ROWTYPE;
    v_efe     numeric := 0;
    v_favor   numeric := 0;
    v_id      uuid;
    v_dest    uuid[];
    v_titulo  text;
    v_cuerpo  text;
    v_link    text;
BEGIN
    IF v_yo IS NULL OR NOT (SELECT public.auth_can_edit_any(ARRAY['distribucion'])) THEN
        RAISE EXCEPTION 'DIST_SIN_PERMISO: no puedes vender en Distribución';
    END IF;
    IF p_accion NOT IN ('anular', 'corregir') THEN
        RAISE EXCEPTION 'DIST_INVALIDACION: acción desconocida';
    END IF;
    IF v_motivo IS NULL THEN
        RAISE EXCEPTION 'DIST_INVALIDACION: escribe por qué hay que %', CASE p_accion WHEN 'anular' THEN 'deshacer la venta' ELSE 'corregir el documento' END;
    END IF;
    SELECT * INTO d FROM public.dist_dte WHERE id = p_dte FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'DIST_INVALIDACION: no existe ese documento'; END IF;
    IF d.estado <> 'sellado' OR d.tipo NOT IN ('01', '03') OR d.pedido_id IS NULL THEN
        RAISE EXCEPTION 'DIST_INVALIDACION: sólo se invalida una venta sellada por Hacienda';
    END IF;
    IF d.invalidacion_estado IN ('pendiente', 'procesada') THEN
        RAISE EXCEPTION 'DIST_INVALIDACION: este documento ya se está invalidando';
    END IF;
    IF EXISTS (SELECT 1 FROM public.dist_pedidos WHERE reemplaza_dte_id = p_dte AND estado <> 'anulado') THEN
        RAISE EXCEPTION 'DIST_INVALIDACION: ya hay una corrección abierta para este documento';
    END IF;
    IF EXISTS (SELECT 1 FROM public.approval_requests
                WHERE type = 'DIST_INVALIDACION' AND status = 'PENDING' AND metadata->>'dte_id' = p_dte::text) THEN
        RAISE EXCEPTION 'DIST_INVALIDACION_PEDIDA: ya hay una solicitud esperando decisión para este documento';
    END IF;
    -- Una nota de crédito ya devolvió parte (a la deuda o a favor del
    -- cliente): invalidar el original encima devolvería lo mismo dos veces.
    -- Hacienda tampoco lo acepta: primero se invalida la nota.
    IF EXISTS (SELECT 1 FROM public.dist_devoluciones dv JOIN public.dist_dte n ON n.id = dv.nota_id
                WHERE dv.dte_origen_id = p_dte AND dv.estado = 'emitida'
                  AND n.estado NOT IN ('descartado', 'rechazado', 'invalidado')) THEN
        RAISE EXCEPTION 'DIST_INVALIDACION: Este documento tiene una nota de crédito. Primero hay que invalidar la nota.';
    END IF;
    v_plazo := public.dist_plazo_invalidacion_de(p_dte);
    IF v_plazo->>'estado' = 'vencido' THEN
        RAISE EXCEPTION 'DIST_INVALIDACION: venció el plazo para invalidar este documento (%)', v_plazo->>'limite';
    END IF;

    SELECT c.nombre, p.vendedor_id INTO v_cliente, v_vend
      FROM public.dist_pedidos p JOIN public.dist_clientes c ON c.id = p.cliente_id WHERE p.id = d.pedido_id;

    -- Qué pasaría con el dinero, para que quien decide lo vea antes.
    IF p_accion = 'anular' THEN
        -- Lo cobrado al vender sale del documento (resumen.pagos), igual que
        -- en dist_reintegrar_documento.
        SELECT coalesce(sum((x->>'montoPago')::numeric) FILTER (WHERE x->>'codigo' = '01'), 0),
               coalesce(sum((x->>'montoPago')::numeric) FILTER (WHERE x->>'codigo' NOT IN ('01', '13')), 0)
          INTO v_efe, v_favor FROM jsonb_array_elements(coalesce(d.json->'resumen'->'pagos', '[]'::jsonb)) x;
        SELECT v_efe + coalesce(sum(ab.monto) FILTER (WHERE r.forma = '01'), 0),
               v_favor + coalesce(sum(ab.monto) FILTER (WHERE r.forma <> '01'), 0)
          INTO v_efe, v_favor
          FROM public.dist_cxc x JOIN public.dist_cxc_abonos ab ON ab.cxc_id = x.id
          JOIN public.dist_recibos r ON r.id = ab.recibo_id AND r.anulado_at IS NULL
         WHERE x.dte_id = p_dte;
        -- Lo que se pagó con saldo a favor vuelve al saldo a favor.
        SELECT v_favor + coalesce(sum(a.monto), 0) INTO v_favor
          FROM public.dist_cxc x JOIN public.dist_saldo_aplicaciones a ON a.cxc_id = x.id
         WHERE x.dte_id = p_dte;
    END IF;
    SELECT * INTO v_x FROM public.dist_cxc WHERE dte_id = p_dte;

    -- Sin `approver_id` al insertar, igual que DIST_DESCUENTO: el aviso lo
    -- manda esta función, no `notificar_solicitud_creada`.
    INSERT INTO public.approval_requests (employee_id, type, status, note, metadata)
    VALUES (v_yo, 'DIST_INVALIDACION', 'PENDING', v_motivo,
            jsonb_build_object('dte_id', p_dte, 'accion', p_accion, 'tipo_invalidacion', CASE p_accion WHEN 'anular' THEN 2 ELSE 1 END,
                               'pedido_id', d.pedido_id, 'vendedor_id', v_vend, 'cliente', v_cliente,
                               'tipo_documento', d.tipo, 'numero_control', d.numero_control, 'fec_emi', d.fec_emi,
                               'total', d.total_pagar, 'abonado', coalesce(v_x.abonado, 0),
                               'devolver_efectivo', round(v_efe, 2), 'a_favor', round(v_favor, 2),
                               'plazo', v_plazo))
    RETURNING id INTO v_id;

    SELECT array_agg(e.id) INTO v_dest FROM public.employees e
     WHERE e.status = 'ACTIVO' AND e.id <> v_yo
       AND public.puede_aprobar_modulo(e.id, 'requests_distribucion');
    IF array_length(v_dest, 1) = 1 THEN
        UPDATE public.approval_requests SET approver_id = v_dest[1] WHERE id = v_id;
    END IF;
    SELECT name INTO v_quien FROM public.employees WHERE id = v_yo;
    v_titulo := CASE p_accion WHEN 'anular' THEN 'Deshacer una venta' ELSE 'Corregir un documento' END;
    v_cuerpo := coalesce(v_quien, 'Un vendedor') || CASE p_accion WHEN 'anular' THEN ' pide deshacer ' ELSE ' pide corregir ' END
             || CASE d.tipo WHEN '03' THEN 'el Crédito Fiscal ' ELSE 'la Factura ' END || d.numero_control
             || ' de ' || coalesce(v_cliente, 'un cliente') || ' ($' || to_char(d.total_pagar, 'FM999,999,990.00') || ')'
             || ' — ' || left(v_motivo, 140);
    v_link := '/torogoz/solicitudes?solicitud=' || v_id;
    PERFORM public.dist_avisar(v_dest, v_titulo, v_cuerpo, v_link, 'REQUEST_PENDING',
        jsonb_build_object('request_id', v_id, 'request_type', 'DIST_INVALIDACION'), v_yo);

    RETURN json_build_object('solicitud_id', v_id, 'aprobadores', coalesce(array_length(v_dest, 1), 0));
END $function$;
REVOKE EXECUTE ON FUNCTION public.dist_pedir_invalidacion(bigint, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dist_pedir_invalidacion(bigint, text, text) TO authenticated, service_role;
