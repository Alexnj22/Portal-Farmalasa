-- La factura descuadrada también se le avisa a la SALA que la hizo (la gente
-- activa de esa sucursal), además de a supervisión. Y el aviso dice lo que se
-- debía cobrar según los productos —con IVA, sin puntos ni retención, la misma
-- base que el total— en vez de la diferencia sin IVA, que nadie en sala usa.
-- Misma cuenta que `renglonesDeLaVenta` (src/utils/ventasPeriodo.js).
-- Las facturas ya avisadas no se repiten: el freno sigue siendo audit_logs.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.avisar_facturas_descuadradas()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    r        record;
    v_sup    uuid[];
    v_dest   uuid[];
    v_n      integer := 0;
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
             WHERE si.fecha >= current_date - 3
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
              JOIN public.roles ro ON ro.name IN ('Gerente General', 'Supervisor/a de Ventas')
             WHERE e.status = 'ACTIVO' AND coalesce(e.tipo_ficha, 'empleado') = 'empleado'
               AND (e.role_id = ro.id OR e.secondary_role_id = ro.id);
        END IF;

        SELECT coalesce(array_agg(DISTINCT x), '{}') INTO v_dest
          FROM (SELECT unnest(v_sup) AS x
                UNION
                SELECT e.id FROM public.employees e
                 WHERE e.branch_id = r.branch_id AND e.status = 'ACTIVO'
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
$$;

REVOKE EXECUTE ON FUNCTION public.avisar_facturas_descuadradas() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.avisar_facturas_descuadradas() TO service_role;
