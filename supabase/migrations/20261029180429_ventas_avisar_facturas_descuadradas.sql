-- Una factura cuyo detalle no suma su total es un documento mal hecho.
-- Hasta hoy la pantalla de Ventas pintaba esa diferencia como «Descuento por
-- puntos» (CCF 401909 de Salud 1: −$63.55 que nadie canjeó). Los puntos
-- vienen SIEMPRE como renglón de producto 0 —909 de 909 cuadran desde
-- ene-2025—, así que cualquier otra diferencia es un error de facturación y
-- se avisa a Gerente General y Supervisor/a de Ventas, una vez por factura.
--
-- La misma cuenta que `renglonesDeLaVenta` (src/utils/ventasPeriodo.js): el
-- CCF va sin IVA contra el subtotal; los demás con IVA contra total +
-- retención. Tolerancia 5 centavos. Mirado desde ene-2025: 2 de 396,722.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.avisar_facturas_descuadradas()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    r       record;
    v_dest  uuid[];
    v_n     integer := 0;
BEGIN
    FOR r IN
        WITH s AS (
            SELECT si.id, si.erp_invoice_id, si.tipo_documento, si.branch_id, si.fecha, si.total,
                   round(
                       coalesce(sum(ii.total_linea) FILTER (WHERE ii.erp_product_id IS DISTINCT FROM 0
                                                              AND ii.descripcion IS NOT NULL), 0)
                     - coalesce(sum(ii.total_linea) FILTER (WHERE ii.erp_product_id = 0), 0)
                     - CASE WHEN si.tipo_documento = 'CCF' THEN si.subtotal
                            ELSE si.total + coalesce(si.retencion, 0) END, 2) AS dif
              FROM public.sales_invoices si
              JOIN public.sales_invoice_items ii ON ii.invoice_id = si.id
             WHERE si.fecha >= current_date - 3
               AND public.venta_valida(si.estado)
             GROUP BY si.id
        )
        SELECT s.*, b.name AS sala
          FROM s LEFT JOIN public.branches b ON b.id = s.branch_id
         WHERE abs(s.dif) > 0.05
           AND NOT EXISTS (SELECT 1 FROM public.audit_logs a
                            WHERE a.target_id = s.id::text
                              AND a.action = 'FACTURA_DESCUADRADA')
    LOOP
        IF v_dest IS NULL THEN
            SELECT coalesce(array_agg(e.id), '{}') INTO v_dest
              FROM public.employees e
              JOIN public.roles ro ON ro.name IN ('Gerente General', 'Supervisor/a de Ventas')
             WHERE e.status = 'ACTIVO'
               AND (e.role_id = ro.id OR e.secondary_role_id = ro.id);
        END IF;

        INSERT INTO public.audit_logs (action, target_id, user_name, source, severity, branch_id, details)
        VALUES ('FACTURA_DESCUADRADA', r.id::text, 'Vigilante', 'SYSTEM', 'WARNING', r.branch_id,
                jsonb_build_object('factura', r.erp_invoice_id, 'tipo', r.tipo_documento,
                                   'fecha', r.fecha, 'total', r.total, 'diferencia', r.dif,
                                   'avisados', coalesce(array_length(v_dest, 1), 0)));

        IF coalesce(array_length(v_dest, 1), 0) > 0 THEN
            PERFORM public.notify_employees(
                v_dest, 'SYSTEM',
                'Error en una factura de ' || coalesce(r.sala, 'una sucursal'),
                r.tipo_documento || ' #' || r.erp_invoice_id || ' del ' || to_char(r.fecha, 'DD/MM/YYYY')
                  || ': los productos suman $' || to_char(abs(r.dif), 'FM999990.00')
                  || CASE WHEN r.dif > 0 THEN ' más' ELSE ' menos' END
                  || ' que el total del documento ($' || to_char(r.total, 'FM999990.00') || '). Hay que revisarla.',
                '/ventas',
                jsonb_build_object('origen', 'factura-descuadrada', 'invoice_id', r.id,
                                   'factura', r.erp_invoice_id, 'diferencia', r.dif),
                true, r.branch_id);
        END IF;
        v_n := v_n + 1;
    END LOOP;
    RETURN v_n;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.avisar_facturas_descuadradas() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.avisar_facturas_descuadradas() TO service_role;

SELECT cron.schedule('facturas-descuadradas', '25 * * * *', 'SELECT public.avisar_facturas_descuadradas()');
