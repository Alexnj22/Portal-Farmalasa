SET lock_timeout = '5s';
-- Quién lo marcó, para pintarlo con foto y nombre corto.
CREATE OR REPLACE FUNCTION public.get_compra_erroneos()
RETURNS json LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions AS $$
  SELECT coalesce(json_agg(to_json(t) ORDER BY t.created_at DESC), '[]'::json) FROM (
    SELECT e.id, e.document_id, e.emisor_nombre, e.descripcion, e.codigo_proveedor,
           e.product_id, e.es_generico, e.unidades, e.costo_unitario, e.erp_compra_id,
           e.estado, e.erp_traslado_id, e.nota, e.marcado_por, em.name AS marcado_nombre, e.created_at,
           e.nota_credito_document_id,
           f.numero_control AS factura, f.fecha_emision AS factura_fecha,
           nc.numero_control AS nota_numero, nc.fecha_emision AS nota_fecha, nc.monto_total AS nota_total,
           (SELECT coalesce(json_agg(json_build_object(
                     'id', n.id, 'numero', n.numero_control, 'fecha', n.fecha_emision, 'total', n.monto_total,
                     'relacionada', n.documento_relacionado_id = e.document_id)
                   ORDER BY (n.documento_relacionado_id = e.document_id) DESC NULLS LAST, n.fecha_emision), '[]'::json)
              FROM public.purchase_dte_documents n
             WHERE n.tipo_dte = '05' AND NOT coalesce(n.invalidado, false)
               AND n.emisor_nit = e.emisor_nit AND n.fecha_emision >= f.fecha_emision
           ) AS notas_candidatas
      FROM public.compra_renglon_erroneo e
      JOIN public.purchase_dte_documents f ON f.id = e.document_id
      LEFT JOIN public.purchase_dte_documents nc ON nc.id = e.nota_credito_document_id
      LEFT JOIN public.employees em ON em.id = e.marcado_por
     WHERE (SELECT auth_has_module_permission('compras','can_view'))
        OR (SELECT auth_has_module_permission('cargar_compra','can_view'))
  ) t;
$$;
