SET lock_timeout = '5s';

-- Fase 1.1.c de la auditoría MinMax 2026-07-17: approve_minmax_request escribía el valor
-- absoluto solicitado en manual_min/manual_max (semántica de reemplazo), pero
-- get_stock_analysis interpreta manual_* como delta aditivo (min_units + manual_min) desde
-- la migración 20260619_bodega_manual_additive_model.sql. Resultado: aprobar una solicitud
-- inflaba el efectivo mostrado en MinMax (publicado + solicitado) mientras Pedidos usaba el
-- valor de la solicitud como reemplazo — nadie veía lo mismo. Fix: escribe min_units/max_units
-- directo (igual que "se aplicarán en vivo" dice la UI), limpia manual_*, deja snapshot en
-- product_stock_params_history. manual_* queda EXCLUSIVO de Bodega (delta aditivo real, id=6);
-- las solicitudes nunca deberían targetear Bodega (su MIN/MAX lo deriva trg_bodega_draft_sync),
-- así que se bloquea explícito en vez de corromper el modelo aditivo de Bodega.
CREATE OR REPLACE FUNCTION public.approve_minmax_request(p_request_id bigint, p_decided_by text DEFAULT NULL::text, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  r public.minmax_change_requests%ROWTYPE;
  v_now timestamptz := now();
  v_publisher text := (SELECT auth.email());
BEGIN
  UPDATE public.minmax_change_requests
  SET status='approved', decided_by=p_decided_by, decided_at=v_now, decision_note=p_note
  WHERE id = p_request_id AND status = 'pending'
  RETURNING * INTO r;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'REQUEST_NOT_FOUND_OR_NO_PERMISSION';
  END IF;

  IF r.erp_sucursal_id = 6 THEN
    RAISE EXCEPTION 'BODEGA_NOT_APPROVABLE_HERE: Bodega deriva su MIN/MAX de la suma de sucursales (trg_bodega_draft_sync), no admite solicitudes directas';
  END IF;

  INSERT INTO public.product_stock_params (
    erp_product_id, erp_sucursal_id,
    min_units, max_units,
    manual_min, manual_max,
    published_at, published_by, updated_at
  )
  VALUES (
    r.erp_product_id, r.erp_sucursal_id,
    r.requested_min, r.requested_max,
    NULL, NULL,
    v_now, v_publisher, v_now
  )
  ON CONFLICT (erp_product_id, erp_sucursal_id) DO UPDATE SET
    min_units    = EXCLUDED.min_units,
    max_units    = EXCLUDED.max_units,
    manual_min   = NULL,
    manual_max   = NULL,
    published_at = EXCLUDED.published_at,
    published_by = EXCLUDED.published_by,
    updated_at   = EXCLUDED.updated_at
  WHERE product_stock_params.is_hidden IS NOT TRUE;

  INSERT INTO public.product_stock_params_history (
    erp_product_id, erp_sucursal_id, captured_at, min_units, max_units
  ) VALUES (
    r.erp_product_id, r.erp_sucursal_id, v_now, r.requested_min, r.requested_max
  );

  RETURN jsonb_build_object(
    'ok', true,
    'erp_product_id', r.erp_product_id,
    'erp_sucursal_id', r.erp_sucursal_id,
    'requested_by_id', r.requested_by_id,
    'product_name', r.product_name,
    'requested_min', r.requested_min,
    'requested_max', r.requested_max
  );
END;
$function$;
