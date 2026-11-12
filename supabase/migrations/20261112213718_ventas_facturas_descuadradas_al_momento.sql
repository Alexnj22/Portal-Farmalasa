-- Facturas descuadradas: el aviso AL MOMENTO (2026-11-12).
--
-- El revisor corría una vez por hora (minuto 25). La COF #411747 de Salud 5
-- (4 × $3.55 = $14.20 en el renglón, $7.10 de total) se emitió a las 2:42 p. m.,
-- llegó al portal 30 s después y el aviso salió a las 3:25. Usuario: «este tipo
-- de error se debe de avisar en el momento. así posiblemente se puede cancelar
-- la venta y corregir con el cliente».
--
-- Dos pasadas de la MISMA función:
--   · `facturas-descuadradas-al-momento`, cada minuto en las horas del
--     sincronizador de ventas (12-23,0-5 UTC), sólo lo de HOY: ~1,600 bloques y
--     2.5 ms a media tarde, contra ~8,300 de la pasada de 3 días.
--   · `facturas-descuadradas`, la de siempre (cada hora, 3 días): la red para lo
--     que llegue tarde o cruce la medianoche.
-- El aviso sale una sola vez por factura igual que antes (marca en audit_logs).
--
-- «Hoy» es el de El Salvador: la base está en UTC, y con `current_date` la
-- pasada de hoy no vería nada de 6 p. m. a medianoche, que es hora de venta.
--
-- Cuerpo partido de la definición VIVA (pg_get_functiondef, 2026-11-12); sólo
-- cambian la firma (p_dias, por defecto 3 = el comportamiento de antes) y el
-- WHERE de la fecha.
SET lock_timeout = '5s';

DROP FUNCTION IF EXISTS public.avisar_facturas_descuadradas();

CREATE FUNCTION public.avisar_facturas_descuadradas(p_dias integer DEFAULT 3)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    r        record;
    v_sup    uuid[];
    v_dest   uuid[];
    v_n      integer := 0;
    v_desde  date := (now() AT TIME ZONE 'America/El_Salvador')::date
                     - least(greatest(coalesce(p_dias, 3), 0), 31);
BEGIN
    FOR r IN
        WITH s AS (
            SELECT si.id, si.erp_invoice_id, si.tipo_documento, si.branch_id, si.fecha, si.total,
                   coalesce(si.retencion, 0) AS ret, si.subtotal,
                   coalesce(sum(ii.total_linea) FILTER (WHERE ii.erp_product_id IS DISTINCT FROM 0
                                                          AND ii.descripcion IS NOT NULL), 0)
                 - coalesce(sum(ii.total_linea) FILTER (WHERE ii.erp_product_id = 0), 0) AS neto
              FROM public.sales_invoices si
              JOIN public.sales_invoice_items ii ON ii.invoice_id = si.id
             WHERE si.fecha >= v_desde
               AND public.venta_valida(si.estado)
             GROUP BY si.id
        ), c AS (
            SELECT s.*,
                   round(s.neto - CASE WHEN s.tipo_documento = 'CCF' THEN s.subtotal
                                       ELSE s.total + s.ret END, 2) AS dif,
                   round(CASE WHEN s.tipo_documento = 'CCF' THEN round(s.neto * 1.13, 2)
                              ELSE s.neto END - s.ret, 2) AS esperado
              FROM s
        )
        SELECT c.*, b.name AS sala
          FROM c LEFT JOIN public.branches b ON b.id = c.branch_id
         WHERE abs(c.dif) > 0.05
           AND NOT EXISTS (SELECT 1 FROM public.audit_logs a
                            WHERE a.target_id = c.id::text
                              AND a.action = 'FACTURA_DESCUADRADA')
    LOOP
        IF v_sup IS NULL THEN
            SELECT coalesce(array_agg(DISTINCT e.id), '{}') INTO v_sup
              FROM public.employees e
              JOIN public.roles ro ON ro.name = 'Supervisor/a de Ventas'
             WHERE e.status = 'ACTIVO' AND coalesce(e.tipo_ficha, 'empleado') = 'empleado'
               AND ro.id = ANY (public.roles_efectivos_de(e.id));
        END IF;

        SELECT coalesce(array_agg(DISTINCT x), '{}') INTO v_dest
          FROM (SELECT unnest(v_sup) AS x
                UNION
                SELECT e.id FROM public.employees e
                 WHERE coalesce(public.sala_de_apoyo_vigente(e.id)::bigint, e.branch_id::bigint) = r.branch_id AND e.status = 'ACTIVO'
                   AND coalesce(e.tipo_ficha, 'empleado') = 'empleado') d;

        INSERT INTO public.audit_logs (action, target_id, user_name, source, severity, branch_id, details)
        VALUES ('FACTURA_DESCUADRADA', r.id::text, 'Vigilante', 'SYSTEM', 'WARNING', r.branch_id,
                jsonb_build_object('factura', r.erp_invoice_id, 'tipo', r.tipo_documento,
                                   'fecha', r.fecha, 'total', r.total, 'esperado', r.esperado,
                                   'diferencia', r.dif,
                                   'avisados', coalesce(array_length(v_dest, 1), 0)));

        IF coalesce(array_length(v_dest, 1), 0) > 0 THEN
            PERFORM public.notify_employees(
                v_dest, 'SYSTEM',
                'Error en una factura de ' || coalesce(r.sala, 'una sucursal'),
                r.tipo_documento || ' #' || r.erp_invoice_id || ' del ' || to_char(r.fecha, 'DD/MM/YYYY')
                  || ': según los productos se debía cobrar $' || to_char(r.esperado, 'FM999,990.00')
                  || ' y se facturó $' || to_char(r.total, 'FM999,990.00')
                  || ' (' || CASE WHEN r.esperado > r.total THEN 'de menos' ELSE 'de más' END
                  || ': $' || to_char(abs(r.esperado - r.total), 'FM999,990.00') || '). Hay que revisarla.',
                '/ventas',
                jsonb_build_object('origen', 'factura-descuadrada', 'invoice_id', r.id,
                                   'factura', r.erp_invoice_id, 'esperado', r.esperado,
                                   'diferencia', r.dif),
                true, r.branch_id::integer);
        END IF;
        v_n := v_n + 1;
    END LOOP;
    RETURN v_n;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.avisar_facturas_descuadradas(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.avisar_facturas_descuadradas(integer) TO service_role;

SELECT cron.schedule('facturas-descuadradas-al-momento', '* 12-23,0-5 * * *',
                     'SELECT public.avisar_facturas_descuadradas(0)');
