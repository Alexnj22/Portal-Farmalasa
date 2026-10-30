SET lock_timeout = '5s';
-- Deshace «No va a Bodega»: el documento (o todo el proveedor) vuelve a la cola.
CREATE OR REPLACE FUNCTION public.compra_devolver_documento(p_document_id bigint, p_proveedor boolean DEFAULT false)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_doc public.purchase_dte_documents%ROWTYPE;
  n int := 0;
BEGIN
  IF NOT public.auth_can_edit_any(ARRAY['compras', 'facturas_compra', 'cargar_compra']) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_doc FROM public.purchase_dte_documents WHERE id = p_document_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Documento % no existe', p_document_id; END IF;
  IF p_proveedor THEN
    DELETE FROM public.compra_proveedor_no_va_a_bodega WHERE nit = v_doc.emisor_nit;
  ELSE
    DELETE FROM public.compra_documento_resuelto WHERE document_id = p_document_id AND motivo = 'no_va_a_bodega';
  END IF;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN json_build_object('ok', n > 0);
END $$;
REVOKE EXECUTE ON FUNCTION public.compra_devolver_documento(bigint, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.compra_devolver_documento(bigint, boolean) TO authenticated, service_role;
