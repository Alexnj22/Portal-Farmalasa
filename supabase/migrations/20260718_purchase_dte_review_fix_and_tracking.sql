-- Facturas de compra — fixes de code review (2026-07-18):
-- 1. resolve_purchase_dte_review: (a) no validaba kind='orphan_pdf' antes de
--    pisar pdf_path con la ruta de un JSON inválido; (b) marcaba 'emparejado'
--    aunque el UPDATE de purchase_dte_documents no afectara ninguna fila
--    (documento que ya tenía pdf_path) — el PDF quedaba huérfano sin aviso.
-- 2. Tabla nueva purchase_dte_processed_messages: la edge function marcaba un
--    mensaje como "hecho" únicamente si dejaba una fila en
--    purchase_dte_documents o purchase_dte_review_queue — un DTE duplicado
--    (ON CONFLICT DO NOTHING) o un correo con solo adjuntos no soportados
--    (zip) no dejaban ninguna fila, así que se re-escaneaban desde Gmail en
--    CADA corrida del cron, para siempre (confirmado: SERFINSA manda un zip
--    diario, ya hay 11+ mensajes así solo en el rango de prueba).
SET lock_timeout = '5s';

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
BEGIN
  IF NOT (SELECT auth_can_edit_any(ARRAY['facturas_compra'])) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;
  IF p_action NOT IN ('descartado', 'emparejado') THEN
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
  ELSE
    UPDATE public.purchase_dte_review_queue
      SET status = 'descartado', resolved_by = auth_employee_id(), resolved_at = now()
      WHERE id = p_review_id;
  END IF;
END;
$$;

-- Ledger de mensajes ya procesados (cualquier resultado: insertado, duplicado
-- vía ON CONFLICT, o ignorado por adjunto no soportado) — reemplaza la
-- inferencia previa basada en "¿dejó fila en documents o review_queue?", que
-- no cubría duplicados ni mensajes sin ningún adjunto válido.
CREATE TABLE public.purchase_dte_processed_messages (
    id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    account_id         bigint NOT NULL REFERENCES public.email_sync_accounts(id),
    source_message_id  text NOT NULL,
    processed_at       timestamptz NOT NULL DEFAULT now(),
    UNIQUE (account_id, source_message_id)
);

CREATE INDEX idx_purchase_dte_processed_account ON public.purchase_dte_processed_messages (account_id);

ALTER TABLE public.purchase_dte_processed_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY purchase_dte_processed_select ON public.purchase_dte_processed_messages
    FOR SELECT TO authenticated
    USING ((SELECT auth_has_module_permission('facturas_compra', 'can_view')));

REVOKE ALL ON public.purchase_dte_processed_messages FROM anon;
GRANT SELECT ON public.purchase_dte_processed_messages TO authenticated, service_role;
GRANT INSERT ON public.purchase_dte_processed_messages TO service_role;
