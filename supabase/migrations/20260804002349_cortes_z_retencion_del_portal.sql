-- El cotejo del Corte Z, con la retención de los DOS lados.
--
-- Hasta ahora la retención salía sólo del ticket del origen y el portal la
-- aceptaba: se le restaba a su propio total para que los números se pudieran
-- comparar, y la tarjeta decía "descontada, los dos coinciden" sin que nadie
-- pudiera verificarlo. Desde que el origen manda la retención por documento,
-- el portal tiene su propia suma — así que eso pasa de ser un supuesto a ser
-- una línea más del cotejo, con su diferencia.
--
-- El filtro es el mismo que el del resto del cotejo (FINALIZADA + sello de 40),
-- que es justo lo que hace que la invalidada de julio en Salud 3 no cuente:
-- $44.27 en los documentos, $42.92 en el libro y en el ticket.
SET lock_timeout = '5s';

DROP FUNCTION IF EXISTS public.get_cortes_z(date, date, bigint);

CREATE FUNCTION public.get_cortes_z(p_desde date, p_hasta date, p_branch_id bigint DEFAULT NULL::bigint)
RETURNS TABLE(branch_id bigint, sucursal text, periodo date, fecha_inicio date, fecha_fin date,
              tiquete_total numeric, factura_total numeric, ccf_total numeric, total_general numeric,
              portal_factura numeric, portal_ccf numeric, portal_total numeric,
              dif_factura numeric, dif_ccf numeric, dif_total numeric,
              retencion numeric, portal_retencion numeric, dif_retencion numeric,
              residuo numeric, portal_documentos bigint,
              detalle jsonb, ticket text, obtenido_at timestamp with time zone)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
    WITH portal AS (
        SELECT si.branch_id,
               date_trunc('month', si.fecha)::date AS periodo,
               coalesce(sum(si.total) FILTER (WHERE si.tipo_documento = 'COF'), 0) AS factura,
               coalesce(sum(si.total) FILTER (WHERE si.tipo_documento = 'CCF'), 0) AS ccf,
               coalesce(sum(si.total), 0) AS total,
               coalesce(sum(si.retencion), 0) AS retencion,
               count(*) AS documentos
        FROM public.sales_invoices si
        WHERE si.estado = 'FINALIZADA'
          AND length(si.recibido_mh) = 40
          AND si.fecha >= date_trunc('month', p_desde)::date
          AND si.fecha <= (date_trunc('month', p_hasta) + interval '1 month - 1 day')::date
        GROUP BY 1, 2
    ), base AS (
        SELECT z.*, b.name AS sucursal,
               coalesce(p.factura, 0) AS p_factura,
               coalesce(p.ccf, 0)     AS p_ccf,
               coalesce(p.total, 0)   AS p_total,
               coalesce(p.retencion, 0) AS p_retencion,
               coalesce(p.documentos, 0) AS p_docs,
               coalesce(nullif(z.detalle->'secciones'->'factura'->>'retencion','')::numeric, 0) AS r_factura,
               coalesce(nullif(z.detalle->'secciones'->'ccf'->>'retencion','')::numeric, 0)     AS r_ccf
        FROM public.corte_z z
        JOIN public.branches b ON b.id = z.branch_id
        LEFT JOIN portal p ON p.branch_id = z.branch_id AND p.periodo = z.periodo
        WHERE (SELECT auth_has_module_permission('corte_z', 'can_view'))
          AND ((SELECT auth_module_scope('corte_z')) = 'ALL'
               OR z.branch_id = (SELECT auth_employee_branch_id()))
          AND z.periodo >= date_trunc('month', p_desde)::date
          AND z.periodo <= date_trunc('month', p_hasta)::date
          AND (p_branch_id IS NULL OR z.branch_id = p_branch_id)
    )
    SELECT branch_id, sucursal, periodo, fecha_inicio, fecha_fin,
           tiquete_total, factura_total, ccf_total, total_general,
           p_factura, p_ccf, p_total,
           -- Las diferencias por línea ya descuentan la retención de esa línea:
           -- comparar el bruto del portal contra el neto del Z inventa una
           -- diferencia que no existe.
           round(p_factura - r_factura - factura_total, 2),
           round(p_ccf     - r_ccf     - ccf_total, 2),
           round(p_total   - (r_factura + r_ccf) - total_general, 2),
           round(r_factura + r_ccf, 2),
           round(p_retencion, 2),
           round(p_retencion - (r_factura + r_ccf), 2),
           round(p_total - (r_factura + r_ccf) - total_general, 2),
           p_docs,
           detalle, ticket, obtenido_at
    FROM base
    ORDER BY periodo DESC, sucursal;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_cortes_z(date, date, bigint) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_cortes_z(date, date, bigint) TO authenticated, service_role;
