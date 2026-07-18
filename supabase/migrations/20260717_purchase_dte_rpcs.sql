-- Facturas de compra — RPCs para la vista (Fase 5).
-- Patrón C (RETURNS json + json_agg(to_json(t))) para las 2 de lectura — evita
-- el cap de 1000 filas de PostgREST y N ejecuciones por chunk. SECURITY INVOKER:
-- la policy RLS ya existente sobre purchase_dte_documents/review_queue decide
-- (mismo patrón que get_pedido_preview/get_stock_analysis).
SET lock_timeout = '5s';

CREATE FUNCTION public.get_purchase_dte_documents(
    p_desde date DEFAULT (CURRENT_DATE - 60),
    p_hasta date DEFAULT CURRENT_DATE
)
RETURNS json
LANGUAGE sql STABLE
SECURITY INVOKER
SET search_path = public, extensions
AS $$
  SELECT coalesce(json_agg(to_json(t)), '[]'::json)
  FROM (
    SELECT
      d.id, d.codigo_generacion, d.tipo_dte, d.numero_control,
      d.emisor_nit, d.emisor_nrc, d.emisor_nombre,
      d.fecha_emision, d.monto_total, d.total_iva,
      d.json_path, d.pdf_path, d.account_id, d.from_email,
      d.source_message_id, d.received_at, d.created_at,
      d.supplier_id, s.nombre AS supplier_nombre
    FROM public.purchase_dte_documents d
    LEFT JOIN public.suppliers s ON s.id = d.supplier_id
    WHERE coalesce(d.fecha_emision, d.created_at::date) BETWEEN p_desde AND p_hasta
    ORDER BY coalesce(d.fecha_emision, d.created_at::date) DESC, d.created_at DESC
  ) t;
$$;

REVOKE EXECUTE ON FUNCTION public.get_purchase_dte_documents(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_purchase_dte_documents(date, date) TO authenticated, service_role;

CREATE FUNCTION public.get_purchase_dte_review_queue(p_status text DEFAULT 'pendiente')
RETURNS json
LANGUAGE sql STABLE
SECURITY INVOKER
SET search_path = public, extensions
AS $$
  SELECT coalesce(json_agg(to_json(t)), '[]'::json)
  FROM (
    SELECT id, kind, file_path, filename, reason, account_id, source_message_id,
           from_email, subject, received_at, status, matched_document_id, created_at
    FROM public.purchase_dte_review_queue
    WHERE (p_status IS NULL OR status = p_status)
    ORDER BY created_at DESC
  ) t;
$$;

REVOKE EXECUTE ON FUNCTION public.get_purchase_dte_review_queue(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_purchase_dte_review_queue(text) TO authenticated, service_role;

-- Match manual de proveedor (botón "Emparejar" en filas sin supplier_id).
CREATE FUNCTION public.set_purchase_dte_supplier(p_document_id bigint, p_supplier_id bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF NOT (SELECT auth_can_edit_any(ARRAY['facturas_compra'])) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;
  UPDATE public.purchase_dte_documents SET supplier_id = p_supplier_id WHERE id = p_document_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_purchase_dte_supplier(bigint, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_purchase_dte_supplier(bigint, bigint) TO authenticated, service_role;

-- Resolución de la cola de revisión: descartar, o emparejar un PDF huérfano a un
-- documento ya existente (adjunta pdf_path si ese documento no tenía).
CREATE FUNCTION public.resolve_purchase_dte_review(
    p_review_id bigint,
    p_action text,
    p_matched_document_id bigint DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
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
    UPDATE public.purchase_dte_review_queue
      SET status = 'emparejado', matched_document_id = p_matched_document_id,
          resolved_by = auth_employee_id(), resolved_at = now()
      WHERE id = p_review_id;
    UPDATE public.purchase_dte_documents d
      SET pdf_path = rq.file_path
      FROM public.purchase_dte_review_queue rq
      WHERE d.id = p_matched_document_id AND rq.id = p_review_id AND d.pdf_path IS NULL;
  ELSE
    UPDATE public.purchase_dte_review_queue
      SET status = 'descartado', resolved_by = auth_employee_id(), resolved_at = now()
      WHERE id = p_review_id;
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.resolve_purchase_dte_review(bigint, text, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_purchase_dte_review(bigint, text, bigint) TO authenticated, service_role;
