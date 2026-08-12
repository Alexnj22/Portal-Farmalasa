SET lock_timeout = '5s';

-- El archivo de ventas a contribuyentes salía con 19 columnas y el anexo pide 20.
--
-- Cotejado el 2026-08-11 contra `JUNIO 2026 VCT` —el archivo que el contador
-- presenta— documento por documento: los 49 CCF de junio son los mismos de los
-- dos lados, con el mismo sello, el mismo código de generación, el mismo NRC y
-- las mismas ventas gravadas al centavo. Lo que no coincidía era la ESTRUCTURA.
--
-- Igual que en consumidor, la columna que sobraba no estaba al final: un '0'
-- entre "ventas no sujetas" y "ventas gravadas locales" corría todo un lugar.
-- Con una fila de $15.53 de gravadas y $2.02 de débito:
--
--   ventas gravadas locales   →  0          (la casilla quedaba vacía)
--   débito fiscal             →  15.53      (las gravadas caían en el débito)
--   ventas a cuenta de 3ros   →  2.02       (el débito caía en terceros)
--   total de ventas           →  0.00
--   DUI del cliente           →  17.55      (¡un monto en la casilla del DUI!)
--   tipo de operación (Renta) →  el NIT
--
-- Cambios:
--
-- 1. Fuera el '0' de más.
--
-- 2. TOTAL DE VENTAS = la base, no el cobrado. En el anexo del contador 39 de
--    49 filas llevan la base (las otras 10 llevan base+IVA: su archivo mezcla
--    dos criterios). La base es lo coherente: el débito fiscal ya tiene su
--    columna, y en el anexo de consumidor el total también es la suma de las
--    columnas de ventas. Además el Art. 85 literal l) del Reglamento pide el
--    «total de ventas por documento», que es la suma de las anteriores.
--    Efecto lateral: desaparece el hueco de la retención —el total dejaba de
--    cuadrar con gravadas+débito en los 21 documentos con retención, $87.82
--    desde mayo 2025— porque la retención no forma parte de la base.
--
-- 3. La columna Q es el DUI, no el NIT. El manual las hace excluyentes con H
--    (NIT o NRC): si se llena una, la otra va vacía. Antes iba el NIT ahí
--    siempre, y en personas naturales resultaba ser un DUI de 9 dígitos
--    disfrazado. Ahora H lleva NRC —o el NIT si no hay NRC— y Q sólo lleva el
--    DUI cuando H quedó vacía. En el archivo del contador Q va vacía en las 49.
--
-- 4. Las dos de enero 2025: R = 1 (gravada), S = 3 (actividades comerciales),
--    y T = 1, el número de anexo, que antes ocupaba la posición 19.
--
-- Lo que NO se cambia: el débito fiscal sale del DTE, no de recalcular el 13%.
-- Su archivo recalcula y redondea, y en 2 de los 49 le da un centavo más
-- (2.03 contra 2.02, 5.89 contra 5.88). Se consultó el DTE sellado por Hacienda
-- —dteqr_json.php— de los dos: dicen 2.02 y 5.88. El libro refleja el
-- documento, no lo recalcula.
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
            -- H: NIT o NRC. Excluyente con Q (DUI).
            ident.h,
            btrim(coalesce(si.cliente, '')),
            -- J exentas · K no sujetas · L gravadas locales · M débito fiscal
            to_char(CASE WHEN coalesce(si.iva,0) = 0 THEN coalesce(si.total,0) ELSE 0 END, fmt2),
            '0.00',
            to_char(CASE WHEN coalesce(si.iva,0) > 0 THEN coalesce(si.subtotal,0) ELSE 0 END, fmt2),
            to_char(coalesce(si.iva, 0), fmt2),
            -- N ventas a cuenta de terceros · O su débito
            '0.00', '0.00',
            -- P total de ventas = suma de las columnas de VENTAS (J+K+L+N).
            to_char(CASE WHEN coalesce(si.iva,0) = 0 THEN coalesce(si.total,0)
                         ELSE coalesce(si.subtotal,0) END, fmt2),
            -- Q DUI, sólo si H quedó vacía
            CASE WHEN ident.h = '' THEN replace(btrim(coalesce(c.dui,'')), '-', '') ELSE '' END,
            -- R gravada · S actividades comerciales · T número de anexo
            '1', '3', '1')
        FROM public.sales_invoices si
        LEFT JOIN public.customers c ON c.id = si.customer_id
        CROSS JOIN LATERAL (SELECT replace(coalesce(
                     nullif(btrim(coalesce(c.nrc, '')), ''),
                     nullif(btrim(coalesce(c.nit, '')), ''), ''), '-', '') AS h) ident
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
