SET lock_timeout = '5s';

-- ═══════════════════════════════════════════════════════════════════════════
-- CORRECCIÓN. `contradiccion_interna` estaba MAL CONCEBIDA y su nombre mentía.
--
-- La lectura anterior era que el ticket se contradecía a sí mismo porque su
-- línea GRAVADAS no coincidía con su línea TOTAL. Lo detectó el usuario mirando
-- la tarjeta: no se contradice, **RESTA LA RETENCIÓN**.
--
--     TOTAL = GRAVADAS − RETENCIÓN
--
-- Verificado en las 12 filas cargadas, desviación CERO en las 12. Y la retención
-- explica las diferencias al centavo: Salud 3 junio 6.03 (2.21 + 3.82) y julio
-- 42.92 (39.32 + 3.60), que son exactamente las diferencias que se veían. En las
-- otras diez la retención es 0 y por eso cuadraban.
--
-- El Corte Z reporta el NETO de retención; `sales_invoices.total` del portal es
-- el BRUTO. **La retención de IVA sobre ventas no está en el portal** — no hay
-- columna donde guardarla y el sync no la trae. Así que el único lado que la
-- conoce es el propio Z, y de ahí sale para el cotejo.
--
-- Consecuencia que conviene mirar aparte: el anexo de retención (Art. 162) sale
-- VACÍO del origen en toda la historia, pero el Corte Z de Salud 3 sí declara
-- retención. Una de las dos cosas está mal en el origen.
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
    retencion numeric, residuo numeric,
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
           round(p_total - (r_factura + r_ccf) - total_general, 2),
           p_docs,
           detalle, ticket, obtenido_at
    FROM base
    ORDER BY periodo DESC, sucursal;
$fn$;

REVOKE EXECUTE ON FUNCTION public.get_cortes_z(date, date, bigint) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_cortes_z(date, date, bigint) TO authenticated, service_role;
