SET lock_timeout = '5s';

-- Plan de alcance por sucursal, F2 (2026-10-02). Decisión del usuario: los
-- pedidos los crea y despacha Bodega; la sala sólo recibe lo suyo. Hasta hoy
-- estas cuatro funciones sólo pedían `pedidos.can_edit`, que tienen 34 personas
-- de sala con alcance de UNA sala, y ninguna miraba la sala. Medido antes de
-- cerrarlo (90 días): los pasos de Bodega los hicieron sólo cargos de red, y los
-- de sala, siempre en su propia sala — o sea que esto no le quita nada a nadie.
-- "Alcance de red" = `auth_can_edit_scope_all(ARRAY['pedidos'])`, el mismo
-- ayudante que usan discard_stock_drafts y publish_stock_params; la sala de
-- quien llama, en ids del origen, es `auth_employee_erp_sucursal_id()`.

CREATE OR REPLACE FUNCTION public.confirm_pedido(p_created_by uuid, p_notes text, p_items jsonb, p_responsable_id uuid DEFAULT NULL::uuid, p_revisado_por uuid DEFAULT NULL::uuid, p_sucursal_ids integer[] DEFAULT NULL::integer[])
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_pedido_id uuid;
  v_item      jsonb;
  v_qty       integer;
  v_suc_valid boolean;
  v_actor     uuid := auth_employee_id();
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED';
  END IF;
  IF NOT auth_can_edit_any(ARRAY['pedidos']) THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: se requiere permiso de edición en Pedidos';
  END IF;
  -- Crear un pedido es de Bodega (decisión 2026-10-02).
  IF NOT (SELECT public.auth_can_edit_scope_all(ARRAY['pedidos'])) THEN
    RAISE EXCEPTION 'BRANCH_SCOPE_DENIED: crear un pedido es de Bodega';
  END IF;

  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'El pedido debe tener al menos un ítem.';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_qty := COALESCE((v_item->>'cantidad_asignada')::integer, 0);
    IF v_qty < 0 THEN
      RAISE EXCEPTION 'cantidad_asignada no puede ser negativa (product_id=%).', v_item->>'erp_product_id';
    END IF;
    SELECT EXISTS (
      SELECT 1 FROM erp_sucursal_map
      WHERE erp_sucursal_id = (v_item->>'erp_sucursal_id')::integer
    ) INTO v_suc_valid;
    IF NOT v_suc_valid THEN
      RAISE EXCEPTION 'erp_sucursal_id % no existe.', v_item->>'erp_sucursal_id';
    END IF;
  END LOOP;

  -- responsable_id/revisado_por: la única lógica cliente real hoy es
  -- "self o null" (esEmpleado ? user.id : null / siempre null) — se preserva
  -- ese comportamiento exacto pero resuelto server-side, sin aceptar un uuid
  -- de tercero.
  INSERT INTO pedidos (created_by, notes, responsable_id, revisado_por, sucursal_ids)
  VALUES (
    v_actor,
    p_notes,
    CASE WHEN p_responsable_id IS NOT NULL THEN v_actor ELSE NULL END,
    CASE WHEN p_revisado_por   IS NOT NULL THEN v_actor ELSE NULL END,
    p_sucursal_ids
  )
  RETURNING id INTO v_pedido_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_qty := COALESCE((v_item->>'cantidad_asignada')::integer, 0);
    INSERT INTO pedido_items (
      pedido_id, erp_sucursal_id, erp_product_id, erp_presentacion_id,
      cantidad_asignada, sin_stock, revision_minmax,
      stock_packs_snapshot, max_qty_snapshot, min_qty_snapshot, urgencia_pct_snapshot,
      lotes_asignados,
      factor, dispatch_tipo, dispatch_factor, dispatch_multiplo,
      caja_especial, agotamiento,
      status, cantidad_recibida, received_at
    ) VALUES (
      v_pedido_id,
      (v_item->>'erp_sucursal_id')::integer,
      (v_item->>'erp_product_id')::integer,
      (v_item->>'erp_presentacion_id')::integer,
      v_qty,
      COALESCE((v_item->>'sin_stock')::boolean,       false),
      COALESCE((v_item->>'revision_minmax')::boolean,  false),
      (v_item->>'stock_packs_snapshot')::numeric,
      (v_item->>'max_qty_snapshot')::integer,
      (v_item->>'min_qty_snapshot')::integer,
      (v_item->>'urgencia_pct_snapshot')::integer,
      CASE WHEN v_qty > 0 THEN (v_item->'lotes_asignados') ELSE NULL END,
      (v_item->>'factor')::numeric,
      v_item->>'dispatch_tipo',
      (v_item->>'dispatch_factor')::numeric,
      COALESCE((v_item->>'dispatch_multiplo')::smallint, 1),
      COALESCE((v_item->>'caja_especial')::boolean, false),
      COALESCE((v_item->>'agotamiento')::boolean,    false),
      CASE WHEN v_qty = 0 THEN 'recibido'  ELSE 'pendiente' END,
      CASE WHEN v_qty = 0 THEN 0           ELSE NULL        END,
      CASE WHEN v_qty = 0 THEN now()       ELSE NULL        END
    );
  END LOOP;

  RETURN v_pedido_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.confirmar_envio_pedido(p_pedido_id uuid, p_sucursal_id integer, p_ajustes jsonb DEFAULT '[]'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_actor  uuid := auth_employee_id();
    v_status text;
    v_aj     jsonb;
    v_id     integer;
    v_qty    integer;
    v_ajustados integer := 0;
BEGIN
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'UNAUTHENTICATED';
    END IF;
    IF NOT auth_can_edit_any(ARRAY['pedidos']) THEN
        RAISE EXCEPTION 'PERMISSION_DENIED: se requiere permiso de edición en Pedidos';
    END IF;
    -- Confirmar lo que sale es de Bodega (decisión 2026-10-02).
    IF NOT (SELECT public.auth_can_edit_scope_all(ARRAY['pedidos'])) THEN
        RAISE EXCEPTION 'BRANCH_SCOPE_DENIED: confirmar el envío es de Bodega';
    END IF;

    SELECT status INTO v_status FROM pedidos WHERE id = p_pedido_id FOR UPDATE;
    IF v_status IS NULL THEN
        RAISE EXCEPTION 'Pedido no encontrado.';
    END IF;
    IF v_status IN ('anulado', 'completado') THEN
        RAISE EXCEPTION 'El pedido ya está % y no puede confirmarse.', v_status;
    END IF;

    -- 1. Lo normal: sale lo asignado.
    UPDATE pedido_items
    SET cantidad_enviada = cantidad_asignada,
        enviado_at       = now(),
        enviado_por      = v_actor
    WHERE pedido_id       = p_pedido_id
      AND erp_sucursal_id = p_sucursal_id
      AND status          = 'pendiente'
      AND cantidad_enviada IS NULL;

    -- 2. Las excepciones que trajo quien confirma.
    FOR v_aj IN SELECT * FROM jsonb_array_elements(coalesce(p_ajustes, '[]'::jsonb))
    LOOP
        v_id  := (v_aj->>'pedido_item_id')::integer;
        v_qty := (v_aj->>'cantidad_enviada')::integer;

        IF v_qty IS NULL OR v_qty < 0 THEN
            RAISE EXCEPTION 'cantidad_enviada inválida para el ítem %.', v_id;
        END IF;

        -- El ítem tiene que ser de ESTE pedido y de ESTA sucursal: el id viene
        -- del navegador y sin esto se podría tocar el renglón de otra sala.
        UPDATE pedido_items
        SET cantidad_enviada = v_qty,
            motivo_no_envio  = nullif(trim(v_aj->>'motivo'), ''),
            enviado_at       = now(),
            enviado_por      = v_actor,
            -- Lo que no sale se cierra acá mismo. Decisión del usuario
            -- (2026-08-11): el faltante no queda pendiente, el MIN/MAX lo
            -- vuelve a detectar y lo pide solo en el próximo pedido.
            status           = CASE WHEN v_qty = 0 THEN 'no_enviado' ELSE status END,
            cantidad_recibida = CASE WHEN v_qty = 0 THEN 0 ELSE cantidad_recibida END
        WHERE id              = v_id
          AND pedido_id       = p_pedido_id
          AND erp_sucursal_id = p_sucursal_id
          AND status IN ('pendiente', 'no_enviado');

        IF FOUND THEN
            v_ajustados := v_ajustados + 1;
        END IF;
    END LOOP;

    RETURN (
        SELECT jsonb_build_object(
            'ajustados',    v_ajustados,
            'confirmados',  count(*) FILTER (WHERE cantidad_enviada IS NOT NULL),
            'no_enviados',  count(*) FILTER (WHERE status = 'no_enviado'),
            'packs',        coalesce(sum(cantidad_enviada) FILTER (WHERE status <> 'no_enviado'), 0)
        )
        FROM pedido_items
        WHERE pedido_id = p_pedido_id AND erp_sucursal_id = p_sucursal_id
    );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.receive_pedido_sucursal(p_pedido_id uuid, p_sucursal_id integer, p_items jsonb, p_received_by uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_status    text;
  v_item      jsonb;
  v_qty_diff  boolean;
  v_has_diff  boolean;
  v_error     text;
  v_cant_prob integer;
  v_actor     uuid := auth_employee_id();
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED';
  END IF;
  IF NOT auth_can_edit_any(ARRAY['pedidos']) THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: se requiere permiso de edición en Pedidos';
  END IF;
  -- La sala recibe sólo lo suyo (decisión 2026-10-02).
  IF NOT (SELECT public.auth_can_edit_scope_all(ARRAY['pedidos']))
     AND p_sucursal_id IS DISTINCT FROM (SELECT public.auth_employee_erp_sucursal_id()) THEN
    RAISE EXCEPTION 'BRANCH_SCOPE_DENIED: sólo puedes recibir el pedido de tu sucursal';
  END IF;

  SELECT status INTO v_status FROM pedidos WHERE id = p_pedido_id FOR UPDATE;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Pedido no encontrado.';
  END IF;

  IF v_status IN ('anulado', 'completado') THEN
    RAISE EXCEPTION 'El pedido ya está % y no puede ser modificado.', v_status;
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_error     := NULLIF(TRIM(v_item->>'error_tipo'), '');
    v_cant_prob := NULLIF(v_item->>'cantidad_problema', '')::integer;

    SELECT (COALESCE(pi.cantidad_enviada, pi.cantidad_asignada)
              IS DISTINCT FROM (v_item->>'cantidad_recibida')::integer)
    INTO v_qty_diff
    FROM pedido_items pi
    WHERE pi.id              = (v_item->>'pedido_item_id')::integer
      AND pi.erp_sucursal_id = p_sucursal_id
      AND pi.pedido_id       = p_pedido_id
      AND pi.status          = 'pendiente'
      AND NOT COALESCE(pi.falta_caja, false);

    CONTINUE WHEN v_qty_diff IS NULL;

    v_has_diff := v_qty_diff OR (v_error IS NOT NULL);

    UPDATE pedido_items SET
      cantidad_recibida = (v_item->>'cantidad_recibida')::integer,
      nota_diferencia   = NULLIF(TRIM(v_item->>'nota_diferencia'), ''),
      error_tipo        = v_error,
      cantidad_problema = v_cant_prob,
      status            = CASE WHEN v_has_diff THEN 'con_diferencia' ELSE 'recibido' END,
      received_at       = now(),
      received_by       = v_actor
    WHERE id              = (v_item->>'pedido_item_id')::integer
      AND erp_sucursal_id = p_sucursal_id
      AND pedido_id       = p_pedido_id
      AND status          = 'pendiente'
      AND NOT COALESCE(falta_caja, false);
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM pedido_items WHERE pedido_id = p_pedido_id AND status = 'pendiente'
  ) THEN
    IF EXISTS (SELECT 1 FROM pedido_items WHERE pedido_id = p_pedido_id AND status = 'con_diferencia') THEN
      UPDATE pedidos SET status = 'parcial'    WHERE id = p_pedido_id;
    ELSE
      UPDATE pedidos SET status = 'completado' WHERE id = p_pedido_id;
    END IF;
  ELSIF EXISTS (SELECT 1 FROM pedido_items WHERE pedido_id = p_pedido_id AND status = 'con_diferencia') THEN
    UPDATE pedidos SET status = 'parcial' WHERE id = p_pedido_id;
  END IF;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.update_pedido_sucursal_lifecycle(p_pedido_id uuid, p_sucursal_id integer, p_stage text, p_user_id uuid DEFAULT NULL::uuid, p_razon text DEFAULT NULL::text, p_nota text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_actor uuid;
BEGIN
    IF pg_trigger_depth() = 0 THEN
        v_actor := auth_employee_id();
        IF v_actor IS NULL THEN
            RAISE EXCEPTION 'UNAUTHENTICATED';
        END IF;
        IF NOT auth_can_edit_any(ARRAY['pedidos']) THEN
            RAISE EXCEPTION 'PERMISSION_DENIED: se requiere permiso de edición en Pedidos';
        END IF;
        -- Decisión 2026-10-02: preparar, pausar, finalizar y corregir son de
        -- Bodega; llegada, recepción y diferencias, de la sala, y sólo la suya.
        IF NOT (SELECT public.auth_can_edit_scope_all(ARRAY['pedidos'])) THEN
            IF p_stage IN ('iniciar', 'pausar', 'reanudar', 'finalizar', 'corregir_bodega') THEN
                RAISE EXCEPTION 'BRANCH_SCOPE_DENIED: ese paso del pedido es de Bodega';
            END IF;
            IF p_sucursal_id IS DISTINCT FROM (SELECT public.auth_employee_erp_sucursal_id()) THEN
                RAISE EXCEPTION 'BRANCH_SCOPE_DENIED: sólo puedes mover el pedido de tu sucursal';
            END IF;
        END IF;
    ELSE
        v_actor := p_user_id;
    END IF;

    INSERT INTO pedido_sucursal_status (pedido_id, erp_sucursal_id)
    VALUES (p_pedido_id, p_sucursal_id)
    ON CONFLICT (pedido_id, erp_sucursal_id) DO NOTHING;

    IF p_stage = 'iniciar' THEN
        UPDATE pedido_sucursal_status
        SET iniciado_at  = NOW(), iniciado_por = v_actor
        WHERE pedido_id = p_pedido_id AND erp_sucursal_id = p_sucursal_id
          AND iniciado_at IS NULL;

    ELSIF p_stage = 'pausar' THEN
        IF EXISTS (
            SELECT 1 FROM pedido_pausa_historial
            WHERE pedido_id = p_pedido_id AND erp_sucursal_id = p_sucursal_id
              AND reanudado_at IS NULL
        ) THEN RETURN; END IF;
        UPDATE pedido_sucursal_status
        SET pausado_at = NOW(), pausa_razon = p_razon, reanudado_at = NULL, reanudado_por = NULL
        WHERE pedido_id = p_pedido_id AND erp_sucursal_id = p_sucursal_id
          AND iniciado_at IS NOT NULL AND finalizado_at IS NULL;
        INSERT INTO pedido_pausa_historial
            (pedido_id, erp_sucursal_id, pausado_at, razon, pausado_por)
        VALUES (p_pedido_id, p_sucursal_id, NOW(), p_razon, v_actor);

    ELSIF p_stage = 'reanudar' THEN
        UPDATE pedido_pausa_historial
        SET reanudado_at = NOW(), reanudado_por = v_actor
        WHERE pedido_id = p_pedido_id AND erp_sucursal_id = p_sucursal_id
          AND reanudado_at IS NULL;
        UPDATE pedido_sucursal_status
        SET reanudado_at = NOW(), reanudado_por = v_actor
        WHERE pedido_id = p_pedido_id AND erp_sucursal_id = p_sucursal_id
          AND pausado_at IS NOT NULL AND reanudado_at IS NULL AND finalizado_at IS NULL;

    ELSIF p_stage = 'finalizar' THEN
        IF EXISTS (
            SELECT 1 FROM pedido_pausa_historial
            WHERE pedido_id = p_pedido_id AND erp_sucursal_id = p_sucursal_id
              AND reanudado_at IS NULL
        ) THEN
            RAISE EXCEPTION 'No se puede finalizar: hay una pausa activa sin reanudar.';
        END IF;
        UPDATE pedido_sucursal_status
        SET finalizado_at = NOW(), finalizado_por = v_actor
        WHERE pedido_id = p_pedido_id AND erp_sucursal_id = p_sucursal_id
          AND iniciado_at IS NOT NULL AND finalizado_at IS NULL
          AND (pausado_at IS NULL OR reanudado_at IS NOT NULL);

    ELSIF p_stage = 'confirmar_llegada' THEN
        UPDATE pedido_sucursal_status
        SET llegada_fisica_at  = NOW(), llegada_fisica_por = v_actor
        WHERE pedido_id = p_pedido_id AND erp_sucursal_id = p_sucursal_id
          AND llegada_fisica_at IS NULL;

    ELSIF p_stage = 'recibir_erp' THEN
        UPDATE pedido_sucursal_status
        SET recibido_erp_at  = NOW(), recibido_erp_por = v_actor
        WHERE pedido_id = p_pedido_id AND erp_sucursal_id = p_sucursal_id
          AND recibido_erp_at IS NULL;

    ELSIF p_stage = 'reportar_diferencias' THEN
        UPDATE pedido_sucursal_status
        SET diferencias_reportadas_at  = NOW(),
            diferencias_reportadas_por = v_actor
        WHERE pedido_id = p_pedido_id AND erp_sucursal_id = p_sucursal_id;

    ELSIF p_stage = 'corregir_bodega' THEN
        UPDATE pedido_sucursal_status
        SET corregido_bodega_at   = NOW(),
            corregido_bodega_por  = v_actor,
            corregido_bodega_nota = p_nota
        WHERE pedido_id = p_pedido_id AND erp_sucursal_id = p_sucursal_id;

    ELSIF p_stage = 'confirmar_correccion' THEN
        UPDATE pedido_sucursal_status
        SET confirmado_correccion_at  = NOW(),
            confirmado_correccion_por = v_actor
        WHERE pedido_id = p_pedido_id AND erp_sucursal_id = p_sucursal_id;

    ELSE
        RAISE EXCEPTION 'stage desconocido: %', p_stage;
    END IF;
END;
$function$
;
