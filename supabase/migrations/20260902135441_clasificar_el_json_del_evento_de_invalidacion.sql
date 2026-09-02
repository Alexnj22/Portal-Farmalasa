SET lock_timeout = '5s';

-- El JSON del evento de invalidación era un callejón sin salida.
--
-- `classify_purchase_dte_review` exigía `kind = 'orphan_pdf'`, así que para una
-- fila `invalidacion_pendiente` la única acción disponible en pantalla era
-- **Descartar** — y esa fila es el JSON del evento, que trae su propio sello de
-- recepción del MH («Invalidación Recibida y Procesada»). O sea: la prueba
-- legal de que el proveedor anuló el documento sólo se podía tirar.
--
-- Medido el 2026-09-02 con las cinco anulaciones de agosto: dos de ellas
-- (Farquisal 12-ago, Brandstar 27-ago) mandaron ese JSON, las dos quedaron
-- `invalidacion_pendiente` porque el CCF original entró a la base DESPUÉS del
-- aviso —0.77 s y 25 s, en la misma corrida— y ninguna se podía resolver.
CREATE OR REPLACE FUNCTION public.classify_purchase_dte_review(
  p_review_id bigint, p_document_id bigint, p_tipo text, p_motivo text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  IF NOT (SELECT auth_can_edit_any(ARRAY['facturas_compra'])) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;
  IF p_tipo NOT IN ('anulacion', 'otro') THEN
    RAISE EXCEPTION 'tipo inválido: %', p_tipo;
  END IF;
  -- `invalid_json` y `orphan_zip` siguen fuera a propósito: son archivos que
  -- no se pudieron entender, no evidencia sobre un documento concreto.
  IF NOT EXISTS (
    SELECT 1 FROM public.purchase_dte_review_queue
    WHERE id = p_review_id
      AND kind IN ('orphan_pdf', 'invalidacion_pendiente')
      AND status = 'pendiente'
  ) THEN
    RAISE EXCEPTION 'solo se puede clasificar una fila kind=orphan_pdf o invalidacion_pendiente pendiente';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.purchase_dte_documents WHERE id = p_document_id) THEN
    RAISE EXCEPTION 'documento % no existe', p_document_id;
  END IF;

  IF p_tipo = 'anulacion' THEN
    UPDATE public.purchase_dte_documents SET
      invalidado        = true,
      invalidado_motivo = coalesce(nullif(p_motivo, ''), 'Anulación detectada en el aviso del proveedor (Revisión)'),
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

-- Devuelve `kind` para que el visor pueda decir QUÉ es cada respaldo: un
-- documento anulado puede tener dos —el PDF con el sello y el JSON del evento
-- con su sello del MH— y ofrecerlos con el mismo rótulo los vuelve
-- indistinguibles. Se mantiene `LANGUAGE sql` (una búsqueda por índice sobre
-- `matched_document_id`: el plan bueno no depende del valor del argumento, así
-- que no es el caso de la regla de planes genéricos).
CREATE OR REPLACE FUNCTION public.get_purchase_dte_review_source(p_document_id bigint)
 RETURNS json
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT coalesce(json_agg(to_json(t)), '[]'::json)
  FROM (
    SELECT id, kind, file_path, filename, subject, from_email, received_at, resolved_at
    FROM public.purchase_dte_review_queue
    WHERE matched_document_id = p_document_id AND status = 'emparejado'
    -- El PDF antes que el JSON: el visor toma el primero para el botón
    -- principal y lo que la gente quiere ver es la hoja con el sello.
    ORDER BY (kind = 'orphan_pdf') DESC, resolved_at DESC
  ) t;
$function$;

REVOKE EXECUTE ON FUNCTION public.classify_purchase_dte_review(bigint, bigint, text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.classify_purchase_dte_review(bigint, bigint, text, text) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.get_purchase_dte_review_source(bigint) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_purchase_dte_review_source(bigint) TO authenticated, service_role;
