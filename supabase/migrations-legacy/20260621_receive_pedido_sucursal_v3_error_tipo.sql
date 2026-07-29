-- ============================================================
-- receive_pedido_sucursal v3 (v2.2.256)
-- - Lee y guarda error_tipo del JSON payload
-- - con_diferencia cuando qty_diff OR error_tipo IS NOT NULL
-- - Elimina p_responsables que nunca existió en la firma DB
-- ============================================================

DROP FUNCTION IF EXISTS receive_pedido_sucursal(uuid, integer, jsonb, uuid);

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
  v_status    text;
  v_item      jsonb;
  v_qty_diff  boolean;
  v_has_diff  boolean;
  v_error     text;
BEGIN
  SELECT status INTO v_status FROM pedidos WHERE id = p_pedido_id FOR UPDATE;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Pedido no encontrado.';
  END IF;

  IF v_status IN ('anulado', 'completado') THEN
    RAISE EXCEPTION 'El pedido ya está % y no puede ser modificado.', v_status;
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_error := NULLIF(TRIM(v_item->>'error_tipo'), '');

    SELECT (pi.cantidad_asignada IS DISTINCT FROM (v_item->>'cantidad_recibida')::integer)
    INTO v_qty_diff
    FROM pedido_items pi
    WHERE pi.id              = (v_item->>'pedido_item_id')::integer
      AND pi.erp_sucursal_id = p_sucursal_id
      AND pi.pedido_id       = p_pedido_id
      AND pi.status          = 'pendiente';

    CONTINUE WHEN v_qty_diff IS NULL;

    v_has_diff := v_qty_diff OR (v_error IS NOT NULL);

    UPDATE pedido_items SET
      cantidad_recibida = (v_item->>'cantidad_recibida')::integer,
      nota_diferencia   = NULLIF(TRIM(v_item->>'nota_diferencia'), ''),
      error_tipo        = v_error,
      status            = CASE WHEN v_has_diff THEN 'con_diferencia' ELSE 'recibido' END,
      received_at       = now(),
      received_by       = p_received_by
    WHERE id              = (v_item->>'pedido_item_id')::integer
      AND erp_sucursal_id = p_sucursal_id
      AND pedido_id       = p_pedido_id
      AND status          = 'pendiente';
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
$$;

GRANT EXECUTE ON FUNCTION receive_pedido_sucursal(uuid, integer, jsonb, uuid) TO authenticated;
