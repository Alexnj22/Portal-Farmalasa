-- Preventa: ¿se cobró lo que se prometió? (2026-11-16, usuario: «si»).
-- La reserva #12 prometió $27.15 y caja la facturó a $28.40: alguien cambió
-- la lista al cobrar, y nadie se enteró. Al cerrarse una preventa con su
-- factura se compara producto por producto (unidades y dinero) y, si algo no
-- coincide, queda en `cobro_distinto` y se avisa a la sucursal y a quien la
-- envió. Lo agregado en caja se anota pero no alarma (la venta creció, el
-- cliente no pagó de más por lo prometido).
--
-- El crédito fiscal guarda los renglones SIN IVA (medido: 8 de 9 CCF de la
-- semana cuadran con líneas × 1.13); por eso se compara con el IVA puesto y
-- con 5 centavos de tolerancia por el redondeo del impuesto.
-- `preventas_cerrar_facturadas` se reescribe desde su definición VIVA
-- (md5 00007777…); sólo se agrega el bloque de la comparación.
SET lock_timeout = '5s';

ALTER TABLE public.preventas ADD COLUMN IF NOT EXISTS cobro_distinto jsonb;

CREATE OR REPLACE FUNCTION public.preventa_cobro_distinto(p_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v jsonb; pv record;
BEGIN
  SELECT p.id, p.venta, p.total, si.id AS si_id, si.total AS si_total, si.tipo_documento
    INTO pv FROM public.preventas p JOIN public.sales_invoices si ON si.id = p.sales_invoice_id WHERE p.id = p_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  WITH pro AS (
    SELECT (r->>'producto_id')::int AS pid, max(r->>'nombre') AS nombre,
           sum((r->>'cantidad')::numeric * coalesce((r->>'factor')::numeric, 1)) AS u, sum((r->>'subtotal')::numeric) AS m
      FROM jsonb_array_elements(coalesce(pv.venta->'renglones', '[]')) r GROUP BY 1),
  fac AS (
    SELECT i.erp_product_id AS pid, max(coalesce(i.descripcion, pr.nombre)) AS nombre,
           sum(i.cantidad * coalesce(i.factor_unidades, 1)) AS u,
           round(sum(i.total_linea) * CASE WHEN pv.tipo_documento = 'CCF' THEN 1.13 ELSE 1 END, 2) AS m
      FROM public.sales_invoice_items i LEFT JOIN public.products pr ON pr.id = i.erp_product_id
     WHERE i.invoice_id = pv.si_id AND i.erp_product_id > 0 GROUP BY 1),
  dif AS (
    SELECT coalesce(pro.pid, fac.pid) AS producto_id, coalesce(pro.nombre, fac.nombre) AS nombre,
           CASE WHEN fac.pid IS NULL THEN 'quitado' WHEN pro.pid IS NULL THEN 'agregado'
                WHEN pro.u <> fac.u THEN 'cantidad'
                WHEN abs(pro.m - fac.m) > CASE WHEN pv.tipo_documento = 'CCF' THEN 0.05 ELSE 0.009 END THEN 'precio' END AS tipo,
           pro.m AS prometido, fac.m AS cobrado, pro.u AS unidades_prometidas, fac.u AS unidades_cobradas
      FROM pro FULL JOIN fac ON fac.pid = pro.pid)
  -- jsonb-agg: una preventa lleva 30 productos como mucho; se guarda en una columna jsonb.
  SELECT jsonb_build_object(
           'total_prometido', pv.total, 'total_cobrado', pv.si_total,
           'alerta', bool_or(tipo <> 'agregado'),
           'productos', jsonb_agg(jsonb_build_object('producto_id', producto_id, 'nombre', nombre, 'tipo', tipo,
             'prometido', prometido, 'cobrado', cobrado,
             'unidades_prometidas', unidades_prometidas, 'unidades_cobradas', unidades_cobradas) ORDER BY nombre))
    INTO v FROM dif WHERE tipo IS NOT NULL;
  RETURN CASE WHEN v->'productos' IS NULL OR v->'productos' = 'null'::jsonb THEN NULL ELSE v END;
END $function$;
REVOKE EXECUTE ON FUNCTION public.preventa_cobro_distinto(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.preventa_cobro_distinto(bigint) TO service_role;

CREATE OR REPLACE FUNCTION public.preventas_cerrar_facturadas()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  p record; a record; k record;
  v_cerradas int := 0; v_dest uuid[]; v_pend text[]; v_ok text[]; v_cod text; v_dif jsonb;
BEGIN
  -- Un envío que nunca contestó no traba la reserva para siempre.
  UPDATE public.preventas
     SET estado = CASE WHEN externo_id IS NOT NULL THEN 'viva' ELSE 'fallida' END,
         error = coalesce(error, 'el envío no terminó'), updated_at = now()
   WHERE estado = 'enviando' AND updated_at < now() - interval '10 minutes';

  FOR p IN
    SELECT pv.id, pv.branch_id, pv.reservas_ids, pv.externo_ref, pv.enviada_por, pv.origen,
           si.id AS si_id, si.correlativo, si.codigo_generacion
      FROM public.preventas pv
      JOIN public.sales_invoices si ON si.erp_invoice_id = pv.externo_id
     WHERE pv.estado = 'viva' AND pv.sistema = 'caja' AND pv.externo_id IS NOT NULL
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
    v_pend := ARRAY[]::text[]; v_ok := ARRAY[]::text[];

    FOR a IN SELECT * FROM public.app_reservas WHERE id = ANY (p.reservas_ids) AND preventa_id = p.id ORDER BY id FOR UPDATE LOOP
      v_cod := coalesce(a.pedido, 'R-' || lpad(a.id::text, 6, '0'));
      SELECT * INTO k FROM public.reserva_cuenta(a.id);
      IF a.estado NOT IN ('pendiente', 'lista') THEN
        v_pend := v_pend || (v_cod || ' ya estaba ' || a.estado);
        CONTINUE;
      END IF;
      IF k.pagado > 0.004 AND NOT EXISTS (SELECT 1 FROM public.apartado_aplicaciones x WHERE x.reserva_id = a.id) THEN
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

-- Lo ya facturado se compara una vez, sin avisar (es historia).
UPDATE public.preventas SET cobro_distinto = public.preventa_cobro_distinto(id)
 WHERE estado = 'facturada' AND sales_invoice_id IS NOT NULL AND cobro_distinto IS NULL;
