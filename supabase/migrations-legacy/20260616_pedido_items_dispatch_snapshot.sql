-- Persiste factor ERP + dispatch_tipo/dispatch_factor en pedido_items al confirmar
-- el pedido, para que la impresión histórica (printFromPedidoItems) pueda reconstruir
-- la presentación de despacho real (ej. CAJA) en vez de mostrar la cantidad en
-- unidades ERP. get_pedido_preview ya calcula estos valores; antes se descartaban
-- al guardar (TabGenerar.jsx) y la hoja impresa quedaba en unidades ERP siempre.

ALTER TABLE pedido_items
  ADD COLUMN IF NOT EXISTS factor          numeric,
  ADD COLUMN IF NOT EXISTS dispatch_tipo   text,
  ADD COLUMN IF NOT EXISTS dispatch_factor numeric;

CREATE OR REPLACE FUNCTION public.confirm_pedido(p_created_by uuid, p_notes text, p_items jsonb, p_responsable_id uuid DEFAULT NULL::uuid, p_revisado_por uuid DEFAULT NULL::uuid, p_sucursal_ids integer[] DEFAULT NULL::integer[])
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
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
      factor, dispatch_tipo, dispatch_factor,
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
      CASE WHEN v_qty = 0 THEN 'recibido'  ELSE 'pendiente' END,
      CASE WHEN v_qty = 0 THEN 0           ELSE NULL        END,
      CASE WHEN v_qty = 0 THEN now()       ELSE NULL        END
    );
  END LOOP;

  RETURN v_pedido_id;
END;
$function$
;
