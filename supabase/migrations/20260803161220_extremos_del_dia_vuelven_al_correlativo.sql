SET lock_timeout = '5s';

-- El PRIMERO y el ÚLTIMO documento del día vuelven a elegirse por CORRELATIVO.
--
-- Revierte el criterio de 20260802033604, que los eligió por id interno para
-- parecerse al reporte del origen. El origen estaba mal, y la hora de emisión lo
-- decide sin ambigüedad. Medido sobre los 22,192 pares consecutivos de julio
-- 2026, contando cuántas veces la hora va PARA ATRÁS al recorrer el día:
--
--     ordenado por correlativo ......      0 inversiones
--     ordenado por id interno .......  2,234 inversiones  (10.1%)
--
-- El caso que citaba aquella migración como prueba es justamente el que la
-- refuta. La Popular, 2026-06-08: el origen da como primer documento del día el
-- `…020977` (id interno 302651), emitido a las 10:25:31. El primero de verdad es
-- el `…020473` (id interno 302658), emitido a las 07:15:33 — tres horas antes.
-- El id interno es el orden en que el origen CAPTURÓ las filas, no en que se
-- EMITIERON los documentos; por eso 302651 > 302658 en captura y al revés en
-- hora.
--
-- Alcance del error corregido: 252 días con el primero mal y 510 con el último,
-- sobre 2,709 branch-días de historia (26%). Afectaba cuatro columnas de
-- identificación del libro de consumidor —número de control y sello del primero,
-- y los dos códigos de generación—; ningún monto, porque el total diario es una
-- suma sobre el día y no depende de qué documento se nombre.
--
-- Decisión del usuario el 2026-08-03, con la evidencia de arriba a la vista: el
-- libro nombra el documento realmente emitido primero y último, aunque el
-- archivo del portal difiera del que baja del origen. Es la misma decisión que
-- ya se había tomado para los códigos de generación (hallazgo 4.1 de
-- docs/LIBROS-IVA-FORMATO-Y-HALLAZGOS-2026-08-01.md): no se copia un
-- identificador equivocado a un libro que se declara.
--
-- Las CINCO columnas de identidad siguen el mismo criterio, para que la fila
-- describa a los mismos dos documentos: sería peor una fila donde el sello es de
-- un documento y el id interno de otro.
--
-- El criterio vive en TRES lugares y los tres tienen que decir lo mismo: el
-- libro, el conjunto que alimenta el backfill del número de control, y el
-- generador que se usa para verificar.

DROP FUNCTION IF EXISTS public.get_libro_ventas_consumidor(date, date, bigint);
CREATE FUNCTION public.get_libro_ventas_consumidor(
    p_desde date, p_hasta date, p_branch_id bigint DEFAULT NULL)
RETURNS TABLE(branch_id bigint, fecha date, correlativo_del text, correlativo_al text,
              numero_control_del text, numero_control_al text,
              codigo_gen_del uuid, codigo_gen_al uuid, sello_del text,
              erp_id_del text, erp_id_al text, documentos bigint,
              ventas_exentas numeric, ventas_gravadas numeric,
              exportaciones numeric, total_diario numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, extensions AS $fn$
    SELECT si.branch_id, si.fecha,
           (array_agg(si.correlativo       ORDER BY si.corr_num NULLS LAST))[1],
           (array_agg(si.correlativo       ORDER BY si.corr_num DESC NULLS LAST))[1],
           (array_agg(si.numero_control    ORDER BY si.corr_num NULLS LAST))[1],
           (array_agg(si.numero_control    ORDER BY si.corr_num DESC NULLS LAST))[1],
           (array_agg(si.codigo_generacion ORDER BY si.corr_num NULLS LAST))[1],
           (array_agg(si.codigo_generacion ORDER BY si.corr_num DESC NULLS LAST))[1],
           (array_agg(si.recibido_mh       ORDER BY si.corr_num NULLS LAST))[1],
           (array_agg(si.erp_invoice_id    ORDER BY si.corr_num NULLS LAST))[1],
           (array_agg(si.erp_invoice_id    ORDER BY si.corr_num DESC NULLS LAST))[1],
           count(*),
           coalesce(sum(si.total) FILTER (WHERE coalesce(si.iva, 0) = 0), 0),
           coalesce(sum(si.total) FILTER (WHERE coalesce(si.iva, 0) > 0), 0),
           0::numeric,
           coalesce(sum(si.total), 0)
    FROM (
        SELECT s.*, nullif(regexp_replace(s.correlativo, '\D', '', 'g'), '')::bigint AS corr_num
        FROM public.sales_invoices s
    ) si
    WHERE (SELECT auth_has_module_permission('libros_iva', 'can_view'))
      AND ((SELECT auth_module_scope('libros_iva')) = 'ALL'
           OR si.branch_id = (SELECT auth_employee_branch_id()))
      AND si.tipo_documento = 'COF' AND si.estado = 'FINALIZADA'
      AND length(si.recibido_mh) = 40
      AND si.fecha BETWEEN p_desde AND p_hasta
      AND (p_branch_id IS NULL OR si.branch_id = p_branch_id)
    GROUP BY si.branch_id, si.fecha
    ORDER BY si.branch_id, si.fecha;
$fn$;

REVOKE EXECUTE ON FUNCTION public.get_libro_ventas_consumidor(date, date, bigint) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_libro_ventas_consumidor(date, date, bigint) TO authenticated, service_role;

-- El conjunto del backfill usa EL MISMO criterio. Si se desincroniza, el libro
-- pide un documento cuyo número nadie trajo.
CREATE OR REPLACE FUNCTION public._docs_sin_numero_control()
RETURNS TABLE(id bigint, codigo_generacion uuid, fecha date)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, extensions AS $fn$
    WITH universo AS (
        SELECT si.id, si.codigo_generacion, si.branch_id, si.fecha,
               si.tipo_documento, si.estado, si.numero_control,
               nullif(regexp_replace(si.correlativo, '\D', '', 'g'), '')::bigint AS corr_num
        FROM public.sales_invoices si
        WHERE si.codigo_generacion IS NOT NULL AND si.fecha >= '2025-05-01'
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
                   row_number() OVER (PARTITION BY u.branch_id, u.fecha ORDER BY u.corr_num ASC NULLS LAST)  AS r_asc,
                   row_number() OVER (PARTITION BY u.branch_id, u.fecha ORDER BY u.corr_num DESC NULLS LAST) AS r_desc
            FROM universo u
            WHERE u.tipo_documento = 'COF' AND u.estado = 'FINALIZADA'
        ) x
        WHERE x.r_asc = 1 OR x.r_desc = 1
    ),
    todos AS (SELECT * FROM ccf UNION SELECT * FROM anul UNION SELECT * FROM extremos)
    SELECT t.id, t.codigo_generacion, t.fecha FROM todos t WHERE t.numero_control IS NULL;
