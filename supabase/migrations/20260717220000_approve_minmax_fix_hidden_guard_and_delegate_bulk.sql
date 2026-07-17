SET lock_timeout = '5s';

-- Hallazgos del /code-review de cierre de la auditoría MinMax 2026-07-17:
--
-- 1. BUG REAL (correctness): approve_minmax_request tenía
--    "ON CONFLICT DO UPDATE ... WHERE is_hidden IS NOT TRUE" — si el producto
--    estaba oculto, el UPDATE se saltaba EN SILENCIO pero la función igual
--    marcaba la solicitud 'approved', insertaba snapshot a history, y
--    devolvía ok:true. El supervisor y el empleado creían que el ajuste se
--    aplicó cuando en realidad product_stock_params no cambió. Fix: valida
--    is_hidden ANTES de escribir y aborta con excepción clara en vez de
--    fallar en silencio (mismo patrón que el guard de Bodega ya existente).
--    Se quita el WHERE redundante del ON CONFLICT (ya no puede dispararse).
--
-- 2. DUPLICACIÓN (altitud): approve_minmax_requests_bulk reimplementaba todo
--    el bloque de escritura de approve_minmax_request. Ahora delega en loop
--    (con manejo de excepción por item vía savepoint implícito de plpgsql)
--    — un solo punto de verdad para "cómo se aplica una aprobación", y de
--    paso hereda automáticamente el fix del bug #1 sin duplicar el fix.
--
-- 3. reject_minmax_request quedó fuera de la migración 20260717200000 que
--    revocó anon de las otras 3 funciones del mismo feature — corregido acá.
--
-- Probado en staging (ewcmerxqjvludtgskuin) con 6 casos: 2 aprobaciones
-- normales, 1 Bodega, 1 ya decidida, 1 id inexistente, y el caso nuevo:
-- 1 producto oculto (RAISE PRODUCT_HIDDEN, la solicitud queda 'pending' sin
-- consumirse — transacción revertida correctamente). Re-verificado igual en
-- prod antes de limpiar.
CREATE OR REPLACE FUNCTION public.approve_minmax_request(p_request_id bigint, p_decided_by text DEFAULT NULL::text, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  r public.minmax_change_requests%ROWTYPE;
  v_now timestamptz := now();
  v_publisher text := (SELECT auth.email());
  v_is_hidden boolean;
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

  SELECT is_hidden INTO v_is_hidden
  FROM public.product_stock_params
  WHERE erp_product_id = r.erp_product_id AND erp_sucursal_id = r.erp_sucursal_id;

  IF v_is_hidden IS TRUE THEN
    RAISE EXCEPTION 'PRODUCT_HIDDEN: el producto está oculto en Min/Max — quitale el ocultamiento antes de aprobar esta solicitud';
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
    updated_at   = EXCLUDED.updated_at;

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

CREATE OR REPLACE FUNCTION public.approve_minmax_requests_bulk(p_request_ids bigint[], p_decided_by text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_id bigint;
  v_result jsonb;
  v_approved jsonb := '[]'::jsonb;
  v_skipped_bodega jsonb := '[]'::jsonb;
  v_skipped_hidden jsonb := '[]'::jsonb;
  v_skipped_not_found jsonb := '[]'::jsonb;
BEGIN
  FOREACH v_id IN ARRAY p_request_ids LOOP
    BEGIN
      v_result := approve_minmax_request(v_id, p_decided_by, 'Aprobación masiva') || jsonb_build_object('id', v_id);
      v_approved := v_approved || jsonb_build_array(v_result);
    EXCEPTION
      WHEN OTHERS THEN
        IF SQLERRM LIKE 'BODEGA_NOT_APPROVABLE_HERE%' THEN
          v_skipped_bodega := v_skipped_bodega || jsonb_build_array(jsonb_build_object('id', v_id));
        ELSIF SQLERRM LIKE 'PRODUCT_HIDDEN%' THEN
          v_skipped_hidden := v_skipped_hidden || jsonb_build_array(jsonb_build_object('id', v_id));
        ELSE
          v_skipped_not_found := v_skipped_not_found || jsonb_build_array(v_id);
        END IF;
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'approved', v_approved,
    'skipped_bodega', v_skipped_bodega,
    'skipped_hidden', v_skipped_hidden,
    'skipped_not_found', v_skipped_not_found
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.reject_minmax_request(bigint, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reject_minmax_request(bigint, text, text) TO authenticated, service_role;
