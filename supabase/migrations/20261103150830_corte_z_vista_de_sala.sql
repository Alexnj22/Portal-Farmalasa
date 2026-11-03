-- Corte Z: dos lecturas del mismo reporte (2026-11-03).
--
-- Quien tiene `corte_z_ver_envio_mh` (administración, Contador Externo, QA) ve
-- el Corte Z EXACTAMENTE como antes: el libro sólo lleva lo sellado, y el COF
-- de la noche que no se envía a Hacienda aparece como diferencia y como venta
-- «sin sello». Verificado: misma huella md5 de jun-oct 2026 antes y después.
--
-- Quien NO lo tiene (Jefe/a de Sala, sólo su sala) ve la vista de sala: el COF
-- de la noche (`cof_no_se_envia_mh`) cuenta como venta del libro, así que el
-- cotejo contra el ticket cuadra y la comprobación del sello no lo menciona.
-- El ticket del Z no se toca: es el de la caja.
--
-- El default es la vista de sala a propósito: un cargo nuevo al que se le
-- olvide la capacidad NO ve lo que la regla de la noche quiere reservado.
-- Ver `cof_no_se_envia_mh` y memoria project_cof_de_la_noche_no_se_envia.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.get_cortes_z(p_desde date, p_hasta date, p_branch_id bigint DEFAULT NULL::bigint)
 RETURNS TABLE(branch_id bigint, sucursal text, direccion text, departamento text, periodo date, fecha_inicio date, fecha_fin date, tiquete_total numeric, factura_total numeric, ccf_total numeric, total_general numeric, z_factura numeric, z_ccf numeric, z_total numeric, portal_factura numeric, portal_ccf numeric, portal_total numeric, dif_factura numeric, dif_ccf numeric, dif_total numeric, retencion numeric, portal_retencion numeric, dif_retencion numeric, residuo numeric, portal_documentos bigint, hallazgos jsonb, declaracion jsonb, comprobaciones jsonb, detalle jsonb, ticket text, obtenido_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
    WITH vista AS (
        -- true = vista de sala: el COF de la noche cuenta como venta del libro.
        SELECT NOT coalesce((SELECT auth_has_module_permission('corte_z_ver_envio_mh', 'can_view')), false) AS noche_cuenta
    ),
    ventas AS (
        SELECT si.*,
               -- coalesce: `venta_fiscal` da NULL con el sello en NULL, y un
               -- NULL acá haría que `NOT en_libro` dejara afuera del conteo de
               -- «sin sello» justo a las ventas sin sello.
               coalesce(public.venta_fiscal(si.estado, si.recibido_mh)
                        OR ((SELECT noche_cuenta FROM vista)
                            AND public.venta_valida(si.estado)
                            AND public.cof_no_se_envia_mh(si.tipo_documento, si.fecha, si.hora, si.customer_id)),
                        false) AS en_libro
        FROM public.sales_invoices si
        WHERE si.fecha >= date_trunc('month', p_desde)::date
          AND si.fecha <= (date_trunc('month', p_hasta) + interval '1 month - 1 day')::date
    ),
    portal AS (
        SELECT si.branch_id,
               date_trunc('month', si.fecha)::date AS periodo,
               coalesce(sum(si.total) FILTER (WHERE si.tipo_documento = 'COF'), 0) AS factura,
               coalesce(sum(si.total) FILTER (WHERE si.tipo_documento = 'CCF'), 0) AS ccf,
               coalesce(sum(si.total), 0) AS total,
               coalesce(sum(si.retencion), 0) AS retencion,
               count(*) AS documentos,
               -- El `total` de cada sección es `subtotal + iva`: el VALOR DE LA
               -- OPERACIÓN, que es lo que va al libro. `total` a secas es lo
               -- cobrado —ya neto de la retención del Art. 162— y la retención
               -- no reduce la venta: va aparte, como crédito.
               jsonb_build_object(
                   'factura', jsonb_build_object(
                       'exentas',  round(coalesce(sum(CASE WHEN coalesce(si.iva,0) = 0 THEN coalesce(si.subtotal,0) + coalesce(si.iva,0) ELSE 0 END) FILTER (WHERE si.tipo_documento = 'COF'), 0), 2),
                       'gravadas', round(coalesce(sum(CASE WHEN coalesce(si.iva,0) > 0 THEN coalesce(si.subtotal,0) ELSE 0 END) FILTER (WHERE si.tipo_documento = 'COF'), 0), 2),
                       'debito',   round(coalesce(sum(si.iva)       FILTER (WHERE si.tipo_documento = 'COF'), 0), 2),
                       'retenido', round(coalesce(sum(si.retencion) FILTER (WHERE si.tipo_documento = 'COF'), 0), 2),
                       'total',    round(coalesce(sum(si.subtotal + si.iva) FILTER (WHERE si.tipo_documento = 'COF'), 0), 2),
                       'documentos', count(*) FILTER (WHERE si.tipo_documento = 'COF')),
                   'ccf', jsonb_build_object(
                       'exentas',  round(coalesce(sum(CASE WHEN coalesce(si.iva,0) = 0 THEN coalesce(si.subtotal,0) + coalesce(si.iva,0) ELSE 0 END) FILTER (WHERE si.tipo_documento = 'CCF'), 0), 2),
                       'gravadas', round(coalesce(sum(CASE WHEN coalesce(si.iva,0) > 0 THEN coalesce(si.subtotal,0) ELSE 0 END) FILTER (WHERE si.tipo_documento = 'CCF'), 0), 2),
                       'debito',   round(coalesce(sum(si.iva)       FILTER (WHERE si.tipo_documento = 'CCF'), 0), 2),
                       'retenido', round(coalesce(sum(si.retencion) FILTER (WHERE si.tipo_documento = 'CCF'), 0), 2),
                       'total',    round(coalesce(sum(si.subtotal + si.iva) FILTER (WHERE si.tipo_documento = 'CCF'), 0), 2),
                       'documentos', count(*) FILTER (WHERE si.tipo_documento = 'CCF'))
               ) AS declaracion
        FROM ventas si
        WHERE si.en_libro
        GROUP BY 1, 2
    ),
    control AS (
        SELECT si.branch_id,
               date_trunc('month', si.fecha)::date AS periodo,
               count(*) FILTER (WHERE public.venta_valida(si.estado) AND NOT si.en_libro
                                  AND coalesce(length(si.recibido_mh), 0) <> 40) AS sin_sello_docs,
               coalesce(sum(si.total) FILTER (WHERE public.venta_valida(si.estado) AND NOT si.en_libro
                                  AND coalesce(length(si.recibido_mh), 0) <> 40), 0) AS sin_sello_monto,
               count(*) FILTER (WHERE si.estado = 'DTE INVALIDADO EN MH') AS anulados_docs,
               coalesce(sum(si.total) FILTER (WHERE si.estado = 'DTE INVALIDADO EN MH'), 0) AS anulados_monto,
               count(*) FILTER (WHERE si.en_libro
                                  AND abs(coalesce(si.iva, 0) - round(coalesce(si.subtotal, 0) * 0.13, 2)) > 0.01) AS iva_raro_docs
        FROM ventas si
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
               coalesce(k.sin_sello_docs, 0)  AS sin_sello_docs,
               coalesce(k.sin_sello_monto, 0) AS sin_sello_monto,
               coalesce(k.anulados_docs, 0)   AS anulados_docs,
               coalesce(k.anulados_monto, 0)  AS anulados_monto,
               coalesce(k.iva_raro_docs, 0)   AS iva_raro_docs,
               coalesce(nullif(z.detalle->'secciones'->'factura'->>'retencion','')::numeric, 0) AS r_factura,
               coalesce(nullif(z.detalle->'secciones'->'ccf'->>'retencion','')::numeric, 0)     AS r_ccf,
               coalesce(nullif(z.detalle->'secciones'->'tiquete'->>'gravadas','')::numeric, 0) AS g_tiquete,
               coalesce(nullif(z.detalle->'secciones'->'factura'->>'gravadas','')::numeric, 0) AS g_factura,
               coalesce(nullif(z.detalle->'secciones'->'ccf'->>'gravadas','')::numeric, 0)     AS g_ccf,
               hh.j AS hallazgos
        FROM public.corte_z z
        JOIN public.branches b ON b.id = z.branch_id
        LEFT JOIN portal  p ON p.branch_id = z.branch_id AND p.periodo = z.periodo
        LEFT JOIN control k ON k.branch_id = z.branch_id AND k.periodo = z.periodo
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
    ), chk AS (
        SELECT base.*,
               (g_tiquete + g_factura + g_ccf) AS z_suma,
               round(p_total - (g_tiquete + g_factura + g_ccf), 2) AS c_cotejo,
               round(p_retencion - (r_factura + r_ccf), 2)         AS c_retencion,
               -- gravadas + débito = total. La retención NO entra: no reduce la
               -- venta y el libro no tiene columna para ella.
               round(coalesce((p_declaracion->'factura'->>'gravadas')::numeric, 0)
                   + coalesce((p_declaracion->'factura'->>'debito')::numeric, 0)
                   + coalesce((p_declaracion->'factura'->>'exentas')::numeric, 0)
                   - coalesce((p_declaracion->'factura'->>'total')::numeric, 0), 2) AS c_coh_cof,
               round(coalesce((p_declaracion->'ccf'->>'gravadas')::numeric, 0)
                   + coalesce((p_declaracion->'ccf'->>'debito')::numeric, 0)
                   + coalesce((p_declaracion->'ccf'->>'exentas')::numeric, 0)
                   - coalesce((p_declaracion->'ccf'->>'total')::numeric, 0), 2)     AS c_coh_ccf,
               round(total_general - (g_tiquete + g_factura + g_ccf)
                   + (r_factura + r_ccf), 2) AS c_ticket
        FROM base
    )
    SELECT branch_id, sucursal, direccion, departamento,
           periodo, fecha_inicio, fecha_fin,
           tiquete_total, factura_total, ccf_total, total_general,
           round(g_factura, 2), round(g_ccf, 2), round(z_suma, 2),
           p_factura, p_ccf, p_total,
           round(p_factura - g_factura, 2),
           round(p_ccf     - g_ccf, 2),
           round(c_cotejo, 2),
           round(r_factura + r_ccf, 2),
           round(p_retencion, 2),
           round(c_retencion, 2),
           round(c_cotejo, 2),
           p_docs,
           hallazgos,
           p_declaracion,
           jsonb_build_array(
               jsonb_build_object(
                   'clave', 'cotejo',
                   'rotulo', 'El libro coincide con el Corte Z',
                   'estado', CASE WHEN abs(c_cotejo) < 0.005 THEN 'ok' ELSE 'alerta' END,
                   'detalle', CASE WHEN abs(c_cotejo) < 0.005
                       THEN 'Las ventas con factura y con crédito fiscal cuadran al centavo contra las ventas gravadas del Corte Z.'
                       ELSE 'Diferencia de $' || to_char(abs(c_cotejo), 'FM999999990.00') || ' contra el Corte Z.' END),
               jsonb_build_object(
                   'clave', 'retencion',
                   'rotulo', 'La retención coincide con la del Corte Z',
                   'estado', CASE WHEN abs(c_retencion) < 0.005 THEN 'ok' ELSE 'alerta' END,
                   'detalle', CASE
                       WHEN abs(c_retencion) >= 0.005
                           THEN 'El Corte Z declara $' || to_char(r_factura + r_ccf, 'FM999999990.00')
                                || ' y el libro suma $' || to_char(p_retencion, 'FM999999990.00') || ' documento por documento.'
                       WHEN p_retencion < 0.005
                           THEN 'Ningún cliente retuvo en el período.'
                       ELSE 'Los $' || to_char(p_retencion, 'FM999999990.00')
                            || ' que sumó el libro documento por documento son los que declara el Corte Z. No reducen la venta: van aparte, como anticipo ya pagado.' END),
               jsonb_build_object(
                   'clave', 'coherencia',
                   'rotulo', 'Las cifras de la declaración se sostienen entre sí',
                   'estado', CASE WHEN abs(c_coh_cof) < 0.005 AND abs(c_coh_ccf) < 0.005 THEN 'ok' ELSE 'alerta' END,
                   'detalle', CASE WHEN abs(c_coh_cof) < 0.005 AND abs(c_coh_ccf) < 0.005
                       THEN 'Ventas exentas + gravadas + débito fiscal = total, en las dos secciones.'
                       ELSE 'La suma no cierra: consumidor $' || to_char(c_coh_cof, 'FM999999990.00')
                            || ', contribuyente $' || to_char(c_coh_ccf, 'FM999999990.00') || '.' END),
               jsonb_build_object(
                   'clave', 'iva',
                   'rotulo', 'El débito fiscal es el 13% de la base',
                   'estado', CASE WHEN iva_raro_docs = 0 THEN 'ok' ELSE 'alerta' END,
                   'detalle', CASE WHEN iva_raro_docs = 0
                       THEN 'Verificado documento por documento en los ' || p_docs || ' del libro.'
                       ELSE iva_raro_docs || ' documento(s) con un débito que no es el 13% de su base.' END),
               jsonb_build_object(
                   'clave', 'sello',
                   'rotulo', 'Ninguna venta quedó fuera del libro sin querer',
                   'estado', CASE WHEN sin_sello_docs = 0 THEN 'ok' ELSE 'alerta' END,
                   'detalle', CASE WHEN sin_sello_docs > 0
                       THEN sin_sello_docs || ' venta(s) por $' || to_char(sin_sello_monto, 'FM999999990.00')
                            || ' figuran vendidas pero sin el sello de Hacienda, así que el libro no las lleva.'
                       WHEN anulados_docs > 0
                           THEN 'Las únicas ' || anulados_docs || ' excluidas son anulaciones, por $'
                                || to_char(anulados_monto, 'FM999999990.00') || '.'
                       ELSE 'Todas las ventas del período tienen sello de Hacienda.' END),
               jsonb_build_object(
                   'clave', 'ticket',
                   'rotulo', 'El total del Corte Z se explica por su retención',
                   'estado', CASE WHEN abs(c_ticket) < 0.005 THEN 'ok' ELSE 'alerta' END,
                   'detalle', CASE
                       WHEN abs(c_ticket) >= 0.005
                           THEN 'Su total se aparta de sus ventas gravadas en $'
                                || to_char(abs(total_general - z_suma), 'FM999999990.00')
                                || ', y la retención que declara sólo explica $'
                                || to_char(r_factura + r_ccf, 'FM999999990.00') || '. Hay que revisarlo.'
                       WHEN (r_factura + r_ccf) < 0.005
                           THEN 'Su total es igual a sus ventas gravadas, como corresponde cuando nadie retuvo.'
                       ELSE 'Su total resta $' || to_char(r_factura + r_ccf, 'FM999999990.00')
                            || ' que sus ventas gravadas ya tenían descontados — el desfase conocido del documento, ni un centavo más.' END)
           ),
           detalle, ticket, obtenido_at
    FROM chk
    ORDER BY periodo DESC, sucursal;
$function$;

CREATE OR REPLACE FUNCTION public.get_corte_z_dias(p_branch_id bigint, p_periodo date)
 RETURNS TABLE(fecha date, documentos bigint, total numeric, numero_control_del text, numero_control_al text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
    WITH vista AS (
        SELECT NOT coalesce((SELECT auth_has_module_permission('corte_z_ver_envio_mh', 'can_view')), false) AS noche_cuenta
    ),
    d AS (
        SELECT si.fecha, si.total, si.numero_control,
               nullif(regexp_replace(si.correlativo, '\D', '', 'g'), '')::bigint AS corr
        FROM public.sales_invoices si
        WHERE si.branch_id = p_branch_id
          AND si.tipo_documento = 'COF'
          AND (public.venta_fiscal(si.estado, si.recibido_mh)
               OR ((SELECT noche_cuenta FROM vista)
                   AND public.venta_valida(si.estado)
                   AND public.cof_no_se_envia_mh(si.tipo_documento, si.fecha, si.hora, si.customer_id)))
          AND si.fecha >= date_trunc('month', p_periodo)::date
          AND si.fecha <= (date_trunc('month', p_periodo) + interval '1 month - 1 day')::date
    )
    SELECT d.fecha, count(*), round(sum(d.total), 2),
           -- Por CORRELATIVO, que es el orden real de emisión (20260803161220).
           (array_agg(d.numero_control ORDER BY d.corr NULLS LAST))[1],
           (array_agg(d.numero_control ORDER BY d.corr DESC NULLS LAST))[1]
    FROM d
    WHERE (SELECT auth_has_module_permission('corte_z', 'can_view'))
      AND ((SELECT auth_module_scope('corte_z')) = 'ALL'
           OR p_branch_id = (SELECT auth_employee_branch_id()))
    GROUP BY d.fecha
    ORDER BY d.fecha;
$function$;

-- La capacidad: quien la tiene ve el Corte Z completo (como hasta hoy).
INSERT INTO public.role_permissions (role_id, module_key, can_view, scope)
SELECT r, 'corte_z_ver_envio_mh', true, 'ALL'
FROM unnest(ARRAY[2, 3, 11, 13, 33, 35]) AS r
ON CONFLICT (role_id, module_key) DO UPDATE SET can_view = true, scope = 'ALL';

-- Jefe/a de Sala: el Corte Z de SU sala, con montos y PDF, en la vista de sala.
INSERT INTO public.role_permissions (role_id, module_key, can_view, scope)
SELECT 19, m, true, 'BRANCH'
FROM unnest(ARRAY['corte_z', 'corte_z_ver_montos', 'corte_z_descargar']) AS m
ON CONFLICT (role_id, module_key) DO UPDATE SET can_view = true, scope = 'BRANCH';
