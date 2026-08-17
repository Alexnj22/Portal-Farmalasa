SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.bitacora_tomar_folio(
    p_branch_id bigint, p_anio smallint, p_serie text DEFAULT 'disp'
) RETURNS integer LANGUAGE plpgsql
SET search_path = public, extensions AS $fn$
DECLARE v_folio integer;
BEGIN
    INSERT INTO public.bitacora_folios (branch_id, anio, serie, ultimo)
    VALUES (p_branch_id, p_anio, p_serie, 1)
    ON CONFLICT (branch_id, anio, serie)
    DO UPDATE SET ultimo = public.bitacora_folios.ultimo + 1
    RETURNING ultimo INTO v_folio;
    RETURN v_folio;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.sincronizar_bitacora_dispensaciones(
    p_desde date, p_hasta date, p_branch_id bigint DEFAULT NULL
) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $fn$
DECLARE
    v_r     record;
    v_folio integer;
    v_anio  smallint;
    v_n     integer := 0;
BEGIN
    FOR v_r IN
        SELECT i.id AS item_id, s.id AS invoice_id, s.branch_id, s.fecha, s.hora,
               i.erp_product_id,
               coalesce(nullif(btrim(i.descripcion), ''), p.nombre, 'Sin descripcion') AS producto_nombre,
               l.nombre AS laboratorio,
               i.presentacion,
               i.cantidad, i.lote, i.fecha_vencimiento,
               s.codigo_generacion, s.correlativo, s.tipo_documento, s.estado AS doc_estado,
               s.cliente, s.customer_id, s.cod_vendedor, e.name AS vendedor_nombre
          FROM public.sales_invoice_items i
          JOIN public.sales_invoices s ON s.id = i.invoice_id
          JOIN public.products p       ON p.id = i.erp_product_id
          LEFT JOIN public.laboratorios l ON l.id = p.laboratorio_id
          LEFT JOIN public.employees e ON e.code = s.cod_vendedor
         WHERE p.es_antibiotico
           AND s.fecha BETWEEN p_desde AND p_hasta
           AND (p_branch_id IS NULL OR s.branch_id = p_branch_id)
           AND NOT EXISTS (SELECT 1 FROM public.bitacora_dispensaciones d
                            WHERE d.sales_invoice_item_id = i.id)
         ORDER BY s.branch_id, s.fecha, s.hora NULLS LAST, s.id, i.linea_num NULLS LAST, i.id
    LOOP
        v_anio  := extract(year FROM v_r.fecha)::smallint;
        v_folio := public.bitacora_tomar_folio(v_r.branch_id, v_anio, 'disp');

        INSERT INTO public.bitacora_dispensaciones (
            branch_id, anio, folio, sales_invoice_item_id, invoice_id,
            fecha, hora, erp_product_id, producto_nombre, laboratorio, presentacion,
            cantidad, lote, fecha_vencimiento,
            codigo_generacion, correlativo_doc, tipo_documento, documento_estado,
            cliente_texto, customer_id, cod_vendedor, vendedor_nombre, estado
        ) VALUES (
            v_r.branch_id, v_anio, v_folio, v_r.item_id, v_r.invoice_id,
            v_r.fecha, v_r.hora, v_r.erp_product_id, v_r.producto_nombre, v_r.laboratorio, v_r.presentacion,
            v_r.cantidad, nullif(btrim(v_r.lote), ''), v_r.fecha_vencimiento,
            v_r.codigo_generacion, v_r.correlativo, v_r.tipo_documento, v_r.doc_estado,
            v_r.cliente, v_r.customer_id, v_r.cod_vendedor, v_r.vendedor_nombre,
            CASE WHEN v_r.doc_estado ILIKE '%INVALIDADO%' OR v_r.doc_estado ILIKE '%ANULAD%'
                 THEN 'anulada' ELSE 'pendiente' END
        );
        v_n := v_n + 1;
    END LOOP;

    RETURN v_n;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.get_dispensacion_por_folio(
    p_branch_id bigint, p_anio smallint, p_folio integer
) RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, extensions AS $fn$
DECLARE v_out json;
BEGIN
    PERFORM public.bitacora_exigir_acceso(p_branch_id, 'can_view');

    SELECT json_build_object(
        'folio', d.folio, 'folio_txt', d.folio_txt, 'anio', d.anio,
        'branch_id', d.branch_id, 'sucursal', b.name,
        'estado', d.estado, 'fecha', d.fecha, 'hora', d.hora,
        'producto', json_build_object(
            'id', d.erp_product_id, 'nombre', d.producto_nombre,
            'laboratorio', d.laboratorio, 'presentacion', d.presentacion,
            'cantidad', d.cantidad, 'lote', d.lote, 'vence', d.fecha_vencimiento
        ),
        'venta', json_build_object(
            'invoice_id', d.invoice_id,
            'codigo_generacion', d.codigo_generacion,
            'correlativo', d.correlativo_doc,
            'tipo_documento', d.tipo_documento,
            'estado', d.documento_estado,
            'cliente', d.cliente_texto,
            'customer_id', d.customer_id,
            'vendedor', d.vendedor_nombre,
            'cod_vendedor', d.cod_vendedor,
            'pdf_path', sd.pdf_path,
            'total', s.total
        ),
        'receta', CASE WHEN r.id IS NULL THEN NULL ELSE json_build_object(
            'id', r.id,
            'correlativo', r.correlativo,
            'correlativo_txt', r.anio::text || '-' || lpad(r.correlativo::text, 5, '0'),
            'estado', r.estado,
            'fecha_prescripcion', r.fecha_prescripcion,
            'foto_url', r.foto_url,
            'motivo_pendiente', r.motivo_pendiente,
            'paciente', json_build_object(
                'nombre', r.paciente_nombre, 'edad', r.paciente_edad, 'documento', r.paciente_documento
            ),
            'medico', CASE WHEN m.id IS NULL THEN NULL ELSE json_build_object(
                'id', m.id, 'nombre', m.nombre, 'numero_junta', m.numero_junta,
                'junta', m.junta, 'carrera', m.carrera,
                'origen', m.origen, 'verificado_at', m.verificado_at
            ) END,
            'prescrito', json_build_object(
                'descripcion', ri.descripcion,
                'cantidad_prescrita', ri.cantidad_prescrita,
                'forma_farmaceutica', ri.forma_farmaceutica
            ),
            'entregado', (SELECT coalesce(sum(d2.cantidad), 0)
                            FROM public.bitacora_dispensaciones d2
                           WHERE d2.receta_item_id = ri.id AND d2.estado <> 'anulada'),
            'pendiente', ri.cantidad_prescrita - (SELECT coalesce(sum(d2.cantidad), 0)
                            FROM public.bitacora_dispensaciones d2
                           WHERE d2.receta_item_id = ri.id AND d2.estado <> 'anulada'),
            'entregas', (SELECT coalesce(json_agg(json_build_object(
                              'folio_txt', d3.folio_txt, 'fecha', d3.fecha,
                              'cantidad', d3.cantidad, 'lote', d3.lote
                          ) ORDER BY d3.fecha, d3.folio), '[]'::json)
                          FROM public.bitacora_dispensaciones d3
                         WHERE d3.receta_item_id = ri.id)
        ) END,
        'completada_por', emp.name,
        'completada_at', d.completada_at,
        'notas', d.notas,
        'created_at', d.created_at
    ) INTO v_out
    FROM public.bitacora_dispensaciones d
    JOIN public.branches b ON b.id = d.branch_id
    LEFT JOIN public.sales_invoices s ON s.id = d.invoice_id
    LEFT JOIN public.sales_dte_documents sd ON sd.codigo_generacion = d.codigo_generacion
    LEFT JOIN public.receta_items ri ON ri.id = d.receta_item_id
    LEFT JOIN public.recetas r ON r.id = ri.receta_id
    LEFT JOIN public.medicos m ON m.id = r.medico_id
    LEFT JOIN public.employees emp ON emp.id = d.completada_por
    WHERE d.branch_id = p_branch_id AND d.anio = p_anio AND d.folio = p_folio;

    RETURN v_out;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.get_bitacora_dispensaciones(
    p_branch_id bigint,
    p_desde date,
    p_hasta date,
    p_estado text DEFAULT NULL
) RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, extensions AS $fn$
DECLARE v_out json;
BEGIN
    PERFORM public.bitacora_exigir_acceso(p_branch_id, 'can_view');

    SELECT coalesce(json_agg(x ORDER BY (x->>'folio')::int DESC), '[]'::json) INTO v_out
    FROM (
        SELECT json_build_object(
            'id', d.id, 'folio', d.folio, 'folio_txt', d.folio_txt, 'anio', d.anio,
            'fecha', d.fecha, 'hora', d.hora, 'estado', d.estado,
            'producto_nombre', d.producto_nombre, 'laboratorio', d.laboratorio,
            'cantidad', d.cantidad, 'lote', d.lote, 'vence', d.fecha_vencimiento,
            'cliente', d.cliente_texto, 'vendedor', d.vendedor_nombre,
            'correlativo_doc', d.correlativo_doc, 'codigo_generacion', d.codigo_generacion,
            'tiene_pdf', sd.pdf_path IS NOT NULL,
            'paciente', r.paciente_nombre,
            'medico', m.nombre, 'numero_junta', m.numero_junta,
            'receta_correlativo', CASE WHEN r.id IS NULL THEN NULL
                                       ELSE r.anio::text || '-' || lpad(r.correlativo::text, 5, '0') END,
            'receta_estado', r.estado,
            'tiene_foto', r.foto_url IS NOT NULL,
            'prescrito', ri.cantidad_prescrita,
            'entregado_total', (SELECT coalesce(sum(d2.cantidad), 0)
                                  FROM public.bitacora_dispensaciones d2
                                 WHERE d2.receta_item_id = ri.id AND d2.estado <> 'anulada')
        ) AS x
        FROM public.bitacora_dispensaciones d
        LEFT JOIN public.sales_dte_documents sd ON sd.codigo_generacion = d.codigo_generacion
        LEFT JOIN public.receta_items ri ON ri.id = d.receta_item_id
        LEFT JOIN public.recetas r ON r.id = ri.receta_id
        LEFT JOIN public.medicos m ON m.id = r.medico_id
        WHERE d.branch_id = p_branch_id
          AND d.fecha BETWEEN p_desde AND p_hasta
          AND (p_estado IS NULL OR d.estado = p_estado)
    ) t;

    RETURN v_out;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.bitacora_tomar_folio(bigint, smallint, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.sincronizar_bitacora_dispensaciones(date, date, bigint) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_dispensacion_por_folio(bigint, smallint, integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_bitacora_dispensaciones(bigint, date, date, text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.bitacora_tomar_folio(bigint, smallint, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.sincronizar_bitacora_dispensaciones(date, date, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_dispensacion_por_folio(bigint, smallint, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_bitacora_dispensaciones(bigint, date, date, text) TO authenticated, service_role;