$fn$;

-- `generar_csv_libro` es la segunda implementación, la que se usa para
-- verificar. Mismo criterio en consumidor. En contribuyentes y anulados el
-- correlativo pasa a ordenar las FILAS del archivo (2 de 560 y 31 de 969 salían
-- en otro orden): mismo dato, secuencia real de emisión.
CREATE OR REPLACE FUNCTION public.generar_csv_libro(p_reporte text, p_desde date, p_hasta date, p_branch_id bigint)
RETURNS SETOF text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, extensions AS $function$
DECLARE
    fmt2 constant text := 'FM999999990.00';
    fmt4 constant text := 'FM999999990.0000';
BEGIN
    IF p_reporte = 'consumidor' THEN
        RETURN QUERY
        SELECT concat_ws(';',
            to_char(si.fecha, 'DD/MM/YYYY'), '4', '01',
            replace(coalesce((array_agg(si.numero_control ORDER BY si.corr_num NULLS LAST))[1], ''), '-', ''),
            coalesce((array_agg(si.recibido_mh ORDER BY si.corr_num NULLS LAST))[1], ''),
            coalesce((array_agg(si.erp_invoice_id ORDER BY si.corr_num NULLS LAST))[1], ''),
            coalesce((array_agg(si.erp_invoice_id ORDER BY si.corr_num DESC NULLS LAST))[1], ''),
            replace(upper(coalesce((array_agg(si.codigo_generacion ORDER BY si.corr_num NULLS LAST))[1]::text, '')), '-', ' '),
            replace(upper(coalesce((array_agg(si.codigo_generacion ORDER BY si.corr_num DESC NULLS LAST))[1]::text, '')), '-', ' '),
            '',
            to_char(coalesce(sum(si.total) FILTER (WHERE coalesce(si.iva,0) = 0), 0), fmt2),
            '0.00', '0.00', '0.0000',
            to_char(coalesce(sum(si.total) FILTER (WHERE coalesce(si.iva,0) > 0), 0), fmt2),
            '0.00', '0.00', '0.00', '0.00', '0.00',
            to_char(coalesce(sum(si.total), 0), fmt2), '2')
        FROM (SELECT s.*, nullif(regexp_replace(s.correlativo,'\D','','g'),'')::bigint AS corr_num
              FROM public.sales_invoices s) si
        WHERE si.tipo_documento = 'COF' AND si.estado = 'FINALIZADA'
          AND length(si.recibido_mh) = 40
          AND si.fecha BETWEEN p_desde AND p_hasta AND si.branch_id = p_branch_id
        GROUP BY si.branch_id, si.fecha
        ORDER BY si.branch_id, si.fecha;

    ELSIF p_reporte = 'contribuyente' THEN
        RETURN QUERY
        SELECT concat_ws(';',
            to_char(si.fecha, 'DD/MM/YYYY'), '4', '03',
            replace(coalesce(si.numero_control, ''), '-', ''),
            coalesce(si.recibido_mh, ''),
            replace(upper(coalesce(si.codigo_generacion::text, '')), '-', ''),
            coalesce(si.erp_invoice_id, ''),
            replace(coalesce(nullif(btrim(coalesce(c.nrc, '')), ''), ''), '-', ''),
            btrim(coalesce(si.cliente, '')),
            to_char(CASE WHEN coalesce(si.iva,0) = 0 THEN coalesce(si.total,0) ELSE 0 END, fmt2),
            '0.00', '0',
            to_char(CASE WHEN coalesce(si.iva,0) > 0 THEN coalesce(si.subtotal,0) ELSE 0 END, fmt2),
            to_char(coalesce(si.iva, 0), fmt2), '0.00', '0.00',
            to_char(coalesce(si.total, 0), fmt2),
            replace(coalesce(nullif(btrim(coalesce(c.nit, '')), ''), ''), '-', ''), '1')
        FROM public.sales_invoices si
        LEFT JOIN public.customers c ON c.id = si.customer_id
        WHERE si.tipo_documento = 'CCF' AND si.estado = 'FINALIZADA'
          AND length(si.recibido_mh) = 40
          AND si.fecha BETWEEN p_desde AND p_hasta AND si.branch_id = p_branch_id
        ORDER BY si.branch_id, si.fecha,
                 nullif(regexp_replace(si.correlativo,'\D','','g'),'')::bigint NULLS LAST;

    ELSIF p_reporte = 'anulados' THEN
        RETURN QUERY
        SELECT concat_ws(';',
            replace(coalesce(si.numero_control, ''), '-', ''), '4', '0', '0',
            CASE WHEN si.tipo_documento = 'CCF' THEN '03' ELSE '01' END, 'D',
            coalesce(si.recibido_mh, ''), '0', '0',
            replace(upper(coalesce(si.codigo_generacion::text, '')), '-', ''))
        FROM public.sales_invoices si
        WHERE si.estado = 'DTE INVALIDADO EN MH'
          AND si.fecha BETWEEN p_desde AND p_hasta AND si.branch_id = p_branch_id
        ORDER BY si.branch_id, si.fecha,
                 nullif(regexp_replace(si.correlativo,'\D','','g'),'')::bigint NULLS LAST;

    ELSIF p_reporte = 'compras' THEN
        RETURN QUERY
        SELECT concat_ws(';',
            to_char(pr.fecha, 'DD/MM/YYYY'), '4', '',
            coalesce(pr.documento_numero, ''),
            replace(coalesce(nullif(btrim(coalesce(pm.nit, '')), ''), ''), '-', ''),
            btrim(coalesce(pr.proveedor, '')),
            '0.00', '0.00', '0.00',
            to_char(coalesce(pr.subtotal, 0) - coalesce(pr.percepcion_iva, 0), fmt2),
            '0.00', '0.00', '0.00',
            to_char(coalesce(pr.iva, 0), fmt2),
            to_char(coalesce(pr.total, 0), fmt2),
            '', '1', '1', '2', '5', '3',
            CASE WHEN pr.percepcion_iva IS NULL THEN '' ELSE to_char(pr.percepcion_iva, fmt4) END, '')
        FROM public.purchase_receipts pr
        LEFT JOIN public.proveedores_maestro pm ON pm.supplier_id = pr.supplier_id
        WHERE pr.fecha BETWEEN p_desde AND p_hasta AND pr.branch_id = p_branch_id
        ORDER BY pr.branch_id, pr.fecha, pr.erp_purchase_id;

    ELSIF p_reporte = 'percepcion' THEN
        RETURN QUERY
        SELECT concat_ws(';',
            row_number() OVER (ORDER BY pr.branch_id, pr.fecha, pr.erp_purchase_id)::text,
            to_char(pr.fecha, 'DD/MM/YYYY'),
            btrim(coalesce(pr.proveedor, '')),
            replace(coalesce(nullif(btrim(coalesce(pm.nit, '')), ''), ''), '-', ''),
            CASE WHEN pr.documento_tipo = 'CCF' THEN '03' ELSE '01' END,
            coalesce(pr.documento_numero, ''), '',
            to_char(coalesce(pr.subtotal, 0) - coalesce(pr.percepcion_iva, 0), fmt4),
            to_char(coalesce(pr.percepcion_iva, 0), fmt4))
        FROM public.purchase_receipts pr
        LEFT JOIN public.proveedores_maestro pm ON pm.supplier_id = pr.supplier_id
        WHERE pr.fecha BETWEEN p_desde AND p_hasta AND pr.branch_id = p_branch_id
          AND coalesce(pr.percepcion_iva, 0) > 0
        ORDER BY pr.branch_id, pr.fecha, pr.erp_purchase_id;
    END IF;
END;
$function$;
