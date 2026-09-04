SET lock_timeout = '5s';

-- La aprobación SELLA la fila con su solicitud.
CREATE OR REPLACE FUNCTION public.approve_minmax_request(
  p_request_id bigint, p_decided_by text DEFAULT NULL::text, p_note text DEFAULT NULL::text)
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
    ajuste_solicitud_id,
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
    -- El sello: ESTO es lo que frena al recálculo del mes que viene, y no la
    -- mera existencia de `manual_at`. Una edición a mano durante la revisión
    -- del mes no deja este número, así que no frena nada.
    r.id,
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
    ajuste_solicitud_id = EXCLUDED.ajuste_solicitud_id,
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

-- Y la edición a mano LO ROMPE: si alguien vuelve a mover el número, el par
-- vigente ya no es el que se aprobó, así que el sello de la solicitud no puede
-- seguir protegiéndolo.
CREATE OR REPLACE FUNCTION public.marcar_ajuste_manual_minmax()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_cambio_numero  boolean := NEW.min_units     IS DISTINCT FROM OLD.min_units
                           OR NEW.max_units     IS DISTINCT FROM OLD.max_units;
  v_cambio_motivo  boolean := NEW.manual_motivo IS DISTINCT FROM OLD.manual_motivo;
BEGIN
  -- «Ya no rota» es el único motivo que BORRA historial de demanda: le dice al
  -- cálculo que deje de contar todo lo vendido antes de hoy. No puede quedar a
  -- un clic de distancia de cualquiera que edite una celda, así que pide el
  -- mismo alcance que ya distingue a supervisión de una sala.
  IF v_cambio_motivo AND NEW.manual_motivo = 'ya_no_rota'
     AND auth.uid() IS NOT NULL
     AND NOT (SELECT public.auth_can_edit_scope_all(ARRAY['minmax','pedidos'])) THEN
    RAISE EXCEPTION 'MOTIVO_DENEGADO: «ya no rota» sólo lo puede poner quien decide sobre todas las salas';
  END IF;

  -- Quién NO es una persona ajustando a mano:
  --
  -- 1. El recálculo y el auto-aplicar corren con service_role desde la edge
  --    function: ahí `auth.uid()` es NULL.
  -- 2. Publicar un borrador SÍ corre con la sesión de quien publica
  --    (publish_stock_params es SECURITY DEFINER pero la invoca el navegador),
  --    así que `auth.uid()` no alcanza para distinguirlo. Lo que sí lo
  --    distingue es que publicar SIEMPRE reescribe `published_at` en el mismo
  --    UPDATE — es su firma, y no la comparte ninguna edición de celda.
  IF auth.uid() IS NOT NULL
     AND NEW.published_at IS NOT DISTINCT FROM OLD.published_at THEN
    -- Declarar el motivo TAMBIÉN es ajustar: alguien puede marcar «ya no rota»
    -- sin tocar el número, y sin `manual_at` ese motivo no tendría fecha de
    -- corte —que es justo el dato del que depende— ni pasaría su propio CHECK.
    IF v_cambio_numero OR (v_cambio_motivo AND NEW.manual_motivo IS NOT NULL) THEN
      NEW.manual_at  := now();
      NEW.manual_por := coalesce(auth.email(), auth.uid()::text);
      -- El sello de la solicitud vale para el par que se aprobó. Si el número
      -- se movió y quien escribe no trajo un sello propio, se limpia: si no,
      -- una edición cualquiera heredaría la protección de una decisión que ya
      -- no describe este número.
      IF v_cambio_numero AND NEW.ajuste_solicitud_id IS NOT DISTINCT FROM OLD.ajuste_solicitud_id THEN
        NEW.ajuste_solicitud_id := NULL;
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;
