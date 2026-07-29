-- Facturas de Compra — a pedido del usuario: en Revisión, poder "Confirmar"
-- un PDF huérfano (orphan_pdf) AUNQUE nunca llegue su JSON — antes la única
-- salida para esas filas era "Emparejar a documento existente" (requiere que
-- el JSON de OTRO correo ya exista) o "Descartar" (se pierde el PDF). El
-- status 'confirmado' ya estaba anticipado en el CHECK de status desde
-- 20260717_purchase_dte_review_queue.sql pero nunca se usó.
--
-- Un documento "confirmado sin JSON" no tiene codigo_generacion/tipo_dte/
-- json_path (todo eso sale del JSON que nunca llegó) — se relajan esas 3
-- columnas a NULLABLE. La UNIQUE de codigo_generacion sigue funcionando:
-- Postgres no considera que múltiples NULL choquen entre sí.
SET lock_timeout = '5s';

ALTER TABLE public.purchase_dte_documents
    ALTER COLUMN codigo_generacion DROP NOT NULL,
    ALTER COLUMN tipo_dte DROP NOT NULL,
    ALTER COLUMN json_path DROP NOT NULL;

CREATE OR REPLACE FUNCTION public.resolve_purchase_dte_review(
    p_review_id bigint,
    p_action text,
    p_matched_document_id bigint DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_updated_docs integer;
  v_new_doc_id bigint;
BEGIN
  IF NOT (SELECT auth_can_edit_any(ARRAY['facturas_compra'])) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;
  IF p_action NOT IN ('descartado', 'emparejado', 'confirmado') THEN
    RAISE EXCEPTION 'acción inválida: %', p_action;
  END IF;

  IF p_action = 'emparejado' THEN
    IF p_matched_document_id IS NULL THEN
      RAISE EXCEPTION 'p_matched_document_id requerido para emparejar';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.purchase_dte_review_queue
      WHERE id = p_review_id AND kind = 'orphan_pdf'
    ) THEN
      RAISE EXCEPTION 'solo se puede emparejar una fila kind=orphan_pdf';
    END IF;

    UPDATE public.purchase_dte_documents d
      SET pdf_path = rq.file_path
      FROM public.purchase_dte_review_queue rq
      WHERE d.id = p_matched_document_id AND rq.id = p_review_id AND d.pdf_path IS NULL;
    GET DIAGNOSTICS v_updated_docs = ROW_COUNT;

    IF v_updated_docs = 0 THEN
      RAISE EXCEPTION 'el documento destino ya tiene un PDF asociado';
    END IF;

    UPDATE public.purchase_dte_review_queue
      SET status = 'emparejado', matched_document_id = p_matched_document_id,
          resolved_by = auth_employee_id(), resolved_at = now()
      WHERE id = p_review_id;

  ELSIF p_action = 'confirmado' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.purchase_dte_review_queue
      WHERE id = p_review_id AND kind = 'orphan_pdf' AND status = 'pendiente'
    ) THEN
      RAISE EXCEPTION 'solo se puede confirmar una fila kind=orphan_pdf pendiente';
    END IF;

    INSERT INTO public.purchase_dte_documents (
      codigo_generacion, tipo_dte, json_path, pdf_path,
      account_id, from_email, source_message_id, received_at
    )
    SELECT NULL, NULL, NULL, rq.file_path,
           rq.account_id, rq.from_email, rq.source_message_id, rq.received_at
    FROM public.purchase_dte_review_queue rq
    WHERE rq.id = p_review_id
    RETURNING id INTO v_new_doc_id;

    UPDATE public.purchase_dte_review_queue
      SET status = 'confirmado', matched_document_id = v_new_doc_id,
          resolved_by = auth_employee_id(), resolved_at = now()
      WHERE id = p_review_id;

  ELSE
    UPDATE public.purchase_dte_review_queue
      SET status = 'descartado', resolved_by = auth_employee_id(), resolved_at = now()
      WHERE id = p_review_id;
  END IF;
END;
$$;
