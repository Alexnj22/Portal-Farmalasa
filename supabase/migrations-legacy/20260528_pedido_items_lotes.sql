-- ============================================================
-- pedido_items: lotes_asignados — proyección FEFO congelada al confirmar
-- Update confirm_pedido to store lotes_asignados from p_items JSON.
-- ============================================================

ALTER TABLE pedido_items
  ADD COLUMN IF NOT EXISTS lotes_asignados jsonb;

CREATE OR REPLACE FUNCTION confirm_pedido(
  p_created_by  uuid,
  p_notes       text,
  p_items       jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_pedido_id uuid;
  v_item      jsonb;
  v_qty       integer;
BEGIN
  INSERT INTO pedidos (created_by, notes)
  VALUES (p_created_by, p_notes)
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
      COALESCE((v_item->>'sin_stock')::boolean,      false),
      COALESCE((v_item->>'revision_minmax')::boolean, false),
      (v_item->>'stock_packs_snapshot')::numeric,
      (v_item->>'max_qty_snapshot')::integer,
      (v_item->>'min_qty_snapshot')::integer,
      (v_item->>'urgencia_pct_snapshot')::integer,
      CASE WHEN v_qty > 0 THEN (v_item->'lotes_asignados') ELSE NULL END,
      CASE WHEN v_qty = 0 THEN 'recibido' ELSE 'pendiente' END,
      CASE WHEN v_qty = 0 THEN 0           ELSE NULL        END,
      CASE WHEN v_qty = 0 THEN now()       ELSE NULL        END
    );
  END LOOP;

  RETURN v_pedido_id;
END;
$$;

GRANT EXECUTE ON FUNCTION confirm_pedido(uuid, text, jsonb) TO authenticated;
