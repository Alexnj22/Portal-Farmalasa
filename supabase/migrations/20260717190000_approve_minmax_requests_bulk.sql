SET lock_timeout = '5s';

-- Mejora M7 (aprobada) de la auditoría MinMax 2026-07-17: aprobación masiva
-- pasa de N llamadas seriadas a approve_minmax_request (una por solicitud,
-- con N notificaciones y N audit logs, y si fallaba a mitad quedaba en estado
-- parcial) a UNA sola transacción atómica. Bodega (erp_sucursal_id=6) se omite
-- del batch en vez de abortar todo (misma razón que approve_minmax_request:
-- Bodega deriva su MIN/MAX de trg_bodega_draft_sync, no admite solicitudes
-- directas) — se reporta en skipped_bodega para que el caller avise al usuario.
-- Solicitudes que ya no están 'pending' (decididas por otra persona mientras
-- tanto) se reportan en skipped_not_found en vez de abortar el batch entero.
-- Misma semántica que approve_minmax_request v2 (Fase 1): escribe
-- min_units/max_units directo, limpia manual_*, snapshot a history.
-- SECURITY INVOKER (igual que approve_minmax_request) — la RLS de
-- minmax_change_requests/product_stock_params ya exige can_approve/can_edit.
--
-- Probado en staging (ewcmerxqjvludtgskuin) con 5 casos: 2 aprobaciones
-- normales, 1 Bodega (correctamente omitida y sigue pending), 1 ya decidida
-- y 1 id inexistente (ambas en skipped_not_found). Todos pasaron.
CREATE OR REPLACE FUNCTION public.approve_minmax_requests_bulk(p_request_ids bigint[], p_decided_by text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_now       timestamptz := now();
  v_publisher text := (SELECT auth.email());
  v_result    jsonb;
BEGIN
  WITH targets AS (
    SELECT r.* FROM minmax_change_requests r
    WHERE r.id = ANY(p_request_ids) AND r.status = 'pending'
  ),
  valid_targets AS (
    SELECT * FROM targets WHERE erp_sucursal_id != 6
  ),
  bodega_targets AS (
    SELECT * FROM targets WHERE erp_sucursal_id = 6
  ),
  updated_requests AS (
    UPDATE minmax_change_requests
    SET status = 'approved', decided_by = p_decided_by, decided_at = v_now,
        decision_note = 'Aprobación masiva'
    WHERE id IN (SELECT id FROM valid_targets)
    RETURNING id, erp_product_id, erp_sucursal_id, requested_by_id, product_name, requested_min, requested_max
  ),
  applied_params AS (
    INSERT INTO product_stock_params (
      erp_product_id, erp_sucursal_id, min_units, max_units, manual_min, manual_max,
      published_at, published_by, updated_at
    )
    SELECT erp_product_id, erp_sucursal_id, requested_min, requested_max, NULL, NULL, v_now, v_publisher, v_now
    FROM updated_requests
    ON CONFLICT (erp_product_id, erp_sucursal_id) DO UPDATE SET
      min_units    = EXCLUDED.min_units,
      max_units    = EXCLUDED.max_units,
      manual_min   = NULL,
      manual_max   = NULL,
      published_at = EXCLUDED.published_at,
      published_by = EXCLUDED.published_by,
      updated_at   = EXCLUDED.updated_at
    WHERE product_stock_params.is_hidden IS NOT TRUE
    RETURNING erp_product_id
  ),
  history_insert AS (
    INSERT INTO product_stock_params_history (erp_product_id, erp_sucursal_id, captured_at, min_units, max_units)
    SELECT erp_product_id, erp_sucursal_id, v_now, requested_min, requested_max
    FROM updated_requests
    RETURNING erp_product_id
  ),
  not_found AS (
    SELECT rid FROM unnest(p_request_ids) rid
    WHERE rid NOT IN (SELECT id FROM targets)
  )
  SELECT jsonb_build_object(
    'ok', true,
    'approved', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', id, 'erp_product_id', erp_product_id, 'erp_sucursal_id', erp_sucursal_id,
        'requested_by_id', requested_by_id, 'product_name', product_name,
        'requested_min', requested_min, 'requested_max', requested_max
      )) FROM updated_requests), '[]'::jsonb),
    'applied_count', (SELECT count(*) FROM applied_params),
    'history_count', (SELECT count(*) FROM history_insert),
    'skipped_bodega', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', id, 'product_name', product_name))
      FROM bodega_targets), '[]'::jsonb),
    'skipped_not_found', COALESCE((SELECT jsonb_agg(rid) FROM not_found), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$function$;
