-- ============================================================
-- Pedidos FASE 3 — Trazabilidad completa (v2.2.35)
--
-- 3.1  Nuevas columnas en pedidos: responsable_id, revisado_por,
--      enviado_por, enviado_at, sucursal_ids.
--      Nuevas columnas en pedido_items: received_by, error_tipo,
--      resuelto_por, resuelto_at, nota_resolucion.
-- 3.2  Estado 'enviado' en pedidos + RPC marcar_pedido_enviado.
-- 3.3  confirm_pedido acepta responsable_id, revisado_por, sucursal_ids.
-- 3.4  receive_pedido_sucursal acepta received_by.
-- ============================================================


-- ── 3.1 Nuevas columnas ───────────────────────────────────────

ALTER TABLE pedidos
  ADD COLUMN IF NOT EXISTS responsable_id  uuid,
  ADD COLUMN IF NOT EXISTS revisado_por    uuid,
  ADD COLUMN IF NOT EXISTS enviado_por     uuid,
  ADD COLUMN IF NOT EXISTS enviado_at      timestamptz,
  ADD COLUMN IF NOT EXISTS sucursal_ids    integer[];

ALTER TABLE pedido_items
  ADD COLUMN IF NOT EXISTS received_by     uuid,
  ADD COLUMN IF NOT EXISTS error_tipo      text,
  ADD COLUMN IF NOT EXISTS resuelto_por    uuid,
  ADD COLUMN IF NOT EXISTS resuelto_at     timestamptz,
  ADD COLUMN IF NOT EXISTS nota_resolucion text;


-- ── 3.2 Agregar estado 'enviado' al constraint de status ─────

DO $$
DECLARE v_c text;
BEGIN
  SELECT conname INTO v_c
  FROM pg_constraint
  WHERE conrelid = 'pedidos'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%status%';
  IF v_c IS NOT NULL THEN
    EXECUTE 'ALTER TABLE pedidos DROP CONSTRAINT ' || quote_ident(v_c);
  END IF;
END
$$;

ALTER TABLE pedidos ADD CONSTRAINT pedidos_status_check
  CHECK (status IN ('confirmado','enviado','parcial','completado','anulado'));

-- RPC marcar_pedido_enviado
CREATE OR REPLACE FUNCTION marcar_pedido_enviado(
  p_pedido_id   uuid,
  p_enviado_por uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_status text;
BEGIN
  SELECT status INTO v_status
  FROM pedidos WHERE id = p_pedido_id FOR UPDATE;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Pedido no encontrado.';
  END IF;

  IF v_status <> 'confirmado' THEN
    RAISE EXCEPTION 'Solo un pedido en estado "confirmado" puede marcarse como enviado (estado actual: %).', v_status;
  END IF;

  UPDATE pedidos
  SET status      = 'enviado',
      enviado_por = p_enviado_por,
      enviado_at  = now()
  WHERE id = p_pedido_id;
END;
$$;

GRANT EXECUTE ON FUNCTION marcar_pedido_enviado(uuid, uuid) TO authenticated;


-- ── 3.3 confirm_pedido acepta responsable_id, revisado_por, sucursal_ids ─────

DROP FUNCTION IF EXISTS confirm_pedido(uuid, text, jsonb);

CREATE OR REPLACE FUNCTION confirm_pedido(
  p_created_by     uuid,
  p_notes          text,
  p_items          jsonb,
  p_responsable_id uuid      DEFAULT NULL,
  p_revisado_por   uuid      DEFAULT NULL,
  p_sucursal_ids   integer[] DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_pedido_id uuid;
  v_item      jsonb;
  v_qty       integer;
  v_suc_valid boolean;
BEGIN
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

  INSERT INTO pedidos (created_by, notes, responsable_id, revisado_por, sucursal_ids)
  VALUES (p_created_by, p_notes, p_responsable_id, p_revisado_por, p_sucursal_ids)
  RETURNING id INTO v_pedido_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_qty := COALESCE((v_item->>'cantidad_asignada')::integer, 0);
    INSERT INTO pedido_items (
      pedido_id, erp_sucursal_id, erp_product_id, erp_presentacion_id,
      cantidad_asignada, sin_stock, revision_minmax,
      stock_packs_snapshot, max_qty_snapshot, min_qty_snapshot, urgencia_pct_snapshot,
      lotes_asignados,
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
      CASE WHEN v_qty = 0 THEN 'recibido'  ELSE 'pendiente' END,
      CASE WHEN v_qty = 0 THEN 0           ELSE NULL        END,
      CASE WHEN v_qty = 0 THEN now()       ELSE NULL        END
    );
  END LOOP;

  RETURN v_pedido_id;
END;
$$;

GRANT EXECUTE ON FUNCTION confirm_pedido(uuid, text, jsonb, uuid, uuid, integer[]) TO authenticated;


-- ── 3.4 receive_pedido_sucursal acepta received_by ────────────

DROP FUNCTION IF EXISTS receive_pedido_sucursal(uuid, integer, jsonb);

CREATE OR REPLACE FUNCTION receive_pedido_sucursal(
  p_pedido_id   uuid,
  p_sucursal_id integer,
  p_items       jsonb,
  p_received_by uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_status   text;
  v_item     jsonb;
  v_has_diff boolean;
BEGIN
  SELECT status INTO v_status
  FROM pedidos WHERE id = p_pedido_id FOR UPDATE;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Pedido no encontrado.';
  END IF;

  IF v_status IN ('anulado', 'completado') THEN
    RAISE EXCEPTION 'El pedido ya está % y no puede ser modificado.', v_status;
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    SELECT (pi.cantidad_asignada IS DISTINCT FROM (v_item->>'cantidad_recibida')::integer)
    INTO v_has_diff
    FROM pedido_items pi
    WHERE pi.id             = (v_item->>'pedido_item_id')::integer
      AND pi.erp_sucursal_id = p_sucursal_id
      AND pi.pedido_id       = p_pedido_id
      AND pi.status          = 'pendiente';

    CONTINUE WHEN v_has_diff IS NULL;

    UPDATE pedido_items SET
      cantidad_recibida = (v_item->>'cantidad_recibida')::integer,
      nota_diferencia   = v_item->>'nota_diferencia',
      status            = CASE WHEN v_has_diff THEN 'con_diferencia' ELSE 'recibido' END,
      received_at       = now(),
      received_by       = p_received_by
    WHERE id              = (v_item->>'pedido_item_id')::integer
      AND erp_sucursal_id = p_sucursal_id
      AND pedido_id       = p_pedido_id
      AND status          = 'pendiente';
  END LOOP;

  -- Actualizar status del pedido
  IF NOT EXISTS (
    SELECT 1 FROM pedido_items
    WHERE pedido_id = p_pedido_id AND status = 'pendiente'
  ) THEN
    IF EXISTS (
      SELECT 1 FROM pedido_items
      WHERE pedido_id = p_pedido_id AND status = 'con_diferencia'
    ) THEN
      UPDATE pedidos SET status = 'parcial'    WHERE id = p_pedido_id;
    ELSE
      UPDATE pedidos SET status = 'completado' WHERE id = p_pedido_id;
    END IF;
  ELSIF EXISTS (
    SELECT 1 FROM pedido_items
    WHERE pedido_id = p_pedido_id AND status = 'con_diferencia'
  ) THEN
    UPDATE pedidos SET status = 'parcial' WHERE id = p_pedido_id;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION receive_pedido_sucursal(uuid, integer, jsonb, uuid) TO authenticated;
