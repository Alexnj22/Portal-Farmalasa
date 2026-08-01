SET lock_timeout = '5s';

-- Los tres libros de ventas devuelven el número de control fiscal.
--
-- Es columna del reporte del ERP —en el anexo de anulados es la PRIMERA— y
-- hasta ahora no salía porque el dato no existía en la base. Hay que DROP +
-- CREATE y no CREATE OR REPLACE: cambia el tipo de retorno.
--
-- NULL significa "todavía no se trajo", nunca "no tiene". La vista lo marca
-- como faltante para que un libro incompleto no se presente por error.

DROP FUNCTION IF EXISTS public.get_libro_ventas_contribuyente(date, date, bigint);
CREATE FUNCTION public.get_libro_ventas_contribuyente(
    p_desde date, p_hasta date, p_branch_id bigint DEFAULT NULL)
RETURNS TABLE(branch_id bigint, fecha date, correlativo text, numero_control text,
              codigo_generacion uuid, sello_recepcion text, erp_invoice_id text,
              cliente text, nrc text, nit text, dui text,
              ventas_exentas numeric, ventas_gravadas numeric,
              debito_fiscal numeric, total numeric)
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
    SELECT si.branch_id,
           si.fecha,
           si.correlativo,
           si.numero_control,
           si.codigo_generacion,
           si.recibido_mh,
           si.erp_invoice_id,
           si.cliente,
           nullif(btrim(coalesce(c.nrc, '')), ''),
           nullif(btrim(coalesce(c.nit, '')), ''),
           nullif(btrim(coalesce(c.dui, '')), ''),
           CASE WHEN coalesce(si.iva, 0) = 0 THEN coalesce(si.total, 0)    ELSE 0 END,
           CASE WHEN coalesce(si.iva, 0) > 0 THEN coalesce(si.subtotal, 0) ELSE 0 END,
           coalesce(si.iva, 0),
           coalesce(si.total, 0)
    FROM public.sales_invoices si
    LEFT JOIN public.customers c ON c.id = si.customer_id
    WHERE (SELECT auth_has_module_permission('libros_iva', 'can_view'))
      AND ((SELECT auth_module_scope('libros_iva')) = 'ALL'
           OR si.branch_id = (SELECT auth_employee_branch_id()))
      AND si.tipo_documento = 'CCF'
      AND si.estado = 'FINALIZADA'
      AND length(si.recibido_mh) = 40
      AND si.fecha BETWEEN p_desde AND p_hasta
      AND (p_branch_id IS NULL OR si.branch_id = p_branch_id)
    ORDER BY si.branch_id, si.fecha, si.correlativo;
$$;

DROP FUNCTION IF EXISTS public.get_libro_anulados(date, date, bigint);
CREATE FUNCTION public.get_libro_anulados(
    p_desde date, p_hasta date, p_branch_id bigint DEFAULT NULL)
RETURNS TABLE(branch_id bigint, fecha date, tipo_documento text, correlativo text,
              numero_control text, codigo_generacion uuid, sello_recepcion text,
              erp_invoice_id text, cliente text, total numeric)
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
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
    ORDER BY si.branch_id, si.fecha, si.correlativo;
$$;

DROP FUNCTION IF EXISTS public.get_libro_ventas_consumidor(date, date, bigint);
CREATE FUNCTION public.get_libro_ventas_consumidor(
    p_desde date, p_hasta date, p_branch_id bigint DEFAULT NULL)
