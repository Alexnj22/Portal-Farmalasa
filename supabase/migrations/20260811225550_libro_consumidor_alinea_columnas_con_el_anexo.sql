SET lock_timeout = '5s';

-- El archivo de consumidor final tenía una columna de más y le faltaban dos.
--
-- Cotejado el 2026-08-11 contra el anexo de junio 2026 que el contador presenta
-- —una línea real, sucursal S001P005, día 01/06— y contra el Manual de carga de
-- anexos F-07 v14 (Ministerio de Hacienda, enero 2025), que pide 23 columnas.
-- El archivo salía con 22, y el desajuste no era al final sino en el medio:
--
--   un '0.0000' entre "ventas no sujetas" y "ventas gravadas locales" corría
--   TODO el resto de la fila un lugar a la izquierda.
--
-- La consecuencia no era cosmética. En la fila de ese día, con $1,164.98 de
-- ventas gravadas:
--
--   ventas gravadas locales  →  0.00        (¡la casilla quedaba vacía!)
--   exportaciones dentro CA  →  1,164.98    (la venta se declaraba exportada)
--   venta a cuenta de terceros → 1,164.98   (el total caía acá)
--   total de ventas          →  0.00
--   tipo de ingreso (Renta)  →  2           (era el número de anexo)
--
-- El '0.0000' venía de replicar el archivo del sistema de origen, que lo trae;
-- pero el anexo no tiene esa columna. Los cuatro decimales eran la pista: en
-- este anexo Hacienda toma 2 en todas.
--
-- Y las dos que faltaban son las que Hacienda agregó en enero 2025:
--   U TIPO DE OPERACIÓN (Renta) = 1  gravada
--   V TIPO DE INGRESO   (Renta) = 3  actividades comerciales
-- Son constantes para una farmacia y así vienen en el anexo del contador.
--
-- NO se copian del anexo de referencia sus columnas H e I. Ese archivo trae ahí
-- el código de generación alfabéticamente menor y mayor del día en vez del
-- primero y el último emitidos —verificado: min()/max() del texto del UUID de
-- ese día dan exactamente los dos que trae—, y el manual pide el del primer y
-- último DTE. Los de acá salen ordenados por correlativo y son los correctos.
CREATE OR REPLACE FUNCTION public.generar_csv_libro(p_reporte text, p_desde date, p_hasta date, p_branch_id bigint)
 RETURNS SETOF text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
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
            -- K exentas · L exentas no sujetas a proporcionalidad · M no sujetas
            to_char(coalesce(sum(si.total) FILTER (WHERE coalesce(si.iva,0) = 0), 0), fmt2),
            '0.00', '0.00',
            -- N ventas gravadas locales, con IVA incluido
            to_char(coalesce(sum(si.total) FILTER (WHERE coalesce(si.iva,0) > 0), 0), fmt2),
            -- O..S exportaciones (CA, fuera de CA, servicios), zonas francas, terceros
            '0.00', '0.00', '0.00', '0.00', '0.00',
            -- T total · U tipo de operación · V tipo de ingreso · W número de anexo
            to_char(coalesce(sum(si.total), 0), fmt2), '1', '3', '2')
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
