-- La reserva con anticipo se cierra sola al facturarse su preventa (2026-11-21).
--
-- La R-000177 de Salud 3 (sucursal 4): anticipo de $3.00 en efectivo, «Enviar
-- a caja», la caja la facturó por $5.20 el 16-nov… y siguió «Lista para
-- retirar» cinco días, ofreciendo «Enviar a caja» otra vez. El cierre por
-- factura saltaba a propósito toda reserva con anticipo sin aplicar —el vale
-- de «Retirar» es lo que saca de la cuenta del cajón el efectivo que entró el
-- día del anticipo— y sólo avisaba «termínala con «Retirar»». De 12 avisos,
-- uno se abrió.
--
-- Ahora, si TODO lo pagado fue efectivo de la caja y la reserva está lista,
-- la base pide ese mismo vale (APLICA_ANTICIPO) apenas ve la factura:
-- `aplicar-anticipo-facturado` lo releva a `operar-caja`, que comprueba la
-- preventa facturada en esa sala, el monto y que sea una sola vez, y marca la
-- reserva retirada. El vale sale en la caja abierta en ese momento: la misma
-- en que se cobró la factura. Reintenta durante 30 minutos (cada ~9) y, si no
-- salió, avisa a la sucursal que la termine con «Retirar», una vez. Lo que no
-- es efectivo (tarjeta, en línea) sigue como antes: se aplica al crédito
-- desde «Retirar».
--
-- `preventas_cerrar_facturadas` se reescribe desde su definición VIVA (md5
-- 3cdd09e78e17ebd3dc8d7aef880ca5e8); cambia sólo la rama del anticipo, el
-- aviso y el bloque de reintento del principio.
SET lock_timeout = '5s';

-- Lo pagado en efectivo de la caja, si es TODO lo pagado; si no, NULL.
CREATE OR REPLACE FUNCTION public.reserva_anticipo_solo_efectivo(p_id bigint)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE r public.app_reservas; k record; v_ef numeric; v_otras numeric;
BEGIN
  SELECT * INTO r FROM public.app_reservas WHERE id = p_id;
  IF NOT FOUND OR coalesce(r.pago_prueba, false) THEN RETURN NULL; END IF;
  SELECT * INTO k FROM public.reserva_cuenta(p_id);
  SELECT coalesce(sum(monto) FILTER (WHERE forma_pago = 'EFECTIVO'), 0),
         coalesce(sum(monto) FILTER (WHERE forma_pago <> 'EFECTIVO'), 0)
    INTO v_ef, v_otras
    FROM public.caja_movimientos_portal
   WHERE reserva_id = p_id AND tipo_codigo = 'APARTADO' AND anulado_at IS NULL;
  IF v_ef > 0.004 AND v_otras < 0.005 AND abs(v_ef - coalesce(k.pagado, 0)) < 0.005 THEN
    RETURN round(v_ef, 2);
  END IF;
  RETURN NULL;
