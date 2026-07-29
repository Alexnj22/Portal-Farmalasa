-- F4.2 — La autoria nunca la manda el cliente.
--
-- `decided_by` en approve_minmax_request / reject_minmax_request venia del
-- parametro p_decided_by, que llena el navegador (TabMinMaxRequests pasa
-- `user?.email`). Cualquiera puede llamar la RPC por PostgREST con el correo de
-- otra persona y firmar la aprobacion a su nombre. `published_by`, en la misma
-- tabla, ya se resolvia server-side con auth.email() — o sea que el modulo tenia
-- las dos formas conviviendo.
--
-- Ahora las dos salen de (SELECT auth.email()).
--
-- El parametro p_decided_by NO se elimina todavia, a proposito: si se cambia la
-- firma antes de que el frontend deje de mandarlo, PostgREST no encuentra la
-- funcion y la aprobacion se rompe entre el deploy de BD y el de Vercel. Queda
-- recibido-e-ignorado, con el comentario puesto; el cliente deja de mandarlo en
-- este mismo commit y la firma se puede limpiar en una migracion posterior.
-- Lo mismo aplica a p_published_by de publish_stock_params y de
-- zero_out_product_all_branches (esa ya usaba auth.email(), el parametro estaba
-- muerto desde antes).
--
-- Y zero_out_product_all_branches deja de hardcodear `VALUES (1),(2)…(7)`: lee
-- erp_sucursal_map, que es la fuente de verdad (hoy da exactamente 1-7, con el 6
-- marcado como bodega). Con el hardcode, agregar una sucursal al mapa dejaba un
-- producto retirado "en todas las salas" menos en la nueva, sin aviso.

SET lock_timeout = '5s';

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
  -- p_decided_by se recibe y se IGNORA (F4.2): la autoria sale del token, no del
  -- cliente. El parametro sigue en la firma solo para no romper al frontend
  -- viejo entre deploys.
  UPDATE public.minmax_change_requests
  SET status='approved', decided_by=v_publisher, decided_at=v_now, decision_note=p_note
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

REVOKE EXECUTE ON FUNCTION public.approve_minmax_request(bigint, text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.approve_minmax_request(bigint, text, text) TO authenticated, service_role;


CREATE OR REPLACE FUNCTION public.reject_minmax_request(p_request_id bigint, p_decided_by text DEFAULT NULL::text, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE r public.minmax_change_requests%ROWTYPE;
BEGIN
  -- p_decided_by se recibe y se IGNORA (F4.2).
  UPDATE public.minmax_change_requests
  SET status='rejected', decided_by=(SELECT auth.email()), decided_at=now(), decision_note=p_note
  WHERE id = p_request_id AND status = 'pending'
  RETURNING * INTO r;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'REQUEST_NOT_FOUND_OR_NO_PERMISSION';
  END IF;

  RETURN jsonb_build_object('ok', true, 'requested_by_id', r.requested_by_id, 'product_name', r.product_name);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.reject_minmax_request(bigint, text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.reject_minmax_request(bigint, text, text) TO authenticated, service_role;


CREATE OR REPLACE FUNCTION public.zero_out_product_all_branches(p_erp_product_id integer, p_published_by text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_now       TIMESTAMPTZ := NOW();
  v_count     INTEGER;
  v_publisher TEXT := (SELECT auth.email());
BEGIN
  IF NOT auth_can_edit_any(ARRAY['minmax']) THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: se requiere permiso de edición en Min/Max';
  END IF;

  -- F4.1: escribe TODAS las sucursales, asi que exige alcance total. Inerte hoy
  -- (los 6 roles con can_edit en minmax resuelven a ALL), pero esta funcion es
  -- SECURITY DEFINER y saltea las policies.
  IF NOT (SELECT public.auth_can_edit_scope_all(ARRAY['minmax','pedidos'])) THEN
    RAISE EXCEPTION 'BRANCH_SCOPE_DENIED: retirar un producto de TODAS las salas requiere alcance total';
  END IF;

  INSERT INTO product_stock_params (
    erp_product_id, erp_sucursal_id,
    min_units, max_units,
    draft_min, draft_max, draft_status,
    manual_min, manual_max,
    published_at, published_by, updated_at
  )
  SELECT
    p_erp_product_id,
    m.erp_sucursal_id,
    0, 0,
    NULL, NULL, 'none',
    NULL, NULL,
    v_now, v_publisher, v_now
  -- F4.2: antes era `FROM (VALUES (1),(2),(3),(4),(5),(6),(7))`. erp_sucursal_map
  -- es la fuente de verdad; con el hardcode, sumar una sucursal al mapa dejaba el
  -- producto retirado "en todas las salas" menos en la nueva, en silencio.
  FROM erp_sucursal_map m
  ON CONFLICT (erp_product_id, erp_sucursal_id) DO UPDATE SET
    min_units    = 0,
    max_units    = 0,
    draft_min    = NULL,
    draft_max    = NULL,
    draft_status = 'none',
    manual_min   = NULL,
    manual_max   = NULL,
    published_at = v_now,
    published_by = v_publisher,
    updated_at   = v_now
  WHERE product_stock_params.is_hidden IS NOT TRUE;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN jsonb_build_object(
    'ok',      true,
    'updated', v_count,
    'at',      v_now
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.zero_out_product_all_branches(integer, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.zero_out_product_all_branches(integer, text) TO authenticated, service_role;
