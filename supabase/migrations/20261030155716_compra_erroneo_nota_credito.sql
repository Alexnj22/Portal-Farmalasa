SET lock_timeout = '5s';
-- La lista de lo que vino por error, con las notas de crédito que le pueden
-- corresponder: primero la que el propio documento relaciona con la factura,
-- después cualquier nota del mismo proveedor desde la fecha de la factura.
CREATE OR REPLACE FUNCTION public.get_compra_erroneos()
RETURNS json LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions AS $$
  SELECT coalesce(json_agg(to_json(t) ORDER BY t.created_at DESC), '[]'::json) FROM (
    SELECT e.id, e.document_id, e.emisor_nombre, e.descripcion, e.codigo_proveedor,
           e.product_id, e.es_generico, e.unidades, e.costo_unitario, e.erp_compra_id,
           e.estado, e.erp_traslado_id, e.nota, e.marcado_por, e.created_at,
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
     WHERE (SELECT auth_has_module_permission('compras','can_view'))
        OR (SELECT auth_has_module_permission('cargar_compra','can_view'))
  ) t;
$$;
REVOKE EXECUTE ON FUNCTION public.get_compra_erroneos() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_compra_erroneos() TO authenticated, service_role;

-- Adjuntar (o quitar, con NULL) la nota de crédito de un renglón erróneo.
CREATE OR REPLACE FUNCTION public.compra_erroneo_adjuntar_nota(p_id bigint, p_nota bigint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE v_e public.compra_renglon_erroneo; v_n public.purchase_dte_documents;
BEGIN
  IF NOT public.auth_can_edit_any(ARRAY['compras','cargar_compra']) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  SELECT * INTO v_e FROM public.compra_renglon_erroneo WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ese renglón no existe.'; END IF;
  IF v_e.estado = 'salio' THEN RAISE EXCEPTION 'Ese producto ya salió.'; END IF;
  IF p_nota IS NOT NULL THEN
    SELECT * INTO v_n FROM public.purchase_dte_documents WHERE id = p_nota;
    IF NOT FOUND OR v_n.tipo_dte <> '05' THEN RAISE EXCEPTION 'Eso no es una nota de crédito.'; END IF;
    IF v_n.emisor_nit IS DISTINCT FROM v_e.emisor_nit THEN RAISE EXCEPTION 'La nota es de otro proveedor.'; END IF;
  END IF;
  UPDATE public.compra_renglon_erroneo
     SET nota_credito_document_id = p_nota,
         estado = CASE WHEN p_nota IS NOT NULL THEN 'con_nota'
                       WHEN erp_traslado_id IS NOT NULL AND nota IS NULL THEN 'en_vencidos' ELSE 'por_mover' END,
         updated_at = now()
   WHERE id = p_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.compra_erroneo_adjuntar_nota(bigint, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.compra_erroneo_adjuntar_nota(bigint, bigint) TO authenticated, service_role;
