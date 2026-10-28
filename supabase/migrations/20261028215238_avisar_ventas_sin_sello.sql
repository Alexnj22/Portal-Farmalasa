-- Dos avisos que faltaban sobre el sello de Hacienda de las VENTAS (2026-10-28).
-- CONTABILIDAD.md §2 ítem 7.
--
-- 1. **Venta sin sello que no se resuelve.** Una venta sin sello no es DTE
--    (Art. 119-D) y no entra al libro. `avisar_rechazos_sin_arreglo` ya avisa
--    las que Hacienda RECHAZA; ésta avisa las demás: las que nunca llegaron a
--    Hacienda, quedaron con basura en `recibido_mh` ('undefined' parece sello
--    y no lo es) o el envío no ve. Es el incidente de mayo/2025: 87 días
--    invisible, y `check-sales-reconciliation` decía «se corrige solo».
--    Mismo criterio que el de rechazos —más de 2 días, una vez por documento,
--    a quien edita Facturación y ve Pendiente MH— y lo que ya avisó aquél no
--    se repite acá.
--    Los COF de las 6 pm en adelante NO cuentan: no se mandan por decisión
--    del usuario (2026-10-19, `cof_no_se_envia_mh`); sin excluirlos, el aviso
--    saldría todas las noches por ~150 facturas que nadie va a mandar.
--
-- 2. **Sello que llega sobre un mes ya declarado.** Si el sello llega después
--    del día 10 del mes siguiente a la venta, la declaración de ese mes ya se
--    presentó (o estaba por presentarse) sin esa venta: hay que rectificar.
--    Medido: 21 ventas de mayo/2026 ($236.60) y una de junio sellaron en
--    agosto, sin que nadie lo supiera. Va a quien ve los libros de IVA, que
--    incluye al contador. El corte del día 10 deja fuera lo normal: la venta
--    de la noche del 30 que sella el 1.º (47 de junio→julio).
--
-- `p_probar` devuelve lo que avisaría sin avisar ni marcar nada.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.avisar_ventas_sin_sello(
  p_probar boolean DEFAULT false,
  p_dias_sello_tardio integer DEFAULT 3
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_dest_fac  uuid[];
  v_dest_lib  uuid[];
  v_ids       bigint[];
  v_lista     text;
  v_n1        integer := 0;
  v_tard_ids  bigint[];
  v_tard_list text;
  v_n2        integer := 0;
  v_total     numeric;
BEGIN
  -- ── 1. Ventas sin sello de más de 2 días ─────────────────────────────────
  WITH pend AS (
    SELECT si.id, b.name AS sala, si.tipo_documento, si.correlativo, si.fecha, si.total
      FROM public.sales_invoices si
      JOIN public.branches b ON b.id = si.branch_id
     WHERE public.venta_valida(si.estado)
       AND (si.recibido_mh IS NULL OR si.recibido_mh NOT LIKE repeat('_', 40))
       AND NOT public.cof_no_se_envia_mh(si.tipo_documento, si.fecha, si.hora, si.customer_id)
       AND si.fecha <= current_date - 2
       AND NOT EXISTS (SELECT 1 FROM public.dte_rechazos_avisados a WHERE a.invoice_id = si.id)
       AND NOT EXISTS (SELECT 1 FROM public.sync_alert_log l
                        WHERE l.domain = 'ventas-sin-sello' AND l.scope_key = si.id::text)
  )
  SELECT count(*), array_agg(id ORDER BY fecha, id),
         string_agg(sala || ' · '
                    || CASE WHEN tipo_documento = 'CCF' THEN 'crédito fiscal ' ELSE 'factura ' END
                    || coalesce(nullif(ltrim(split_part(correlativo, '_', 1), '0'), ''), correlativo)
                    || ' · $' || to_char(total, 'FM999999990.00')
                    || ' (' || to_char(fecha, 'DD/MM/YY') || ')',
                    '  ·  ' ORDER BY fecha, id) FILTER (WHERE rn <= 10)
    INTO v_n1, v_ids, v_lista
    FROM (SELECT p.*, row_number() OVER (ORDER BY fecha, id) rn FROM pend p) x;

  -- ── 2. Sellos que llegaron después del día 10 del mes siguiente ──────────
  WITH tard AS (
    SELECT DISTINCT ON (si.id) si.id, b.name AS sala, si.tipo_documento, si.correlativo,
           si.fecha, si.total
      FROM public.sales_invoice_changelog c
      JOIN public.sales_invoices si ON si.id = c.invoice_id
      JOIN public.branches b ON b.id = si.branch_id
     WHERE c.campo = 'recibido_mh'
       AND c.valor_nuevo LIKE repeat('_', 40)
       AND (c.valor_anterior IS NULL OR c.valor_anterior NOT LIKE repeat('_', 40))
       AND c.detected_at >= now() - make_interval(days => p_dias_sello_tardio)
       AND (c.detected_at AT TIME ZONE 'America/El_Salvador')::date
           > (date_trunc('month', si.fecha) + interval '1 month' + interval '9 days')::date
       AND NOT EXISTS (SELECT 1 FROM public.sync_alert_log l
                        WHERE l.domain = 'ventas-sello-tardio' AND l.scope_key = si.id::text)
     ORDER BY si.id
  )
  SELECT count(*), array_agg(id ORDER BY fecha, id), sum(total),
         string_agg(sala || ' · '
                    || CASE WHEN tipo_documento = 'CCF' THEN 'crédito fiscal ' ELSE 'factura ' END
                    || coalesce(nullif(ltrim(split_part(correlativo, '_', 1), '0'), ''), correlativo)
                    || ' · $' || to_char(total, 'FM999999990.00')
                    || ' (' || to_char(fecha, 'DD/MM/YY') || ')',
                    '  ·  ' ORDER BY fecha, id) FILTER (WHERE rn <= 10)
    INTO v_n2, v_tard_ids, v_total, v_tard_list
    FROM (SELECT t.*, row_number() OVER (ORDER BY fecha, id) rn FROM tard t) x;

  IF p_probar THEN
    RETURN jsonb_build_object('sin_sello', v_n1, 'sin_sello_lista', v_lista,
                              'sello_tardio', v_n2, 'sello_tardio_total', v_total,
                              'sello_tardio_lista', v_tard_list);
  END IF;

  -- Personas, no fichas técnicas (QA, revisión de tienda).
  SELECT array_agg(DISTINCT e.id) INTO v_dest_fac
    FROM public.employees e
   WHERE e.status = 'ACTIVO' AND e.tipo_ficha IS DISTINCT FROM 'tecnica'
     AND EXISTS (SELECT 1 FROM public.role_permissions rp
                  WHERE rp.role_id IN (e.role_id, e.secondary_role_id)
                    AND rp.module_key = 'facturacion' AND rp.can_edit)
     AND EXISTS (SELECT 1 FROM public.role_permissions rp
                  WHERE rp.role_id IN (e.role_id, e.secondary_role_id)
                    AND rp.module_key = 'facturacion_tab_pendiente_mh' AND rp.can_view);

  SELECT array_agg(DISTINCT e.id) INTO v_dest_lib
    FROM public.employees e
   WHERE e.status = 'ACTIVO' AND e.tipo_ficha IS DISTINCT FROM 'tecnica'
     AND EXISTS (SELECT 1 FROM public.role_permissions rp
                  WHERE rp.role_id IN (e.role_id, e.secondary_role_id)
                    AND rp.module_key = 'libros_iva' AND rp.can_view);

  IF coalesce(v_n1, 0) > 0 THEN
    IF coalesce(array_length(v_dest_fac, 1), 0) > 0 THEN
      PERFORM public.notify_employees(
        v_dest_fac, 'DTE_SIN_SELLO',
        CASE WHEN v_n1 = 1 THEN 'Una venta lleva más de 2 días sin sello de Hacienda'
             ELSE v_n1 || ' ventas llevan más de 2 días sin sello de Hacienda' END,
        v_lista || CASE WHEN v_n1 > 10 THEN '  ·  y ' || (v_n1 - 10) || ' más' ELSE '' END
          || '. Sin sello no entran al libro de IVA. Están en Facturación, Pendiente MH.',
        '/facturacion?tab=pendiente_mh',
        jsonb_build_object('invoice_ids', v_ids), true, NULL);
    ELSE
      INSERT INTO public.audit_logs (action, target_id, user_name, source, severity, details)
      VALUES ('DTE_SIN_SELLO_SIN_DESTINATARIOS', 'avisar_ventas_sin_sello', 'Vigilante', 'SYSTEM',
              'CRITICAL', jsonb_build_object('invoice_ids', v_ids));
    END IF;
    -- La marca va siempre: si no, el mismo aviso saldría cada día para siempre.
    INSERT INTO public.sync_alert_log (domain, scope_key, alert_key)
    SELECT 'ventas-sin-sello', unnest(v_ids)::text, 'pendiente'
    ON CONFLICT (domain, scope_key, alert_key) DO NOTHING;
  END IF;

  IF coalesce(v_n2, 0) > 0 THEN
    IF coalesce(array_length(v_dest_lib, 1), 0) > 0 THEN
      PERFORM public.notify_employees(
        v_dest_lib, 'DTE_SELLO_TARDIO',
        CASE WHEN v_n2 = 1 THEN 'Llegó el sello de una venta de un mes ya declarado'
             ELSE 'Llegó el sello de ' || v_n2 || ' ventas de meses ya declarados' END,
        v_tard_list || CASE WHEN v_n2 > 10 THEN '  ·  y ' || (v_n2 - 10) || ' más' ELSE '' END
          || '. Total $' || to_char(v_total, 'FM999999990.00')
          || '. Ahora entran al libro de su mes: si ese mes ya se declaró, hay que rectificar.',
        '/libros-iva',
        jsonb_build_object('invoice_ids', v_tard_ids, 'total', v_total), true, NULL);
    ELSE
      INSERT INTO public.audit_logs (action, target_id, user_name, source, severity, details)
      VALUES ('DTE_SELLO_TARDIO_SIN_DESTINATARIOS', 'avisar_ventas_sin_sello', 'Vigilante', 'SYSTEM',
              'CRITICAL', jsonb_build_object('invoice_ids', v_tard_ids));
    END IF;
    INSERT INTO public.sync_alert_log (domain, scope_key, alert_key)
    SELECT 'ventas-sello-tardio', unnest(v_tard_ids)::text, 'llego'
    ON CONFLICT (domain, scope_key, alert_key) DO NOTHING;
  END IF;

  RETURN jsonb_build_object('sin_sello', coalesce(v_n1, 0), 'sello_tardio', coalesce(v_n2, 0));
END;
$function$;

REVOKE ALL ON FUNCTION public.avisar_ventas_sin_sello(boolean, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.avisar_ventas_sin_sello(boolean, integer) TO service_role;

-- 08:10 SV, después de los otros dos avisos de Hacienda (8:00 y 8:05).
SELECT cron.schedule('avisar-ventas-sin-sello-8am-sv', '10 14 * * *',
                     $$SELECT public.avisar_ventas_sin_sello();$$);
