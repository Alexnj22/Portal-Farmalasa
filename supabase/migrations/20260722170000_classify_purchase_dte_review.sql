-- Rediseño a pedido del usuario 2026-07-22: en vez de un botón genérico
-- "Marcar invalidado" suelto en cada documento (sin contexto de por qué),
-- la clasificación vive en Revisión — donde ya está el PDF sin identificar
-- (ej. el sello ANULADO gráfico que unpdf no puede leer como texto). El
-- humano elige el tipo + el documento DTE al que se enlaza, y el efecto
-- (marcar invalidado) es consecuencia de esa clasificación, con
-- trazabilidad real: review_queue.matched_document_id deja registro de
-- QUÉ PDF justificó la acción, no solo un motivo genérico desconectado.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.classify_purchase_dte_review(
    p_review_id bigint,
    p_document_id bigint,
    p_tipo text,
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
  IF p_tipo NOT IN ('anulacion', 'otro') THEN
    RAISE EXCEPTION 'tipo inválido: %', p_tipo;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.purchase_dte_review_queue
    WHERE id = p_review_id AND kind = 'orphan_pdf' AND status = 'pendiente'
  ) THEN
    RAISE EXCEPTION 'solo se puede clasificar una fila kind=orphan_pdf pendiente';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.purchase_dte_documents WHERE id = p_document_id) THEN
    RAISE EXCEPTION 'documento % no existe', p_document_id;
  END IF;

  IF p_tipo = 'anulacion' THEN
    UPDATE public.purchase_dte_documents SET
      invalidado        = true,
      invalidado_motivo = coalesce(nullif(p_motivo, ''), 'Anulación detectada en PDF adjunto (Revisión)'),
      invalidado_at     = now()
    WHERE id = p_document_id AND invalidado = false;
  END IF;

  UPDATE public.purchase_dte_review_queue SET
    status = 'emparejado',
    matched_document_id = p_document_id,
    resolved_by = auth_employee_id(),
    resolved_at = now()
  WHERE id = p_review_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.classify_purchase_dte_review(bigint, bigint, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.classify_purchase_dte_review(bigint, bigint, text, text) TO authenticated, service_role;
