SET lock_timeout = '5s';

-- ─────────────────────────────────────────────────────────────────────────────
-- El cotejo del Corte Z se ancla en la línea GRAVADAS del ticket, no en su TOTAL.
--
-- Hallazgo del 2026-08-12, levantado por el contador sobre Salud 3 de julio: la
-- línea TOTAL del ticket le resta la retención a una cifra que YA la tiene
-- descontada. GRAVADAS no es una base gravada — es la suma de lo cobrado, con
-- IVA y neta de retención — así que `TOTAL = GRAVADAS − RETENCIÓN` la resta DOS
-- veces, y el TOTAL del ticket no corresponde a ninguna cantidad real.
--
-- Salud 3, julio 2026, crédito fiscal: la operación vale 983.93 (870.74 gravada
-- + 113.19 débito fiscal), la retención es 3.60 y lo cobrado 980.33 — que es
-- exactamente lo que imprime la línea GRAVADAS. El TOTAL del ticket dice 976.73.
-- El DTE sellado de BANCO PROMERICA, único documento con retención del mes,
-- confirma al portal: montoTotalOperacion 406.56, totalPagar 402.96.
--
-- Medido antes de escribir esto: GRAVADAS = sum(sales_invoices.total) con
-- diferencia 0.00 en los 12 meses-sucursal cargados (6 sucursales × junio y
-- julio 2026), en las dos secciones; y sum(subtotal+iva) − sum(retencion) =
-- sum(total) da 0.00 exacto, que es lo que prueba que el total del portal ya es
-- el neto.
--
-- La versión anterior compensaba con `p_ccf - r_ccf - ccf_total`. Eso es
-- algebraicamente `p_ccf - gravadas`, porque la retención se cancela: el número
-- salía bien, pero por dos errores que se anulaban, y el comentario afirmaba una
-- compensación que no ocurría («el bruto del portal contra el neto del Z» —
-- p_ccf nunca fue bruto). Peor: al cancelarse, esa línea NO podía detectar jamás
-- una discrepancia en la retención. Anclada en GRAVADAS sí la detecta, porque
-- GRAVADAS ya viene neta.
--
-- Se agregan z_factura/z_ccf/z_total para que el frontend no tenga que elegir la
-- línea del ticket — que es exactamente donde se coló este defecto. Los campos
-- factura_total/ccf_total/total_general se quedan con lo que dice el ticket: la
-- tarjeta reproduce el documento y «Ver el original» lo respalda.
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
    detalle jsonb, ticket text, obtenido_at timestamp with time zone)
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
               -- La retención que DECLARA el ticket, por sección. Ya no se usa
               -- para compensar nada: va al cotejo como su propia línea, contra
               -- la que suma el portal documento por documento.
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
           detalle, ticket, obtenido_at
    FROM base
    ORDER BY periodo DESC, sucursal;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_cortes_z(date, date, bigint) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_cortes_z(date, date, bigint) TO authenticated, service_role;
