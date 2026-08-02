SET lock_timeout = '5s';

-- Los libros se ordenan por el ID INTERNO del documento — que es como los
-- ordena el reporte que replican, o sea por orden de captura.
--
-- Antes iban por `documento_numero` / `correlativo`, y eso desalineaba el
-- archivo entero: la fila 1 del portal era otro documento que la fila 1 del
-- origen, así que TODAS las columnas figuraban como distintas aunque el dato de
-- cada documento estuviera bien.
--
-- Medido en Bodega el 2026-06-01: por `erp_purchase_id` la secuencia es
-- 4544 INCOFA · 4545 GRUPO JAMILU · 4546 PHARMALAND · 4549 LETERAGO, que es
-- exactamente el orden de las cuatro primeras líneas del archivo original.
-- Tras el cambio, el anexo de anulados pasó de 78 a 80 filas idénticas de 80.
--
-- `erp_invoice_id` es text y se castea: sin el cast, "10" ordena antes que "9".
-- Detalle en docs/LIBROS-IVA-FORMATO-Y-HALLAZGOS-2026-08-01.md.


CREATE OR REPLACE FUNCTION public.get_libro_compras(
    p_desde date, p_hasta date, p_branch_id bigint DEFAULT NULL)
RETURNS TABLE(branch_id bigint, fecha date, documento_tipo text, documento_numero text,
              proveedor text, nrc text, nit text, compras_exentas numeric,
              compras_gravadas numeric, credito_fiscal numeric, total numeric,
              percepcion_iva numeric, retencion_iva numeric, anulada boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, extensions AS $fn$
    SELECT pr.branch_id::bigint, pr.fecha, pr.documento_tipo, pr.documento_numero,
           pr.proveedor,
           nullif(btrim(coalesce(s.nrc, pm.nrc, '')), ''),
           nullif(btrim(coalesce(pm.nit, '')), ''),
           0::numeric,
           coalesce(pr.subtotal, 0) - coalesce(pr.percepcion_iva, 0),
           coalesce(pr.iva, 0), coalesce(pr.total, 0),
           pr.percepcion_iva, pr.retencion_iva, pr.estado = 'anulada'
    FROM public.purchase_receipts pr
    LEFT JOIN public.suppliers           s  ON s.id  = pr.supplier_id
    LEFT JOIN public.proveedores_maestro pm ON pm.supplier_id = pr.supplier_id
    WHERE (SELECT auth_has_module_permission('libros_iva', 'can_view'))
      AND ((SELECT auth_module_scope('libros_iva')) = 'ALL'
           OR pr.branch_id = (SELECT auth_employee_branch_id()))
      AND pr.fecha BETWEEN p_desde AND p_hasta
      AND (p_branch_id IS NULL OR pr.branch_id = p_branch_id)
    ORDER BY pr.branch_id, pr.erp_purchase_id;
$fn$;

CREATE OR REPLACE FUNCTION public.get_libro_percepcion(
    p_desde date, p_hasta date, p_branch_id bigint DEFAULT NULL)
RETURNS TABLE(branch_id bigint, fecha date, proveedor text, nrc text, nit text,
              documento_tipo text, documento_numero text, monto_sujeto numeric,
              percepcion_iva numeric, anulada boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, extensions AS $fn$
    SELECT pr.branch_id::bigint, pr.fecha, pr.proveedor,
           nullif(btrim(coalesce(s.nrc, pm.nrc, '')), ''),
           nullif(btrim(coalesce(pm.nit, '')), ''),
           pr.documento_tipo, pr.documento_numero,
           coalesce(pr.subtotal, 0) - coalesce(pr.percepcion_iva, 0),
           coalesce(pr.percepcion_iva, 0),
           pr.estado = 'anulada'
    FROM public.purchase_receipts pr
    LEFT JOIN public.suppliers           s  ON s.id  = pr.supplier_id
    LEFT JOIN public.proveedores_maestro pm ON pm.supplier_id = pr.supplier_id
    WHERE (SELECT auth_has_module_permission('libros_iva', 'can_view'))
      AND ((SELECT auth_module_scope('libros_iva')) = 'ALL'
           OR pr.branch_id = (SELECT auth_employee_branch_id()))
      AND pr.fecha BETWEEN p_desde AND p_hasta
      AND (p_branch_id IS NULL OR pr.branch_id = p_branch_id)
      AND coalesce(pr.percepcion_iva, 0) > 0
    ORDER BY pr.branch_id, pr.erp_purchase_id;
$fn$;

CREATE OR REPLACE FUNCTION public.get_libro_retencion(
    p_desde date, p_hasta date, p_branch_id bigint DEFAULT NULL)
RETURNS TABLE(branch_id bigint, fecha date, proveedor text, nrc text, nit text,
              documento_tipo text, documento_numero text, monto_sujeto numeric,
              retencion_iva numeric, anulada boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, extensions AS $fn$
    SELECT pr.branch_id::bigint, pr.fecha, pr.proveedor,
           nullif(btrim(coalesce(s.nrc, pm.nrc, '')), ''),
           nullif(btrim(coalesce(pm.nit, '')), ''),
           pr.documento_tipo, pr.documento_numero,
           coalesce(pr.subtotal, 0) - coalesce(pr.retencion_iva, 0),
           coalesce(pr.retencion_iva, 0),
           pr.estado = 'anulada'
    FROM public.purchase_receipts pr
    LEFT JOIN public.suppliers           s  ON s.id  = pr.supplier_id
    LEFT JOIN public.proveedores_maestro pm ON pm.supplier_id = pr.supplier_id
    WHERE (SELECT auth_has_module_permission('libros_iva', 'can_view'))
      AND ((SELECT auth_module_scope('libros_iva')) = 'ALL'
           OR pr.branch_id = (SELECT auth_employee_branch_id()))
      AND pr.fecha BETWEEN p_desde AND p_hasta
      AND (p_branch_id IS NULL OR pr.branch_id = p_branch_id)
      AND coalesce(pr.retencion_iva, 0) > 0
    ORDER BY pr.branch_id, pr.erp_purchase_id;
$fn$;

DROP FUNCTION IF EXISTS public.get_libro_anulados(date, date, bigint);
CREATE FUNCTION public.get_libro_anulados(
    p_desde date, p_hasta date, p_branch_id bigint DEFAULT NULL)
RETURNS TABLE(branch_id bigint, fecha date, tipo_documento text, correlativo text,
              numero_control text, codigo_generacion uuid, sello_recepcion text,
              erp_invoice_id text, cliente text, total numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, extensions AS $fn$
    SELECT si.branch_id, si.fecha, si.tipo_documento, si.correlativo,
           si.numero_control, si.codigo_generacion, si.recibido_mh,
           si.erp_invoice_id, si.cliente, coalesce(si.total, 0)
    FROM public.sales_invoices si
    WHERE (SELECT auth_has_module_permission('libros_iva', 'can_view'))
      AND ((SELECT auth_module_scope('libros_iva')) = 'ALL'
           OR si.branch_id = (SELECT auth_employee_branch_id()))
      AND si.estado = 'DTE INVALIDADO EN MH'
      AND si.fecha BETWEEN p_desde AND p_hasta
      AND (p_branch_id IS NULL OR si.branch_id = p_branch_id)
    ORDER BY si.branch_id, nullif(regexp_replace(si.erp_invoice_id, '\D', '', 'g'), '')::bigint;
$fn$;

DROP FUNCTION IF EXISTS public.get_libro_ventas_contribuyente(date, date, bigint);
CREATE FUNCTION public.get_libro_ventas_contribuyente(
    p_desde date, p_hasta date, p_branch_id bigint DEFAULT NULL)
RETURNS TABLE(branch_id bigint, fecha date, correlativo text, numero_control text,
              codigo_generacion uuid, sello_recepcion text, erp_invoice_id text,
              cliente text, nrc text, nit text, dui text,
              ventas_exentas numeric, ventas_gravadas numeric,
              debito_fiscal numeric, total numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, extensions AS $fn$
    SELECT si.branch_id, si.fecha, si.correlativo, si.numero_control,
           si.codigo_generacion, si.recibido_mh, si.erp_invoice_id, si.cliente,
           nullif(btrim(coalesce(c.nrc, '')), ''),
           nullif(btrim(coalesce(c.nit, '')), ''),
           nullif(btrim(coalesce(c.dui, '')), ''),
           CASE WHEN coalesce(si.iva, 0) = 0 THEN coalesce(si.total, 0)    ELSE 0 END,
           CASE WHEN coalesce(si.iva, 0) > 0 THEN coalesce(si.subtotal, 0) ELSE 0 END,
           coalesce(si.iva, 0), coalesce(si.total, 0)
    FROM public.sales_invoices si
    LEFT JOIN public.customers c ON c.id = si.customer_id
    WHERE (SELECT auth_has_module_permission('libros_iva', 'can_view'))
      AND ((SELECT auth_module_scope('libros_iva')) = 'ALL'
           OR si.branch_id = (SELECT auth_employee_branch_id()))
      AND si.tipo_documento = 'CCF' AND si.estado = 'FINALIZADA'
      AND length(si.recibido_mh) = 40
      AND si.fecha BETWEEN p_desde AND p_hasta
      AND (p_branch_id IS NULL OR si.branch_id = p_branch_id)
    ORDER BY si.branch_id, nullif(regexp_replace(si.erp_invoice_id, '\D', '', 'g'), '')::bigint;
$fn$;

REVOKE EXECUTE ON FUNCTION public.get_libro_anulados(date, date, bigint)             FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_libro_ventas_contribuyente(date, date, bigint) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_libro_anulados(date, date, bigint)             TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.get_libro_ventas_contribuyente(date, date, bigint) TO authenticated, service_role;
