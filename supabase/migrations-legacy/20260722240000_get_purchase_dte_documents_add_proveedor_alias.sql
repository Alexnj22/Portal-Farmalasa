SET lock_timeout = '5s';

-- Expone proveedores_maestro.alias (búsqueda alterna, v2.27.1) al buscador
-- de Documentos en Facturas de Compra — hasta ahora no se podía buscar por
-- alias ahí, solo en el módulo Proveedores.
CREATE OR REPLACE FUNCTION public.get_purchase_dte_documents(p_desde date DEFAULT (CURRENT_DATE - 60), p_hasta date DEFAULT CURRENT_DATE)
 RETURNS json
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT coalesce(json_agg(to_json(t)), '[]'::json)
  FROM (
    SELECT
      d.id, d.codigo_generacion, d.tipo_dte, d.numero_control,
      d.emisor_nit, d.emisor_nrc, d.emisor_nombre,
      d.fecha_emision, d.monto_total, d.total_iva,
      d.json_path, d.pdf_path, d.account_id, d.from_email,
      d.source_message_id, d.received_at, d.created_at,
      d.supplier_id, s.nombre AS supplier_nombre,
      d.proveedor_id, p.nombre AS proveedor_nombre, p.alias AS proveedor_alias,
      d.documento_relacionado_id,
      d.invalidado, d.invalidado_motivo, d.invalidado_at,
      d.items_text,
      CASE WHEN dr.id IS NULL THEN NULL ELSE json_build_object(
        'id', dr.id, 'codigo_generacion', dr.codigo_generacion,
        'tipo_dte', dr.tipo_dte, 'numero_control', dr.numero_control,
        'monto_total', dr.monto_total, 'fecha_emision', dr.fecha_emision,
        'emisor_nombre', dr.emisor_nombre, 'json_path', dr.json_path, 'pdf_path', dr.pdf_path
      ) END AS documento_relacionado,
      (
        SELECT coalesce(json_agg(json_build_object(
          'id', nc.id, 'codigo_generacion', nc.codigo_generacion,
          'tipo_dte', nc.tipo_dte, 'numero_control', nc.numero_control,
          'monto_total', nc.monto_total, 'fecha_emision', nc.fecha_emision,
          'emisor_nombre', nc.emisor_nombre, 'json_path', nc.json_path, 'pdf_path', nc.pdf_path
        ) ORDER BY nc.fecha_emision), '[]'::json)
        FROM public.purchase_dte_documents nc
        WHERE nc.documento_relacionado_id = d.id
      ) AS notas_credito,
      (
        SELECT json_build_object('id', rq.id, 'file_path', rq.file_path, 'filename', rq.filename)
        FROM public.purchase_dte_review_queue rq
        WHERE rq.matched_document_id = d.id AND rq.status = 'emparejado' AND rq.file_path IS NOT NULL
        ORDER BY rq.resolved_at DESC
        LIMIT 1
      ) AS invalidacion_source
    FROM public.purchase_dte_documents d
    LEFT JOIN public.suppliers s ON s.id = d.supplier_id
    LEFT JOIN public.proveedores_maestro p ON p.id = d.proveedor_id
    LEFT JOIN public.purchase_dte_documents dr ON dr.id = d.documento_relacionado_id
    WHERE coalesce(d.fecha_emision, d.created_at::date) BETWEEN p_desde AND p_hasta
    ORDER BY coalesce(d.fecha_emision, d.created_at::date) DESC, d.created_at DESC
  ) t;
$function$;
