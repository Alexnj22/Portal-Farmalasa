-- «No era error» (2026-11-09): un renglón marcado como error del proveedor que
-- sí era el producto correcto vuelve de vencidos al estante (acción
-- `erroneo_deshacer` de cargar-compra-erp) y queda `deshecho`, fuera de la lista.
SET lock_timeout = '5s';

ALTER TABLE public.compra_renglon_erroneo DROP CONSTRAINT compra_renglon_erroneo_estado_check;
ALTER TABLE public.compra_renglon_erroneo ADD CONSTRAINT compra_renglon_erroneo_estado_check
  CHECK (estado = ANY (ARRAY['por_mover','en_vencidos','con_nota','saliendo','salio','sin_verificar','deshaciendo','deshecho']));

ALTER TABLE public.compra_renglon_erroneo
  ADD COLUMN IF NOT EXISTS deshecho_traslado_id text,
  ADD COLUMN IF NOT EXISTS deshecho_at timestamptz,
  ADD COLUMN IF NOT EXISTS deshecho_por uuid REFERENCES public.employees(id);

CREATE OR REPLACE FUNCTION public.get_compra_erroneos()
 RETURNS json
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT coalesce(json_agg(to_json(t) ORDER BY t.created_at DESC), '[]'::json) FROM (
    SELECT e.id, e.document_id, e.manual_id, e.emisor_nombre, e.descripcion, e.codigo_proveedor,
           e.product_id, e.es_generico, e.unidades, e.costo_unitario, e.erp_compra_id,
           e.estado, e.erp_traslado_id, e.en_vencidos_at, e.nota, e.marcado_por, em.name AS marcado_nombre, e.created_at,
           e.updated_at, e.nota_credito_document_id, e.nota_papel_id, e.motivo,
           coalesce(f.numero_control, m.numero) AS factura,
           coalesce(f.fecha_emision, m.fecha_emision) AS factura_fecha,
           (e.manual_id IS NOT NULL) AS factura_en_papel,
           coalesce(nc.numero_control, np.numero) AS nota_numero,
           coalesce(nc.fecha_emision, np.fecha) AS nota_fecha,
           coalesce(nc.monto_total, np.total) AS nota_total,
           CASE WHEN np.id IS NOT NULL THEN json_build_object(
             'id', np.id, 'numero', np.numero, 'serie', np.serie, 'fecha', np.fecha,
             'subtotal', np.subtotal, 'iva', np.iva, 'total', np.total, 'estado', np.estado, 'error', np.error)
           END AS nota_papel,
           (SELECT coalesce(json_agg(json_build_object(
                     'id', n.id, 'numero', n.numero_control, 'fecha', n.fecha_emision, 'total', n.monto_total,
                     'relacionada', n.documento_relacionado_id = e.document_id)
                   ORDER BY (n.documento_relacionado_id = e.document_id) DESC NULLS LAST, n.fecha_emision), '[]'::json)
              FROM public.purchase_dte_documents n
             WHERE n.tipo_dte = '05' AND NOT coalesce(n.invalidado, false)
               AND n.emisor_nit = e.emisor_nit AND n.fecha_emision >= coalesce(f.fecha_emision, m.fecha_emision)
           ) AS notas_candidatas
      FROM public.compra_renglon_erroneo e
      LEFT JOIN public.purchase_dte_documents f ON f.id = e.document_id
      LEFT JOIN public.compra_documento_manual m ON m.id = e.manual_id
      LEFT JOIN public.purchase_dte_documents nc ON nc.id = e.nota_credito_document_id
      LEFT JOIN public.compra_nota_credito_papel np ON np.id = e.nota_papel_id
      LEFT JOIN public.employees em ON em.id = e.marcado_por
     WHERE e.estado <> 'deshecho'
       AND ((SELECT auth_has_module_permission('compras','can_view'))
         OR (SELECT auth_has_module_permission('cargar_compra','can_view')))
  ) t;
$function$;
