SET lock_timeout = '5s';

-- ═══════════════════════════════════════════════════════════════════════════
-- "Difiere $42.92" no sirve para nada si no dice POR QUÉ. La diferencia se parte
-- en dos sumandos, y son cosas distintas:
--
--   contradiccion_interna = (GRAVADAS − TOTAL) de cada sección del propio Z
--   residuo               = lo que queda después de descontar eso
--
-- El primero es un defecto del ticket consigo mismo y NO necesita ir a buscar
-- ningún documento: en Salud 3 su línea GRAVADAS coincide con el libro al
-- centavo y su línea TOTAL no. Medido: junio 6.03 de 6.03 y julio 42.92 de
-- 42.92, residuo CERO en los dos — la diferencia entera es eso.
--
-- El segundo sí es un hueco de documentos. Salud 1 julio: contradicción 0.00 y
-- residuo 9.00, que es la venta sellada que el origen no reporta.
--
-- Separarlos importa porque llevan a acciones opuestas: uno se le reclama al
-- proveedor del sistema, el otro se persigue documento por documento.
-- ═══════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.get_cortes_z(date, date, bigint);
CREATE FUNCTION public.get_cortes_z(
    p_desde date, p_hasta date, p_branch_id bigint DEFAULT NULL)
RETURNS TABLE(
    branch_id bigint, sucursal text, periodo date,
    fecha_inicio date, fecha_fin date,
    tiquete_total numeric, factura_total numeric, ccf_total numeric, total_general numeric,
    portal_factura numeric, portal_ccf numeric, portal_total numeric,
    dif_factura numeric, dif_ccf numeric, dif_total numeric,
    contradiccion_interna numeric, residuo numeric,
    portal_documentos bigint,
    detalle jsonb, ticket text, obtenido_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, extensions AS $fn$
    WITH portal AS (
        SELECT si.branch_id,
               date_trunc('month', si.fecha)::date AS periodo,
               coalesce(sum(si.total) FILTER (WHERE si.tipo_documento = 'COF'), 0) AS factura,
               coalesce(sum(si.total) FILTER (WHERE si.tipo_documento = 'CCF'), 0) AS ccf,
               coalesce(sum(si.total), 0) AS total,
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
               coalesce(p.documentos, 0) AS p_docs,
               -- `nullif(…,'')::numeric` y no un cast directo: un ticket viejo o
               -- una sección que el origen no imprimió dejarían la clave ausente,
               -- y ahí un cast pincha la consulta entera en vez de dar cero.
               coalesce(nullif(z.detalle->'secciones'->'factura'->>'gravadas','')::numeric, z.factura_total) AS g_factura,
               coalesce(nullif(z.detalle->'secciones'->'ccf'->>'gravadas','')::numeric,     z.ccf_total)     AS g_ccf
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
           round(p_factura - factura_total, 2),
           round(p_ccf     - ccf_total, 2),
           round(p_total   - total_general, 2),
           round((g_factura - factura_total) + (g_ccf - ccf_total), 2),
           round((p_total - total_general)
                 - ((g_factura - factura_total) + (g_ccf - ccf_total)), 2),
           p_docs,
           detalle, ticket, obtenido_at
    FROM base
    ORDER BY periodo DESC, sucursal;
$fn$;

REVOKE EXECUTE ON FUNCTION public.get_cortes_z(date, date, bigint) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_cortes_z(date, date, bigint) TO authenticated, service_role;

-- ── El desglose por día, para perseguir el residuo ──────────────────────────
--
-- El Corte Z es mensual: no lista documentos, así que un residuo no se puede
-- ubicar desde él. Lo que sí se puede es enfrentar el día del portal contra el
-- reporte diario del origen — que es como se ubicó el de Salud 1 (14/07) — y de
-- ahí bajar al documento.
--
-- (Se acotó a COF en 20260803181752: mezclar CCF daba rangos imposibles.)
DROP FUNCTION IF EXISTS public.get_corte_z_dias(bigint, date);
CREATE FUNCTION public.get_corte_z_dias(p_branch_id bigint, p_periodo date)
RETURNS TABLE(fecha date, documentos bigint, total numeric,
              numero_control_del text, numero_control_al text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, extensions AS $fn$
    WITH d AS (
        SELECT si.fecha, si.total, si.numero_control,
               nullif(regexp_replace(si.correlativo, '\D', '', 'g'), '')::bigint AS corr
        FROM public.sales_invoices si
        WHERE si.branch_id = p_branch_id
          AND si.estado = 'FINALIZADA' AND length(si.recibido_mh) = 40
          AND si.fecha >= date_trunc('month', p_periodo)::date
          AND si.fecha <= (date_trunc('month', p_periodo) + interval '1 month - 1 day')::date
    )
    SELECT d.fecha, count(*), round(sum(d.total), 2),
           (array_agg(d.numero_control ORDER BY d.corr NULLS LAST))[1],
           (array_agg(d.numero_control ORDER BY d.corr DESC NULLS LAST))[1]
    FROM d
    WHERE (SELECT auth_has_module_permission('corte_z', 'can_view'))
      AND ((SELECT auth_module_scope('corte_z')) = 'ALL'
           OR p_branch_id = (SELECT auth_employee_branch_id()))
    GROUP BY d.fecha
    ORDER BY d.fecha;
$fn$;

REVOKE EXECUTE ON FUNCTION public.get_corte_z_dias(bigint, date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_corte_z_dias(bigint, date) TO authenticated, service_role;
