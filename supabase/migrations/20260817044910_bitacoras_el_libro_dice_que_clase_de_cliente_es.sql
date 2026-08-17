SET lock_timeout = '5s';

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
            'branch_id', d.branch_id,
            'fecha', d.fecha, 'hora', d.hora, 'estado', d.estado,
            'motivo_anulacion', d.motivo_anulacion,
            'producto_nombre', d.producto_nombre, 'laboratorio', d.laboratorio,
            'erp_product_id', d.erp_product_id,
            'cantidad', d.cantidad, 'lote', d.lote, 'vence', d.fecha_vencimiento,
            'cliente', d.cliente_texto, 'vendedor', d.vendedor_nombre,
            'clase_cliente', public.clase_de_cliente(d.cliente_texto, d.customer_id),
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

CREATE OR REPLACE FUNCTION public.get_dispensacion_por_folio(
    p_branch_id bigint, p_anio smallint, p_folio integer
) RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, extensions AS $fn$
DECLARE v_out json;
BEGIN
    PERFORM public.bitacora_exigir_acceso(p_branch_id, 'can_view');

    SELECT json_build_object(
        'id', d.id,
        'folio', d.folio, 'folio_txt', d.folio_txt, 'anio', d.anio,
        'branch_id', d.branch_id, 'sucursal', b.name,
        'estado', d.estado, 'fecha', d.fecha, 'hora', d.hora,
        'motivo_anulacion', d.motivo_anulacion,
        'detalle_anulacion', d.detalle_anulacion,
        'anulada_por', emp2.name,
        'anulada_at', d.anulada_at,
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
            'clase_cliente', public.clase_de_cliente(d.cliente_texto, d.customer_id),
            'cliente_dui', c.dui,
            'cliente_categoria', c.categoria,
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
                              'cantidad', d3.cantidad, 'lote', d3.lote,
                              'estado', d3.estado, 'motivo_anulacion', d3.motivo_anulacion
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
    LEFT JOIN public.customers c ON c.id = d.customer_id
    LEFT JOIN public.sales_dte_documents sd ON sd.codigo_generacion = d.codigo_generacion
    LEFT JOIN public.receta_items ri ON ri.id = d.receta_item_id
    LEFT JOIN public.recetas r ON r.id = ri.receta_id
    LEFT JOIN public.medicos m ON m.id = r.medico_id
    LEFT JOIN public.employees emp ON emp.id = d.completada_por
    LEFT JOIN public.employees emp2 ON emp2.id = d.anulada_por
    WHERE d.branch_id = p_branch_id AND d.anio = p_anio AND d.folio = p_folio;

    RETURN v_out;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.get_bitacora_dispensaciones(bigint, date, date, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_dispensacion_por_folio(bigint, smallint, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_bitacora_dispensaciones(bigint, date, date, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_dispensacion_por_folio(bigint, smallint, integer) TO authenticated, service_role;