END $function$;
REVOKE ALL ON FUNCTION public.reserva_anticipo_solo_efectivo(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserva_anticipo_solo_efectivo(bigint) TO service_role;

-- Pide el vale (asíncrono, pg_net) a `aplicar-anticipo-facturado`, que lo
-- releva a `operar-caja`. Sin el secreto en la bóveda —el entorno de pruebas
-- no lo tiene— no pide nada.
CREATE OR REPLACE FUNCTION public.preventa_pedir_vale_de_anticipo(p_reserva bigint, p_preventa bigint, p_branch bigint, p_monto numeric, p_codigo text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v_secreto text;
BEGIN
  SELECT decrypted_secret INTO v_secreto FROM vault.decrypted_secrets WHERE name = 'fiscal_invoke_secret';
  IF v_secreto IS NULL THEN
    RAISE NOTICE 'preventa_pedir_vale_de_anticipo: falta fiscal_invoke_secret en la bóveda';
    RETURN NULL;
  END IF;
  RETURN net.http_post(
    url := 'https://sacecdkdmsdvgqnrsett.supabase.co/functions/v1/aplicar-anticipo-facturado',
    body := jsonb_build_object('reserva_id', p_reserva, 'preventa_id', p_preventa, 'sala', p_branch,
                               'monto', p_monto, 'codigo', p_codigo),
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_secreto),
    timeout_milliseconds := 120000);
END $function$;
REVOKE ALL ON FUNCTION public.preventa_pedir_vale_de_anticipo(bigint, bigint, bigint, numeric, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.preventa_pedir_vale_de_anticipo(bigint, bigint, bigint, numeric, text) TO service_role;

CREATE OR REPLACE FUNCTION public.preventas_cerrar_facturadas()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  p record; a record; k record;
  v_cerradas int := 0; v_dest uuid[]; v_pend text[]; v_ok text[]; v_auto text[]; v_cod text; v_dif jsonb;
  v_ef numeric; v_min int;
BEGIN
  -- Un envío que nunca contestó no traba la reserva para siempre.
  UPDATE public.preventas
     SET estado = CASE WHEN externo_id IS NOT NULL THEN 'viva' ELSE 'fallida' END,
         error = coalesce(error, 'el envío no terminó'), updated_at = now()
   WHERE estado = 'enviando' AND updated_at < now() - interval '10 minutes';

  -- El vale del anticipo que todavía no salió (2026-11-21): se reintenta
  -- cada ~9 minutos durante media hora; después, se avisa una vez.
  FOR a IN
    SELECT r.id, r.branch_id, r.pedido, pv.id AS pv_id, pv.facturada_at
      FROM public.app_reservas r
      JOIN public.preventas pv ON pv.id = r.preventa_id
     WHERE pv.estado = 'facturada' AND r.estado = 'lista'
       AND pv.facturada_at > now() - interval '2 hours'
       AND NOT EXISTS (SELECT 1 FROM public.apartado_aplicaciones x WHERE x.reserva_id = r.id)
  LOOP
    v_ef := public.reserva_anticipo_solo_efectivo(a.id);
    CONTINUE WHEN v_ef IS NULL;
    v_cod := coalesce(a.pedido, 'R-' || lpad(a.id::text, 6, '0'));
    v_min := floor(extract(epoch FROM now() - a.facturada_at) / 60)::int;
    IF v_min < 30 THEN
      IF v_min >= 3 AND (v_min / 3) % 3 = 0 THEN
        PERFORM public.preventa_pedir_vale_de_anticipo(a.id, a.pv_id, a.branch_id, v_ef, v_cod);
      END IF;
    ELSIF NOT EXISTS (SELECT 1 FROM public.notifications n
                       WHERE n.type = 'RESERVA_APP' AND n.created_at >= a.facturada_at
                         AND n.metadata->>'check_key' = 'reserva_anticipo_manual:' || a.id) THEN
      v_dest := public.destinatarios_de_reservas(a.branch_id);
      IF v_dest IS NOT NULL THEN
        PERFORM public.notify_employees(v_dest, 'RESERVA_APP', 'Reserva facturada · ' || v_cod,
          'El anticipo no se pudo aplicar solo. Termínala con «Retirar».', '/reservas',
          jsonb_build_object('check_key', 'reserva_anticipo_manual:' || a.id, 'preventa_id', a.pv_id), true, a.branch_id::int);
      END IF;
    END IF;
  END LOOP;

  FOR p IN
    SELECT pv.id, pv.branch_id, pv.reservas_ids, pv.externo_ref, pv.enviada_por, pv.origen,
           si.id AS si_id, si.correlativo, si.codigo_generacion
      FROM public.preventas pv
      JOIN public.sales_invoices si ON si.erp_invoice_id = pv.externo_id
     WHERE (pv.estado = 'viva' OR (pv.estado = 'descartada' AND pv.error = 'La borraron en caja.')) AND pv.sistema = 'caja' AND pv.externo_id IS NOT NULL
       AND si.branch_id = pv.branch_id AND public.venta_valida(si.estado)
       FOR UPDATE OF pv SKIP LOCKED
  LOOP
    UPDATE public.preventas
       SET estado = 'facturada', sales_invoice_id = p.si_id, codigo_generacion = p.codigo_generacion,
           facturada_at = now(), updated_at = now()
     WHERE id = p.id;

    -- ¿Se cobró lo prometido? (2026-11-16). Un error acá no frena el cierre.
    BEGIN
      v_dif := public.preventa_cobro_distinto(p.id);
      IF v_dif IS NOT NULL THEN
        UPDATE public.preventas SET cobro_distinto = v_dif WHERE id = p.id;
        IF coalesce((v_dif->>'alerta')::boolean, false) THEN
          v_dest := (SELECT array_agg(DISTINCT x) FROM unnest(coalesce(public.destinatarios_de_reservas(p.branch_id), '{}') || p.enviada_por) x
                      WHERE x IS NOT NULL);
          IF v_dest IS NOT NULL THEN
            PERFORM public.notify_employees(v_dest, 'PREVENTA_COBRO_DISTINTO',
              'Se cobró distinto · preventa #' || coalesce(p.externo_ref, p.id::text),
              'Se prometió $' || to_char((v_dif->>'total_prometido')::numeric, 'FM999990.00')
                || ' y se facturó $' || to_char((v_dif->>'total_cobrado')::numeric, 'FM999990.00')
                || ' (factura ' || coalesce(p.correlativo, '') || ').',
              CASE WHEN p.origen = 'directa' THEN '/preventa' ELSE '/reservas' END,
              jsonb_build_object('check_key', 'preventa_cobro_distinto:' || p.id, 'preventa_id', p.id, 'diferencia', v_dif),
              true, p.branch_id::int);
          END IF;
        END IF;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'preventa % comparar cobro: %', p.id, SQLERRM;
    END;

    IF cardinality(p.reservas_ids) = 0 THEN CONTINUE; END IF;
    v_pend := ARRAY[]::text[]; v_ok := ARRAY[]::text[]; v_auto := ARRAY[]::text[];

    FOR a IN SELECT * FROM public.app_reservas WHERE id = ANY (p.reservas_ids) AND preventa_id = p.id ORDER BY id FOR UPDATE LOOP
      v_cod := coalesce(a.pedido, 'R-' || lpad(a.id::text, 6, '0'));
      SELECT * INTO k FROM public.reserva_cuenta(a.id);
      IF a.estado NOT IN ('pendiente', 'lista') THEN
        v_pend := v_pend || (v_cod || ' ya estaba ' || a.estado);
        CONTINUE;
      END IF;
      IF k.pagado > 0.004 AND NOT EXISTS (SELECT 1 FROM public.apartado_aplicaciones x WHERE x.reserva_id = a.id) THEN
        -- Todo en efectivo y lista: el vale lo pide la base, como «Retirar».
        v_ef := CASE WHEN a.estado = 'lista' THEN public.reserva_anticipo_solo_efectivo(a.id) END;
        IF v_ef IS NOT NULL THEN
          BEGIN
            PERFORM public.preventa_pedir_vale_de_anticipo(a.id, p.id, p.branch_id, v_ef, v_cod);
            v_auto := v_auto || v_cod;
            CONTINUE;
          EXCEPTION WHEN OTHERS THEN
            RAISE WARNING 'preventa % vale del anticipo %: %', p.id, a.id, SQLERRM;
          END;
        END IF;
        v_pend := v_pend || (v_cod || ': tiene $' || to_char(k.pagado, 'FM999990.00') || ' pagado; termínala con «Retirar»');
        CONTINUE;
      END IF;
      BEGIN
        UPDATE public.app_reservas
           SET estado = 'retirada', cerrada_at = now(), updated_at = now(),
               pago_estado = CASE WHEN pago_estado IN ('pendiente', 'anticipo') THEN 'pagado' ELSE pago_estado END,
               pagado_at = coalesce(pagado_at, now())
         WHERE id = a.id;
        INSERT INTO public.audit_logs (user_id, action, target_id, details, branch_id, source)
        VALUES (NULL, 'RESERVA_RETIRADA', a.id::text,
                jsonb_build_object('por', 'factura', 'preventa', p.id, 'factura', p.correlativo, 'sales_invoice_id', p.si_id),
                a.branch_id, 'SYSTEM');
        IF a.origen = 'app' THEN
          INSERT INTO public.app_cliente_avisos (customer_id, tipo, ref, titulo, cuerpo, url)
          VALUES (a.customer_id, 'reserva', 'base:retirada:' || v_cod, '¡Gracias por tu compra!',
                  a.producto_nombre || ' ya es tuyo. Tu reserva quedó entregada.', '/reservas')
          ON CONFLICT (customer_id, tipo, ref) DO NOTHING;
        END IF;
        v_ok := v_ok || v_cod;
        v_cerradas := v_cerradas + 1;
      EXCEPTION WHEN OTHERS THEN
        v_pend := v_pend || (v_cod || ': no se pudo cerrar (' || SQLERRM || ')');
      END;
    END LOOP;

    -- Las que esperan su vale no avisan ahora: el vale las cierra, y si no
    -- sale en media hora avisa el bloque de reintento.
    IF cardinality(v_ok) + cardinality(v_pend) = 0 THEN CONTINUE; END IF;
    v_dest := public.destinatarios_de_reservas(p.branch_id);
    IF v_dest IS NOT NULL THEN
      PERFORM public.notify_employees(v_dest, 'RESERVA_APP',
        CASE WHEN cardinality(v_pend) = 0 THEN 'Reserva entregada · ' ELSE 'Reserva facturada · ' END
          || coalesce(v_ok[1], split_part(coalesce(v_pend[1], ''), ':', 1)),
        CASE WHEN cardinality(v_ok) > 0 THEN 'Se cerró sola con la factura ' || coalesce(p.correlativo, '') || '.'
             ELSE 'Se facturó la preventa #' || coalesce(p.externo_ref, '') || '.' END
          || CASE WHEN cardinality(v_pend) > 0 THEN ' ' || array_to_string(v_pend, '. ') || '.' ELSE '' END,
        '/reservas', jsonb_build_object('check_key', 'reserva_facturada:' || p.id, 'preventa_id', p.id), true, p.branch_id::int);
    END IF;
  END LOOP;
  RETURN v_cerradas;
END;
$function$;
