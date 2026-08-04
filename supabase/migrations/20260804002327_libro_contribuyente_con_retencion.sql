-- El libro del Art. 85 con la retención de IVA que el cliente practicó.
--
-- POR QUÉ. En un documento con retención, `ventas_gravadas + debito_fiscal`
-- ya NO suma el total: el cliente descuenta la retención de lo que paga. El
-- libro del origen tiene la misma forma (CCF 323659: 359.79 + 46.77 contra un
-- total de 402.96, y la resta de 3.60 no aparece en ninguna columna). Mostrarla
-- es lo que hace que la fila se pueda leer sin que parezca un error de suma.
SET lock_timeout = '5s';

DROP FUNCTION IF EXISTS public.get_libro_ventas_contribuyente(date, date, bigint);

CREATE FUNCTION public.get_libro_ventas_contribuyente(p_desde date, p_hasta date, p_branch_id bigint DEFAULT NULL::bigint)
RETURNS TABLE(branch_id bigint, fecha date, correlativo text, numero_control text,
              codigo_generacion uuid, sello_recepcion text, erp_invoice_id text, cliente text,
              nrc text, nit text, dui text,
              ventas_exentas numeric, ventas_gravadas numeric, debito_fiscal numeric,
              retencion_iva numeric, total numeric)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
    SELECT si.branch_id, si.fecha, si.correlativo, si.numero_control,
           si.codigo_generacion, si.recibido_mh, si.erp_invoice_id, si.cliente,
           nullif(btrim(coalesce(c.nrc, '')), ''),
           nullif(btrim(coalesce(c.nit, '')), ''),
           nullif(btrim(coalesce(c.dui, '')), ''),
           CASE WHEN coalesce(si.iva, 0) = 0 THEN coalesce(si.total, 0)    ELSE 0 END,
           CASE WHEN coalesce(si.iva, 0) > 0 THEN coalesce(si.subtotal, 0) ELSE 0 END,
           coalesce(si.iva, 0),
           coalesce(si.retencion, 0),
           coalesce(si.total, 0)
    FROM public.sales_invoices si
    LEFT JOIN public.customers c ON c.id = si.customer_id
    WHERE (SELECT auth_has_module_permission('libros_iva', 'can_view'))
      AND ((SELECT auth_module_scope('libros_iva')) = 'ALL'
           OR si.branch_id = (SELECT auth_employee_branch_id()))
      AND si.tipo_documento = 'CCF' AND si.estado = 'FINALIZADA'
      AND length(si.recibido_mh) = 40
      AND si.fecha BETWEEN p_desde AND p_hasta
      AND (p_branch_id IS NULL OR si.branch_id = p_branch_id)
    ORDER BY si.branch_id, si.fecha,
             nullif(regexp_replace(si.erp_invoice_id, '\D', '', 'g'), '')::bigint;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_libro_ventas_contribuyente(date, date, bigint) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_libro_ventas_contribuyente(date, date, bigint) TO authenticated, service_role;
