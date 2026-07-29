-- Pedido del usuario 2026-07-22: tras clasificar un PDF huérfano de
-- Revisión como "Aviso de anulación" (classify_purchase_dte_review,
-- 20260722170000), el documento queda invalidado=true pero no había forma
-- de VER el PDF que lo justificó (el review_queue.file_path original queda
-- en la fila 'emparejado', invisible una vez que sale de "pendiente"). Este
-- RPC de solo lectura expone esa fila por matched_document_id, para que
-- FormPurchaseDteViewer pueda ofrecer un link "Ver PDF de anulación".
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.get_purchase_dte_review_source(p_document_id bigint)
RETURNS json
LANGUAGE sql
STABLE
SET search_path = public, extensions
AS $$
  SELECT coalesce(json_agg(to_json(t)), '[]'::json)
  FROM (
    SELECT id, file_path, filename, subject, from_email, received_at, resolved_at
    FROM public.purchase_dte_review_queue
    WHERE matched_document_id = p_document_id AND status = 'emparejado'
    ORDER BY resolved_at DESC
  ) t;
$$;

REVOKE ALL ON FUNCTION public.get_purchase_dte_review_source(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_purchase_dte_review_source(bigint) TO authenticated, service_role;
