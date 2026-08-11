-- El Corte Z, ahora con la dirección de la sucursal que lo emitió.
--
-- El documento identifica quién declara: la dirección exacta del local y su
-- departamento. Salían de `branches` —`address` y `settings.location.department`—
-- pero el RPC solo devolvía el nombre, así que el PDF no podía llevarlas.
--
-- Van en la MISMA fila y no en una consulta aparte, por lo mismo que el cotejo:
-- el frontend no tiene que cruzar el catálogo de sucursales contra el Corte Z
-- para armar un encabezado, que es donde se cuela mostrar la dirección de una
-- sucursal sobre los números de otra.
--
-- `nullif(btrim(...), '')`: una dirección en blanco tiene que llegar como NULL
-- para que quien la pinta pueda decidir qué hacer con la ausencia, en vez de
-- imprimir una línea vacía que parece un dato.
SET lock_timeout = '5s';

DROP FUNCTION IF EXISTS public.get_cortes_z(date, date, bigint);

CREATE FUNCTION public.get_cortes_z(p_desde date, p_hasta date, p_branch_id bigint DEFAULT NULL::bigint)
RETURNS TABLE(branch_id bigint, sucursal text, direccion text, departamento text,
              periodo date, fecha_inicio date, fecha_fin date,
              tiquete_total numeric, factura_total numeric, ccf_total numeric, total_general numeric,
              portal_factura numeric, portal_ccf numeric, portal_total numeric,
              dif_factura numeric, dif_ccf numeric, dif_total numeric,
              retencion numeric, portal_retencion numeric, dif_retencion numeric,
              residuo numeric, portal_documentos bigint,
              hallazgos jsonb,
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
               nullif(btrim(b.address), '') AS direccion,
               nullif(btrim(b.settings->'location'->>'department'), '') AS departamento,
               coalesce(p.factura, 0) AS p_factura,
               coalesce(p.ccf, 0)     AS p_ccf,
               coalesce(p.total, 0)   AS p_total,
               coalesce(p.retencion, 0) AS p_retencion,
               coalesce(p.documentos, 0) AS p_docs,
               coalesce(nullif(z.detalle->'secciones'->'factura'->>'retencion','')::numeric, 0) AS r_factura,
               coalesce(nullif(z.detalle->'secciones'->'ccf'->>'retencion','')::numeric, 0)     AS r_ccf,
               hh.j AS hallazgos
        FROM public.corte_z z
        JOIN public.branches b ON b.id = z.branch_id
        LEFT JOIN portal p ON p.branch_id = z.branch_id AND p.periodo = z.periodo
        LEFT JOIN LATERAL (
            SELECT coalesce(jsonb_agg(jsonb_build_object(
                       'fecha',        h.fecha,
                       'diferencia',   h.diferencia,
                       'sin_explicar', h.sin_explicar,
                       'documentos',   h.documentos
                   ) ORDER BY h.fecha), '[]'::jsonb) AS j
            FROM public.ventas_cuadre_hallazgos h
            WHERE h.branch_id = z.branch_id
              AND h.resuelto_at IS NULL
              AND h.fecha >= z.periodo
              AND h.fecha < (z.periodo + interval '1 month')
        ) hh ON true
        WHERE (SELECT auth_has_module_permission('corte_z', 'can_view'))
          AND ((SELECT auth_module_scope('corte_z')) = 'ALL'
               OR z.branch_id = (SELECT auth_employee_branch_id()))
          AND z.periodo >= date_trunc('month', p_desde)::date
          AND z.periodo <= date_trunc('month', p_hasta)::date
          AND (p_branch_id IS NULL OR z.branch_id = p_branch_id)
    )
    SELECT branch_id, sucursal, direccion, departamento,
           periodo, fecha_inicio, fecha_fin,
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
           hallazgos,
           detalle, ticket, obtenido_at
    FROM base
    ORDER BY periodo DESC, sucursal;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_cortes_z(date, date, bigint) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_cortes_z(date, date, bigint) TO authenticated, service_role;
