SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.get_purchase_dte_review_queue(p_status text DEFAULT 'pendiente'::text)
 RETURNS json
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT coalesce(json_agg(to_json(t)), '[]'::json)
  FROM (
    SELECT id, kind, file_path, filename, reason, account_id, source_message_id,
           from_email, subject, received_at, status, matched_document_id, ai_suggested, created_at
    FROM public.purchase_dte_review_queue
    WHERE (p_status IS NULL OR status = p_status)
    ORDER BY created_at DESC
  ) t;
$function$;
