-- Fase 3.2 (PLAN-MEJORAS-DTE-PROVEEDORES-2026-07.md): acción manual
-- "Adjuntar JSON" — cuando un doc "confirmado sin JSON" (solo PDF) y un doc
-- duplicado con JSON completo (llegó por su cuenta vía sync normal) resultan
-- ser el mismo DTE, el usuario los fusiona explícitamente en vez de un match
-- automático (rechazado: las filas "sin JSON" no guardan numero_control/
-- monto/fecha/NIT, ningún campo confiable para matchear sin intervención
-- humana).
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.merge_purchase_dte_documents(
    p_target_id bigint,
    p_source_id bigint
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
  v_target public.purchase_dte_documents;
  v_source public.purchase_dte_documents;
BEGIN
  IF NOT (SELECT auth_can_edit_any(ARRAY['facturas_compra'])) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;
  IF p_target_id = p_source_id THEN
    RAISE EXCEPTION 'el documento destino y origen no pueden ser el mismo';
  END IF;

  SELECT * INTO v_target FROM public.purchase_dte_documents WHERE id = p_target_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'documento destino % no existe', p_target_id;
  END IF;
  IF v_target.codigo_generacion IS NOT NULL OR v_target.json_path IS NOT NULL THEN
    RAISE EXCEPTION 'el documento destino ya tiene JSON — no aplica "Adjuntar JSON"';
  END IF;

  SELECT * INTO v_source FROM public.purchase_dte_documents WHERE id = p_source_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'documento origen % no existe', p_source_id;
  END IF;
  IF v_source.codigo_generacion IS NULL OR v_source.json_path IS NULL THEN
    RAISE EXCEPTION 'el documento origen no tiene un JSON completo';
  END IF;

  -- NC/ND que apuntaban al origen (ahora se va a borrar) pasan a apuntar al destino.
  UPDATE public.purchase_dte_documents
    SET documento_relacionado_id = p_target_id
    WHERE documento_relacionado_id = p_source_id;

  -- Se borra el origen ANTES de copiar codigo_generacion al destino — la
  -- UNIQUE de codigo_generacion no es diferible, así que setearlo en destino
  -- mientras el origen todavía lo tiene falla con violación de unicidad.
  DELETE FROM public.purchase_dte_documents WHERE id = p_source_id;

  UPDATE public.purchase_dte_documents SET
    codigo_generacion         = v_source.codigo_generacion,
    tipo_dte                  = v_source.tipo_dte,
    numero_control             = v_source.numero_control,
    emisor_nit                 = v_source.emisor_nit,
    emisor_nrc                 = v_source.emisor_nrc,
    emisor_nombre               = v_source.emisor_nombre,
    fecha_emision               = v_source.fecha_emision,
    monto_total                 = v_source.monto_total,
    total_iva                   = v_source.total_iva,
    json_path                   = v_source.json_path,
    orig_json_path               = v_source.orig_json_path,
    sello_recibido               = v_source.sello_recibido,
    items_text                   = v_source.items_text,
    pdf_path                     = coalesce(v_target.pdf_path, v_source.pdf_path),
    supplier_id                  = coalesce(v_target.supplier_id, v_source.supplier_id),
    proveedor_id                 = coalesce(v_target.proveedor_id, v_source.proveedor_id),
    invalidado                   = v_source.invalidado,
    invalidado_motivo             = v_source.invalidado_motivo,
    invalidado_at                 = v_source.invalidado_at,
    documento_relacionado_id      = coalesce(v_target.documento_relacionado_id, v_source.documento_relacionado_id)
  WHERE id = p_target_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.merge_purchase_dte_documents(bigint, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.merge_purchase_dte_documents(bigint, bigint) TO authenticated, service_role;
