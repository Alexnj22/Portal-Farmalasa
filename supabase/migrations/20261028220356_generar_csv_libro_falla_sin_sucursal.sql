-- `generar_csv_libro` ya no devuelve un libro vacío sin error (2026-10-28).
-- CONTABILIDAD.md §2 ítem 13. Con `p_branch_id => NULL` —o un reporte mal
-- escrito— devolvía cero filas: un archivo fiscal vacío que parece correcto.
-- Ahora falla con el motivo. Hoy la única que la llama (`verificar-csv-libros`)
-- pasa siempre una sucursal, así que nada cambia para ella.
-- Partida de la definición VIVA (pg_get_functiondef), sólo se agrega la guarda.
SET lock_timeout = '5s';

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
    -- Sin sucursal, cada rama filtraba `branch_id = NULL` y devolvía CERO filas
    -- sin error: la forma exacta de un archivo fiscal vacío que parece correcto.
    -- Se pide una sala por vez (así la llama `verificar-csv-libros`); sin ella, falla.
    IF p_branch_id IS NULL THEN
        RAISE EXCEPTION 'generar_csv_libro: falta la sucursal (p_branch_id); el libro se arma una sucursal por vez'
              USING ERRCODE = '22004';
    END IF;
    IF p_reporte IS NULL OR p_reporte NOT IN ('consumidor','contribuyente','anulados','compras','percepcion') THEN
        RAISE EXCEPTION 'generar_csv_libro: reporte desconocido «%»', p_reporte USING ERRCODE = '22023';
    END IF;

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
            -- `subtotal + iva` y no `total`: el total está neto de la retención
            -- del Art. 162, que es un anticipo del cliente y no una venta menor.
            -- El libro no tiene columna de impuesto retenido (Art. 83 RCT).
            to_char(coalesce(sum(si.subtotal + si.iva) FILTER (WHERE coalesce(si.iva,0) = 0), 0), fmt2),
            '0.00', '0.00',
            -- N ventas gravadas locales, con IVA incluido
            to_char(coalesce(sum(si.subtotal + si.iva) FILTER (WHERE coalesce(si.iva,0) > 0), 0), fmt2),
            -- O..S exportaciones (CA, fuera de CA, servicios), zonas francas, terceros
            '0.00', '0.00', '0.00', '0.00', '0.00',
            -- T total · U tipo de operación · V tipo de ingreso · W número de anexo
            to_char(coalesce(sum(si.subtotal + si.iva), 0), fmt2), '1', '3', '2')
        FROM (SELECT s.*, nullif(regexp_replace(s.correlativo,'\D','','g'),'')::bigint AS corr_num
              FROM public.sales_invoices s) si
        WHERE si.tipo_documento = 'COF' AND public.venta_fiscal(si.estado, si.recibido_mh)
          AND si.fecha BETWEEN p_desde AND p_hasta AND si.branch_id = p_branch_id
        GROUP BY si.branch_id, si.fecha
        ORDER BY si.branch_id, si.fecha;

    ELSIF p_reporte = 'contribuyente' THEN
        -- NO SE TOCA. Sus columnas salen de `subtotal` y `iva`, que la retención
        -- no toca, así que ya son correctas: verificado fila por fila contra el
        -- DTE sellado de BANCO PROMERICA (gravadas 359.79, débito 46.77).
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
        WHERE si.tipo_documento = 'CCF' AND public.venta_fiscal(si.estado, si.recibido_mh)
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
