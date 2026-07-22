-- A pedido del usuario 2026-07-22: no existía ninguna forma manual de
-- marcar invalidado=true — solo el detector automático de JSON (esquema
-- {documento.codigoGeneracion, motivo}) o el intento de detección en PDF
-- (que falla cuando el sello "ANULADO" es un watermark gráfico, no texto
-- seleccionable — caso real verificado: Grupo Jamilu). Toggle reversible
-- por si el usuario se equivoca al marcarlo.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.set_purchase_dte_invalidado(
    p_document_id bigint,
    p_invalidado boolean,
    p_motivo text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
BEGIN
  IF NOT (SELECT auth_can_edit_any(ARRAY['facturas_compra'])) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;
  UPDATE public.purchase_dte_documents SET
    invalidado         = p_invalidado,
    invalidado_motivo  = CASE WHEN p_invalidado THEN coalesce(nullif(p_motivo, ''), 'Marcado manualmente') ELSE NULL END,
    invalidado_at      = CASE WHEN p_invalidado THEN now() ELSE NULL END
  WHERE id = p_document_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.set_purchase_dte_invalidado(bigint, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_purchase_dte_invalidado(bigint, boolean, text) TO authenticated, service_role;
