SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.set_purchase_dte_proveedor(p_document_id bigint, p_proveedor_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  IF NOT (SELECT auth_can_edit_any(ARRAY['facturas_compra'])) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;
  UPDATE public.purchase_dte_documents SET proveedor_id = p_proveedor_id WHERE id = p_document_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.set_purchase_dte_proveedor(bigint, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_purchase_dte_proveedor(bigint, bigint) TO authenticated, service_role;
