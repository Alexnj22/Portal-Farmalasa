SET lock_timeout = '5s';

-- ═══════════════════════════════════════════════════════════════════════════
-- El anticipo con tarjeta va al crédito y se abona solo (2026-11-23).
--
-- La R-000203 de Salud 3 (sucursal 4): anticipo de $24.25 con tarjeta
-- (voucher 003907, caja del 22-nov). «Enviar a caja» mandó la preventa AL
-- CONTADO —`preventa_preparar` no decía cómo paga y `armarVenta` caía a
-- contado— y la caja la cobró con tarjeta: el mismo voucher contado dos
-- veces, y «Retirar» sin ningún crédito al que abonar. Era el primer anticipo
-- que no fue en efectivo que pasaba por una preventa.
--
-- Un anticipo que no fue TODO en efectivo de la caja no se puede sacar con un
-- vale (no hay efectivo que sacar): la factura va al crédito y el anticipo se
-- abona a ese crédito. Ahora:
--   · `preventa_preparar` dice `pago = 'credito'` en ese caso;
--   · `preventas_cerrar_facturadas`, al ver la factura AL CRÉDITO, pide el
--     abono (`preventa_pedir_abono_de_anticipo` → `aplicar-anticipo-facturado`
--     → `creditos-erp`), con los mismos reintentos que el vale de efectivo.
-- Si la caja la factura de contado igual, sigue el aviso «termínala con
-- Retirar», y «Retirar» dice qué factura hay que anular.
-- ═══════════════════════════════════════════════════════════════════════════

-- ¿El anticipo de esta reserva se aplica al CRÉDITO? Hay algo pagado y no fue
-- todo efectivo de la caja. Las de prueba no.
CREATE OR REPLACE FUNCTION public.reserva_anticipo_va_al_credito(p_id bigint)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE r public.app_reservas; k record;
BEGIN
  SELECT * INTO r FROM public.app_reservas WHERE id = p_id;
  IF NOT FOUND OR coalesce(r.pago_prueba, false) THEN RETURN false; END IF;
  SELECT * INTO k FROM public.reserva_cuenta(p_id);
  RETURN coalesce(k.pagado, 0) > 0.004 AND public.reserva_anticipo_solo_efectivo(p_id) IS NULL;
