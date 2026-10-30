SET lock_timeout = '5s';
-- Mientras se le está dando salida, la nota no se cambia.
CREATE OR REPLACE FUNCTION public.compra_erroneo_adjuntar_nota(p_id bigint, p_nota bigint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE v_e public.compra_renglon_erroneo; v_n public.purchase_dte_documents;
BEGIN
  IF NOT public.auth_can_edit_any(ARRAY['compras','cargar_compra']) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  SELECT * INTO v_e FROM public.compra_renglon_erroneo WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ese renglón no existe.'; END IF;
  IF v_e.estado IN ('salio','saliendo') THEN RAISE EXCEPTION 'Ese producto ya salió o está saliendo.'; END IF;
  IF p_nota IS NOT NULL THEN
    SELECT * INTO v_n FROM public.purchase_dte_documents WHERE id = p_nota;
    IF NOT FOUND OR v_n.tipo_dte <> '05' THEN RAISE EXCEPTION 'Eso no es una nota de crédito.'; END IF;
    IF v_n.emisor_nit IS DISTINCT FROM v_e.emisor_nit THEN RAISE EXCEPTION 'La nota es de otro proveedor.'; END IF;
  END IF;
  UPDATE public.compra_renglon_erroneo
     SET nota_credito_document_id = p_nota,
         estado = CASE WHEN p_nota IS NOT NULL THEN 'con_nota'
                       WHEN erp_traslado_id IS NOT NULL THEN 'en_vencidos' ELSE 'por_mover' END,
         updated_at = now()
   WHERE id = p_id;
END;
$$;
