-- Hueco encontrado el 2026-08-21 al preguntar «¿el ajuste puede venir de MIN·MAX
-- y también de una solicitud?». Sí puede — y sólo uno de los dos quedaba
-- protegido.
--
-- El trigger de la fase 2 distingue a la persona del proceso por una firma:
-- publicar reescribe `published_at` en el mismo UPDATE, una edición de celda no.
-- Resulta que OTRAS DOS operaciones también escriben `published_at`, y las dos
-- son decisiones humanas:
--
--   · `approve_minmax_request` — el número que pidió la sala y aprobó
--     supervisión quedaba sin marca, así que el siguiente recálculo se lo
--     llevaba puesto. Es el mismo problema que motivó todo el plan, entrando
--     por la puerta de al lado.
--   · `zero_out_product_all_branches` — retirar un producto de TODAS las salas
--     es la decisión más fuerte del módulo, y podía revertirse sola al mes.
--
-- Las dos pasan a dejar `manual_at`/`manual_por`. La solicitud además conserva
-- su `reason` en `manual_nota`: es el porqué que la persona YA escribió (16 de
-- 17 solicitudes lo traen) y hasta hoy se perdía al aprobar.
--
-- A ninguna se le INVENTA un motivo de la lista. Poner 0 en toda la red se
-- parece mucho a «ya no rota», y precisamente por eso no se infiere: el cálculo
-- sólo actúa sobre motivos que alguien declaró.
--
-- Probado en staging: solicitud aprobada queda marcada, su razón se conserva, y
-- el upsert del cero en red marca las 7 filas.
--
-- Los cuerpos completos vivos se leen con:
--   SELECT pg_get_functiondef('public.approve_minmax_request(bigint,text,text)'::regprocedure);
--   SELECT pg_get_functiondef('public.zero_out_product_all_branches(integer,text)'::regprocedure);

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
  v_prev_min integer;
  v_prev_max integer;
BEGIN
  -- p_decided_by se recibe y se IGNORA (F4.2).
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

  SELECT is_hidden,
         public.minmax_eff_min(min_units, max_units, manual_min, manual_max),
         public.minmax_eff_max(min_units, max_units, manual_min, manual_max)
    INTO v_is_hidden, v_prev_min, v_prev_max
  FROM public.product_stock_params
  WHERE erp_product_id = r.erp_product_id AND erp_sucursal_id = r.erp_sucursal_id;

  IF v_is_hidden IS TRUE THEN
    RAISE EXCEPTION 'PRODUCT_HIDDEN: el producto está oculto en Min/Max — quitale el ocultamiento antes de aprobar esta solicitud';
  END IF;

  INSERT INTO public.product_stock_params (
    erp_product_id, erp_sucursal_id,
    min_units, max_units,
    manual_min, manual_max,
    manual_at, manual_por, manual_nota,
    published_at, published_by, updated_at
  )
  VALUES (
    r.erp_product_id, r.erp_sucursal_id,
    r.requested_min, r.requested_max,
    NULL, NULL,
    -- Una solicitud aprobada ES un ajuste de una persona, y hasta hoy no lo
    -- parecía: escribe `published_at` en el mismo UPDATE, que es justo la firma
    -- con la que el trigger distingue una publicación de una edición.
    --
    -- El `reason` pasa a la nota: es el porqué que la persona ya escribió. NO se
    -- le inventa un motivo de la lista — son texto libre, y clasificarlos a
    -- máquina sería ponerle al cálculo una intención que nadie declaró.
    v_now, v_publisher, r.reason,
    v_now, v_publisher, v_now
  )
  ON CONFLICT (erp_product_id, erp_sucursal_id) DO UPDATE SET
    min_units    = EXCLUDED.min_units,
    max_units    = EXCLUDED.max_units,
    manual_min   = NULL,
    manual_max   = NULL,
    manual_at    = EXCLUDED.manual_at,
    manual_por   = EXCLUDED.manual_por,
    manual_nota  = EXCLUDED.manual_nota,
    published_at = EXCLUDED.published_at,
    published_by = EXCLUDED.published_by,
    updated_at   = EXCLUDED.updated_at;

  RETURN jsonb_build_object(
    'ok', true,
    'erp_product_id', r.erp_product_id,
    'erp_sucursal_id', r.erp_sucursal_id,
    'requested_by_id', r.requested_by_id,
    'requested_by_name', r.requested_by_name,
    'product_name', r.product_name,
    'requested_min', r.requested_min,
    'requested_max', r.requested_max,
    'previous_min', v_prev_min,
    'previous_max', v_prev_max
  );
END;
$function$;

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

  IF NOT (SELECT public.auth_can_edit_scope_all(ARRAY['minmax','pedidos'])) THEN
    RAISE EXCEPTION 'BRANCH_SCOPE_DENIED: retirar un producto de TODAS las salas requiere alcance total';
  END IF;

  INSERT INTO product_stock_params (
    erp_product_id, erp_sucursal_id,
    min_units, max_units,
    draft_min, draft_max, draft_status,
    manual_min, manual_max,
    manual_at, manual_por,
    published_at, published_by, updated_at
  )
  SELECT
    p_erp_product_id,
    m.erp_sucursal_id,
    0, 0,
    NULL, NULL, 'none',
    NULL, NULL,
    -- Retirar un producto de TODAS las salas es la decisión humana más fuerte
    -- de este módulo, y también escribía `published_at`: quedaba sin marca y el
    -- recálculo podía devolverle un MIN/MAX al mes siguiente.
    --
    -- Queda marcado pero SIN motivo: poner 0 en toda la red se parece mucho a
    -- «ya no rota», y precisamente por eso no se infiere. El cálculo sólo actúa
    -- sobre motivos que alguien declaró.
    v_now, v_publisher,
    v_now, v_publisher, v_now
  FROM erp_sucursal_map m
  ON CONFLICT (erp_product_id, erp_sucursal_id) DO UPDATE SET
    min_units    = 0,
    max_units    = 0,
    draft_min    = NULL,
    draft_max    = NULL,
    draft_status = 'none',
    manual_min   = NULL,
    manual_max   = NULL,
    manual_at    = v_now,
    manual_por   = v_publisher,
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
