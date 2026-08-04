-- El resumen diario del libro, ahora también de crédito fiscal.
--
-- POR QUÉ. El cuadre diario comparaba SOLO el libro de consumidor, que es el
-- 99% del volumen. Eso deja fuera a los CCF, que son los documentos más
-- grandes: un crédito fiscal que el origen pierda después de sincronizado no lo
-- vería nadie a diario — aparecería recién en el cotejo mensual del Corte Z, y
-- sin diagnóstico, porque el diagnóstico solo corre sobre los días que marca la
-- comparación de consumidor.
--
-- Devuelve una fila por día Y TIPO en vez de una por día. El único que lo
-- llamaba es `check-sales-reconciliation`, que se actualiza en el mismo commit,
-- así que se reemplaza en vez de dejar un overload con DEFAULT al lado.
SET lock_timeout = '5s';

DROP FUNCTION IF EXISTS public.resumen_ventas_diario(date, date, bigint);

CREATE FUNCTION public.resumen_ventas_diario(p_desde date, p_hasta date, p_branch_id bigint)
RETURNS TABLE(fecha date, tipo_documento text, documentos bigint, total numeric)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
    SELECT si.fecha, si.tipo_documento, count(*), coalesce(sum(si.total), 0)
    FROM public.sales_invoices si
    WHERE si.tipo_documento IN ('COF', 'CCF')
      AND si.estado = 'FINALIZADA'
      AND length(si.recibido_mh) = 40
      AND si.fecha BETWEEN p_desde AND p_hasta
      AND si.branch_id = p_branch_id
    GROUP BY si.fecha, si.tipo_documento
    ORDER BY si.fecha, si.tipo_documento;
$function$;

REVOKE EXECUTE ON FUNCTION public.resumen_ventas_diario(date, date, bigint) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.resumen_ventas_diario(date, date, bigint) TO authenticated, service_role;
