-- El IVA que nos retuvieron: las ventas donde el cliente —un gran
-- contribuyente— practicó la retención del Art. 162 CT.
--
-- NO es el anexo del Art. 162, que es la otra mitad: ahí van las retenciones
-- que la empresa practica COMO AGENTE, y sale vacío porque no lo es. Son dos
-- cosas opuestas y por eso viven en secciones separadas; mezclarlas sería
-- declarar un impuesto por otro (la misma trampa que con la retención de Renta
-- del Art. 156).
--
-- `monto_sujeto` es la base gravada, y el 1% sobre ella da la retención al
-- centavo en los 44 documentos de la historia (359.79 → 3.60, 2125.00 → 21.25).
-- Es lo mismo que dice `resumen.ivaRete1` del DTE.
--
-- Las anuladas ENTRAN marcadas, como en el anexo de compras: el documento
-- existió y su retención aparece en el Corte Z del período. Esconderlas haría
-- inexplicable la diferencia (julio de Salud 3: $44.27 en documentos contra
-- $42.92 en el ticket, que es exactamente la invalidada del 23/07).
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.get_retencion_ventas(
    p_desde date, p_hasta date, p_branch_id bigint DEFAULT NULL::bigint)
RETURNS TABLE(branch_id bigint, fecha date, cliente text, nrc text, nit text,
              tipo_documento text, correlativo text, numero_control text,
              codigo_generacion uuid, sello_recepcion text, erp_invoice_id text,
              monto_sujeto numeric, retencion_iva numeric, total numeric,
              anulada boolean, json_path text, pdf_path text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
    SELECT si.branch_id, si.fecha, si.cliente,
           nullif(btrim(coalesce(c.nrc, '')), ''),
           nullif(btrim(coalesce(c.nit, '')), ''),
           si.tipo_documento, si.correlativo, si.numero_control,
           si.codigo_generacion, si.recibido_mh, si.erp_invoice_id,
           coalesce(si.subtotal, 0), coalesce(si.retencion, 0), coalesce(si.total, 0),
           si.estado IN ('NULA', 'DTE INVALIDADO EN MH'),
           d.json_path, d.pdf_path
    FROM public.sales_invoices si
    LEFT JOIN public.customers c ON c.id = si.customer_id
    LEFT JOIN public.sales_dte_documents d ON d.invoice_id = si.id
    WHERE (SELECT auth_has_module_permission('libros_iva', 'can_view'))
      AND ((SELECT auth_module_scope('libros_iva')) = 'ALL'
           OR si.branch_id = (SELECT auth_employee_branch_id()))
      AND coalesce(si.retencion, 0) > 0
      AND si.fecha BETWEEN p_desde AND p_hasta
      AND (p_branch_id IS NULL OR si.branch_id = p_branch_id)
    ORDER BY si.branch_id, si.fecha,
             nullif(regexp_replace(si.erp_invoice_id, '\D', '', 'g'), '')::bigint;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_retencion_ventas(date, date, bigint) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_retencion_ventas(date, date, bigint) TO authenticated, service_role;