END $function$;
REVOKE ALL ON FUNCTION public.reserva_anticipo_va_al_credito(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserva_anticipo_va_al_credito(bigint) TO service_role;

-- El pedido del abono: mismo relevo y mismo secreto que el vale de efectivo.
CREATE OR REPLACE FUNCTION public.preventa_pedir_abono_de_anticipo(p_reserva bigint, p_preventa bigint, p_branch bigint, p_codigo text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v_secreto text;
BEGIN
  SELECT decrypted_secret INTO v_secreto FROM vault.decrypted_secrets WHERE name = 'fiscal_invoke_secret';
  IF v_secreto IS NULL THEN
    RAISE NOTICE 'preventa_pedir_abono_de_anticipo: falta fiscal_invoke_secret en la bóveda';
    RETURN NULL;
  END IF;
  RETURN net.http_post(
    url := 'https://sacecdkdmsdvgqnrsett.supabase.co/functions/v1/aplicar-anticipo-facturado',
    body := jsonb_build_object('modo', 'credito', 'reserva_id', p_reserva, 'preventa_id', p_preventa,
                               'sala', p_branch, 'codigo', p_codigo),
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_secreto),
    timeout_milliseconds := 120000);
END $function$;
REVOKE ALL ON FUNCTION public.preventa_pedir_abono_de_anticipo(bigint, bigint, bigint, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.preventa_pedir_abono_de_anticipo(bigint, bigint, bigint, text) TO service_role;

CREATE OR REPLACE FUNCTION public.preventa_preparar(p_employee uuid, p_reservas bigint[])
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  e public.employees;
  v_branch bigint; v_branch2 bigint; v_customer bigint; v_customer2 bigint; v_n int; v_id bigint; v_erp int;
  v_todas boolean; v_puede boolean; v_ref text;
  r record;
BEGIN
  SELECT * INTO e FROM public.employees WHERE id = p_employee AND status = 'ACTIVO';
  IF NOT FOUND THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501'; END IF;
  IF p_reservas IS NULL OR cardinality(p_reservas) = 0 THEN RAISE EXCEPTION 'No se dijo qué reserva.'; END IF;

  PERFORM 1 FROM public.app_reservas WHERE id = ANY (p_reservas) ORDER BY id FOR UPDATE;
  SELECT count(*), min(branch_id), max(branch_id), min(customer_id), max(customer_id)
    INTO v_n, v_branch, v_branch2, v_customer, v_customer2
    FROM public.app_reservas WHERE id = ANY (p_reservas);
  IF v_n <> cardinality(p_reservas) THEN RAISE EXCEPTION 'Una de esas reservas no existe.'; END IF;
  IF v_branch <> v_branch2 THEN RAISE EXCEPTION 'Esas reservas son de sucursales distintas.'; END IF;
  IF v_customer <> v_customer2 THEN RAISE EXCEPTION 'Esas reservas son de clientes distintos.'; END IF;

  SELECT bool_or(rp.can_edit), bool_or(rp.can_edit AND rp.scope = 'ALL')
    INTO v_puede, v_todas
    FROM public.role_permissions rp
   WHERE rp.role_id = ANY (public.roles_efectivos_de(e.id)) AND rp.module_key = 'reservas';
  IF NOT coalesce(v_puede, false) OR NOT (coalesce(v_todas, false) OR coalesce(public.sala_de_apoyo_vigente(e.id)::bigint, e.branch_id::bigint) = v_branch) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  FOR r IN SELECT a.*, pv.estado AS pv_estado, pv.externo_ref AS pv_ref, pv.created_at AS pv_at
             FROM public.app_reservas a LEFT JOIN public.preventas pv ON pv.id = a.preventa_id
            WHERE a.id = ANY (p_reservas) LOOP
    IF r.estado NOT IN ('pendiente', 'lista') THEN
      RAISE EXCEPTION 'La reserva R-% ya no está abierta.', lpad(r.id::text, 6, '0');
    END IF;
    IF r.origen = 'app' AND r.bajo_receta AND r.receta_estado IS DISTINCT FROM 'aprobada' THEN
      RAISE EXCEPTION 'La receta de la reserva R-% todavía no está aprobada.', lpad(r.id::text, 6, '0');
    END IF;
    IF r.producto_id IS NULL OR r.producto_id <= 0 THEN
      RAISE EXCEPTION '«%» no es un producto del catálogo: no se puede mandar a la caja.', r.producto_nombre;
    END IF;
    IF r.pv_estado IN ('viva', 'sin_enlace', 'facturada')
       OR (r.pv_estado = 'enviando' AND r.pv_at > now() - interval '5 minutes') THEN
      RAISE EXCEPTION 'La reserva R-% ya tiene una preventa en la caja%.', lpad(r.id::text, 6, '0'),
        coalesce(' (#' || r.pv_ref || ')', '');
    END IF;
  END LOOP;

  SELECT erp_sucursal_id INTO v_erp FROM public.erp_sucursal_map WHERE branch_id = v_branch AND NOT es_bodega;
  IF v_erp IS NULL THEN RAISE EXCEPTION 'Esa sucursal no factura en la caja.'; END IF;

  INSERT INTO public.preventas (branch_id, customer_id, reservas_ids, enviada_por)
  VALUES (v_branch, v_customer, (SELECT array_agg(x ORDER BY x) FROM unnest(p_reservas) x), p_employee)
  RETURNING id INTO v_id;
  UPDATE public.app_reservas SET preventa_id = v_id, updated_at = now() WHERE id = ANY (p_reservas);

  SELECT coalesce(min(pedido), 'R-' || lpad(min(id)::text, 6, '0')) INTO v_ref
    FROM public.app_reservas WHERE id = ANY (p_reservas);

  RETURN json_build_object(
    'preventa_id', v_id, 'erp_sucursal', v_erp, 'branch_id', v_branch, 'codigo', v_ref,
    'documento', (SELECT min(documento) FROM public.app_reservas WHERE id = ANY (p_reservas)),
    -- Anticipo que no fue todo en efectivo: al crédito, y se le abona al facturarse (2026-11-23).
    'pago', CASE WHEN EXISTS (SELECT 1 FROM unnest(p_reservas) x WHERE public.reserva_anticipo_va_al_credito(x))
                 THEN 'credito' ELSE 'contado' END,
    'cliente', (SELECT json_build_object('erp_id', c.erp_id, 'name', c.name) FROM public.customers c WHERE c.id = v_customer),
    'vendedor', json_build_object('code', e.code, 'role_id', e.role_id),
    'pagado', (SELECT coalesce(sum(k.pagado), 0) FROM unnest(p_reservas) x, public.reserva_cuenta(x) k),
    'falta_pagar', (SELECT coalesce(sum(k.falta_pagar), 0) FROM unnest(p_reservas) x, public.reserva_cuenta(x) k),
    'renglones', (SELECT json_agg(json_build_object(
        'reserva_id', a.id, 'producto_id', a.producto_id, 'nombre', a.producto_nombre, 'cantidad', a.cantidad,
        'factor', a.factor, 'precio_unitario', a.precio_unitario, 'precio_normal', a.precio_normal,
        'lista_precio', a.lista_precio) ORDER BY a.id)
      FROM public.app_reservas a WHERE a.id = ANY (p_reservas)));
END;
$function$;

CREATE OR REPLACE FUNCTION public.preventas_cerrar_facturadas()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  p record; a record; k record;
  v_cerradas int := 0; v_dest uuid[]; v_pend text[]; v_ok text[]; v_auto text[]; v_cod text; v_dif jsonb;
  v_ef numeric; v_min int; v_cred boolean;
BEGIN
  -- Un envío que nunca contestó no traba la reserva para siempre.
  UPDATE public.preventas
     SET estado = CASE WHEN externo_id IS NOT NULL THEN 'viva' ELSE 'fallida' END,
         error = coalesce(error, 'el envío no terminó'), updated_at = now()
   WHERE estado = 'enviando' AND updated_at < now() - interval '10 minutes';

  -- El vale del anticipo —o su abono al crédito (2026-11-23)— que todavía no
  -- salió: se reintenta cada ~9 minutos durante media hora; después, se avisa una vez.
  FOR a IN
    SELECT r.id, r.branch_id, r.pedido, pv.id AS pv_id, pv.facturada_at, si.tipo_pago
      FROM public.app_reservas r
      JOIN public.preventas pv ON pv.id = r.preventa_id
      LEFT JOIN public.sales_invoices si ON si.id = pv.sales_invoice_id
     WHERE pv.estado = 'facturada' AND r.estado = 'lista'
       AND pv.facturada_at > now() - interval '2 hours'
       AND NOT EXISTS (SELECT 1 FROM public.apartado_aplicaciones x WHERE x.reserva_id = r.id)
  LOOP
    v_ef := public.reserva_anticipo_solo_efectivo(a.id);
    v_cred := v_ef IS NULL AND a.tipo_pago = 'credito' AND public.reserva_anticipo_va_al_credito(a.id);
    CONTINUE WHEN v_ef IS NULL AND NOT v_cred;
    v_cod := coalesce(a.pedido, 'R-' || lpad(a.id::text, 6, '0'));
    v_min := floor(extract(epoch FROM now() - a.facturada_at) / 60)::int;
    IF v_min < 30 THEN
      IF v_min >= 3 AND (v_min / 3) % 3 = 0 THEN
        IF v_cred THEN
          PERFORM public.preventa_pedir_abono_de_anticipo(a.id, a.pv_id, a.branch_id, v_cod);
        ELSE
          PERFORM public.preventa_pedir_vale_de_anticipo(a.id, a.pv_id, a.branch_id, v_ef, v_cod);
        END IF;
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
           si.id AS si_id, si.correlativo, si.codigo_generacion, si.tipo_pago
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
        -- Con tarjeta, transferencia o en línea, facturada AL CRÉDITO y lista:
        -- el anticipo se abona a ese crédito (2026-11-23, R-000203).
        IF a.estado = 'lista' AND p.tipo_pago = 'credito' AND public.reserva_anticipo_va_al_credito(a.id) THEN
          BEGIN
            PERFORM public.preventa_pedir_abono_de_anticipo(a.id, p.id, p.branch_id, v_cod);
            v_auto := v_auto || v_cod;
            CONTINUE;
          EXCEPTION WHEN OTHERS THEN
            RAISE WARNING 'preventa % abono del anticipo %: %', p.id, a.id, SQLERRM;
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
