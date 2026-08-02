SET lock_timeout = '5s';

-- Resumen diario de ventas a consumidor, para el cuadre contra el origen.
--
-- Usa EXACTAMENTE el mismo filtro que el libro (`COF` + `FINALIZADA` + sello de
-- 40): si el cuadre midiera otro conjunto, avisaría por diferencias que el libro
-- no tiene y se volvería ruido que nadie mira.
CREATE OR REPLACE FUNCTION public.resumen_ventas_diario(
    p_desde date, p_hasta date, p_branch_id bigint)
RETURNS TABLE(fecha date, documentos bigint, total numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, extensions AS $fn$
    SELECT si.fecha, count(*), coalesce(sum(si.total), 0)
    FROM public.sales_invoices si
    WHERE si.tipo_documento = 'COF' AND si.estado = 'FINALIZADA'
      AND length(si.recibido_mh) = 40
      AND si.fecha BETWEEN p_desde AND p_hasta
      AND si.branch_id = p_branch_id
    GROUP BY si.fecha ORDER BY si.fecha;
$fn$;

COMMENT ON FUNCTION public.resumen_ventas_diario(date, date, bigint) IS
    'Documentos y total por día del libro de consumidor. La usa check-sales-reconciliation; mismo filtro que get_libro_ventas_consumidor.';

REVOKE EXECUTE ON FUNCTION public.resumen_ventas_diario(date, date, bigint) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.resumen_ventas_diario(date, date, bigint) TO service_role;
