SET lock_timeout = '5s';

-- ─────────────────────────────────────────────────────────────────────────────
-- El Corte Z muestra además las cifras con las que SE DECLARA.
--
-- Sale de la pregunta del usuario tras el hallazgo de la retención duplicada
-- (v2.571.7): «¿cuáles son los datos correctos? ¿los podés mostrar en el Corte Z
-- para que el contador sepa?».
--
-- El ticket NO trae lo que se declara. Su línea «GRAVADAS» es la suma de lo
-- cobrado CON IVA —no una base gravada— y no imprime débito fiscal por ningún
-- lado. Las cifras que van al libro y a la declaración son otras cuatro, y hasta
-- ahora había que ir a buscarlas al libro de IVA.
--
-- Julio 2026, Salud 3, crédito fiscal: gravadas 870.74, débito 113.19,
-- retenido 3.60, total 980.33. El ticket sólo sabía decir «980.33» y «976.73».
--
-- Se calculan con la MISMA lógica que `get_libro_ventas_contribuyente` /
-- `get_libro_ventas_consumidor`, incluida la regla de exentas
-- (`iva = 0 → el total va a exentas; iva > 0 → el subtotal va a gravadas`) y el
-- mismo filtro de sello. Si acá se recalculara «parecido» en vez de igual, la
-- pantalla y el libro podrían discrepar sin que nada avise — que es justo el
-- defecto que se acaba de corregir.
-- ─────────────────────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.get_cortes_z(date, date, bigint);

CREATE FUNCTION public.get_cortes_z(p_desde date, p_hasta date, p_branch_id bigint DEFAULT NULL::bigint)
RETURNS TABLE(
    branch_id bigint, sucursal text, direccion text, departamento text,
    periodo date, fecha_inicio date, fecha_fin date,
    tiquete_total numeric, factura_total numeric, ccf_total numeric, total_general numeric,
    z_factura numeric, z_ccf numeric, z_total numeric,
    portal_factura numeric, portal_ccf numeric, portal_total numeric,
    dif_factura numeric, dif_ccf numeric, dif_total numeric,
    retencion numeric, portal_retencion numeric, dif_retencion numeric,
    residuo numeric, portal_documentos bigint, hallazgos jsonb,
    declaracion jsonb, detalle jsonb, ticket text, obtenido_at timestamp with time zone)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
    WITH portal AS (
        SELECT si.branch_id,
               date_trunc('month', si.fecha)::date AS periodo,
               coalesce(sum(si.total) FILTER (WHERE si.tipo_documento = 'COF'), 0) AS factura,
               coalesce(sum(si.total) FILTER (WHERE si.tipo_documento = 'CCF'), 0) AS ccf,
               coalesce(sum(si.total), 0) AS total,
               coalesce(sum(si.retencion), 0) AS retencion,
               count(*) AS documentos,
               -- Las cuatro cifras que van al libro y a la declaración, por tipo
               -- de documento. Misma lógica que los RPC de libros: el `iva = 0`
               -- manda la venta a exentas con su total, y el `iva > 0` manda el
               -- subtotal a gravadas.
               jsonb_build_object(
                   'factura', jsonb_build_object(
                       'exentas',  round(coalesce(sum(CASE WHEN coalesce(si.iva,0) = 0 THEN coalesce(si.total,0)    ELSE 0 END) FILTER (WHERE si.tipo_documento = 'COF'), 0), 2),
                       'gravadas', round(coalesce(sum(CASE WHEN coalesce(si.iva,0) > 0 THEN coalesce(si.subtotal,0) ELSE 0 END) FILTER (WHERE si.tipo_documento = 'COF'), 0), 2),
                       'debito',   round(coalesce(sum(si.iva)       FILTER (WHERE si.tipo_documento = 'COF'), 0), 2),
                       'retenido', round(coalesce(sum(si.retencion) FILTER (WHERE si.tipo_documento = 'COF'), 0), 2),
                       'total',    round(coalesce(sum(si.total)     FILTER (WHERE si.tipo_documento = 'COF'), 0), 2),
                       'documentos', count(*) FILTER (WHERE si.tipo_documento = 'COF')),
                   'ccf', jsonb_build_object(
                       'exentas',  round(coalesce(sum(CASE WHEN coalesce(si.iva,0) = 0 THEN coalesce(si.total,0)    ELSE 0 END) FILTER (WHERE si.tipo_documento = 'CCF'), 0), 2),
                       'gravadas', round(coalesce(sum(CASE WHEN coalesce(si.iva,0) > 0 THEN coalesce(si.subtotal,0) ELSE 0 END) FILTER (WHERE si.tipo_documento = 'CCF'), 0), 2),
                       'debito',   round(coalesce(sum(si.iva)       FILTER (WHERE si.tipo_documento = 'CCF'), 0), 2),
                       'retenido', round(coalesce(sum(si.retencion) FILTER (WHERE si.tipo_documento = 'CCF'), 0), 2),
                       'total',    round(coalesce(sum(si.total)     FILTER (WHERE si.tipo_documento = 'CCF'), 0), 2),
                       'documentos', count(*) FILTER (WHERE si.tipo_documento = 'CCF'))
               ) AS declaracion
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
               coalesce(p.declaracion, '{}'::jsonb) AS p_declaracion,
               -- La retención que DECLARA el ticket, por sección. No compensa
               -- nada: va al cotejo como su propia línea, contra la que suma el
               -- portal documento por documento.
               coalesce(nullif(z.detalle->'secciones'->'factura'->>'retencion','')::numeric, 0) AS r_factura,
               coalesce(nullif(z.detalle->'secciones'->'ccf'->>'retencion','')::numeric, 0)     AS r_ccf,
               -- El ancla del cotejo: la línea GRAVADAS de cada sección.
               coalesce(nullif(z.detalle->'secciones'->'tiquete'->>'gravadas','')::numeric, 0) AS g_tiquete,
               coalesce(nullif(z.detalle->'secciones'->'factura'->>'gravadas','')::numeric, 0) AS g_factura,
               coalesce(nullif(z.detalle->'secciones'->'ccf'->>'gravadas','')::numeric, 0)     AS g_ccf,
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
           -- Lo que dice el ticket, tal cual. Es el documento.
           tiquete_total, factura_total, ccf_total, total_general,
           -- La cifra del ticket que SÍ es comparable, por sección.
           round(g_factura, 2),
           round(g_ccf, 2),
           round(g_tiquete + g_factura + g_ccf, 2),
           p_factura, p_ccf, p_total,
           -- Restas directas, sin ajuste: los dos lados son el mismo concepto
           -- —lo cobrado, con IVA y neto de retención— así que cualquier
           -- diferencia que aparezca acá es real.
           round(p_factura - g_factura, 2),
           round(p_ccf     - g_ccf, 2),
           round(p_total   - (g_tiquete + g_factura + g_ccf), 2),
           round(r_factura + r_ccf, 2),
           round(p_retencion, 2),
           round(p_retencion - (r_factura + r_ccf), 2),
           round(p_total - (g_tiquete + g_factura + g_ccf), 2),
           p_docs,
           hallazgos,
           p_declaracion,
           detalle, ticket, obtenido_at
    FROM base
    ORDER BY periodo DESC, sucursal;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_cortes_z(date, date, bigint) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_cortes_z(date, date, bigint) TO authenticated, service_role;