RETURNS TABLE(branch_id bigint, fecha date, correlativo_del text, correlativo_al text,
              numero_control_del text, numero_control_al text,
              codigo_gen_del uuid, codigo_gen_al uuid, sello_del text,
              erp_id_del text, erp_id_al text, documentos bigint,
              ventas_exentas numeric, ventas_gravadas numeric,
              exportaciones numeric, total_diario numeric)
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
    SELECT si.branch_id,
           si.fecha,
           min(si.correlativo),
           max(si.correlativo),
           -- Ordenado por CORRELATIVO, igual que el del→al: el número de control
           -- corre su propia serie por punto de venta, así que un min()/max()
           -- sobre él daría el menor y mayor alfabéticos, que no son el primero
           -- ni el último documento del día.
           (array_agg(si.numero_control    ORDER BY si.correlativo))[1],
           (array_agg(si.numero_control    ORDER BY si.correlativo DESC))[1],
           (array_agg(si.codigo_generacion ORDER BY si.correlativo))[1],
           (array_agg(si.codigo_generacion ORDER BY si.correlativo DESC))[1],
           (array_agg(si.recibido_mh       ORDER BY si.correlativo))[1],
           (array_agg(si.erp_invoice_id    ORDER BY si.correlativo))[1],
           (array_agg(si.erp_invoice_id    ORDER BY si.correlativo DESC))[1],
           count(*),
           coalesce(sum(si.total) FILTER (WHERE coalesce(si.iva, 0) = 0), 0),
           coalesce(sum(si.total) FILTER (WHERE coalesce(si.iva, 0) > 0), 0),
           0::numeric,
           coalesce(sum(si.total), 0)
    FROM public.sales_invoices si
    WHERE (SELECT auth_has_module_permission('libros_iva', 'can_view'))
      AND ((SELECT auth_module_scope('libros_iva')) = 'ALL'
           OR si.branch_id = (SELECT auth_employee_branch_id()))
      AND si.tipo_documento = 'COF'
      AND si.estado = 'FINALIZADA'
      AND length(si.recibido_mh) = 40
      AND si.fecha BETWEEN p_desde AND p_hasta
      AND (p_branch_id IS NULL OR si.branch_id = p_branch_id)
    GROUP BY si.branch_id, si.fecha
    ORDER BY si.branch_id, si.fecha;
$$;

-- El conjunto del backfill usa el MISMO filtro que el libro de consumidor
-- (`= 'COF'`). Con `<> 'CCF'` daba lo mismo hoy, pero el día que aparezca otro
-- tipo —una factura de exportación, por ejemplo— entraría en los extremos de un
-- libro que no lo imprime.
CREATE OR REPLACE FUNCTION public._docs_sin_numero_control()
RETURNS TABLE(id bigint, codigo_generacion uuid, fecha date)
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
    WITH universo AS (
        SELECT si.id, si.codigo_generacion, si.branch_id, si.fecha,
               si.correlativo, si.tipo_documento, si.estado, si.numero_control
        FROM public.sales_invoices si
        WHERE si.codigo_generacion IS NOT NULL
          AND si.fecha >= '2025-05-01'
    ),
    ccf AS (
        SELECT u.id, u.codigo_generacion, u.fecha, u.numero_control FROM universo u
        WHERE u.tipo_documento = 'CCF' AND u.estado = 'FINALIZADA'
    ),
    anul AS (
        SELECT u.id, u.codigo_generacion, u.fecha, u.numero_control FROM universo u
        WHERE u.estado = 'DTE INVALIDADO EN MH'
    ),
    extremos AS (
        SELECT x.id, x.codigo_generacion, x.fecha, x.numero_control FROM (
            SELECT u.id, u.codigo_generacion, u.fecha, u.numero_control,
                   row_number() OVER (PARTITION BY u.branch_id, u.fecha ORDER BY u.correlativo ASC)  AS r_asc,
                   row_number() OVER (PARTITION BY u.branch_id, u.fecha ORDER BY u.correlativo DESC) AS r_desc
            FROM universo u
            WHERE u.tipo_documento = 'COF' AND u.estado = 'FINALIZADA'
        ) x
        WHERE x.r_asc = 1 OR x.r_desc = 1
    ),
    todos AS (
        SELECT * FROM ccf
        UNION SELECT * FROM anul
        UNION SELECT * FROM extremos
    )
    SELECT t.id, t.codigo_generacion, t.fecha
    FROM todos t
    WHERE t.numero_control IS NULL;
$$;

REVOKE EXECUTE ON FUNCTION public.get_libro_ventas_contribuyente(date, date, bigint) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_libro_anulados(date, date, bigint)             FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_libro_ventas_consumidor(date, date, bigint)    FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_libro_ventas_contribuyente(date, date, bigint) TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.get_libro_anulados(date, date, bigint)             TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.get_libro_ventas_consumidor(date, date, bigint)    TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public._docs_sin_numero_control() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public._docs_sin_numero_control() TO service_role;
